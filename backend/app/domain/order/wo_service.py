"""작업지시 서비스 (A2-03 · A2-04 · B4-04/06 · api-contract §7.3 · §13.4 · spec §2.3).

- ``propose_wo``: 아직 WO 가 없는 라인만(admin #26) 품목×가공방식 1 draft. 라우팅은
  ``master.resolve_routing`` (품목군×가공방식). 없으면 라인별 오류를 모아 404 ``ROUTING_NOT_FOUND``.
  tolerance_pct 는 routing_step 값, 없으면 item.qty_tolerance_pct (db-schema §3.5).
- ``issue_wo``: draft 검증(라인 소속·품목·가공방식·라우팅·단계·수량 합 = 라인 qty, 분리만 허용) →
  시안 확정 검사(NONE = skips_p30 면제, 409 ``DESIGN_NOT_CONFIRMED``) → WO 채번 → wo_route_step
  스냅샷(1단계 qty_in = qty_ordered · started_at = issued_at, D6-12/shopfloor ⑧) → status ISSUED →
  라벨 훅(``ports.issue_labels_for_wo``) → SO IN_PROGRESS · confirmed_at(첫 발행) → recalc_so.
  전부 한 트랜잭션.
- 상태 전이(§2.3): hold ISSUED/IN_PROGRESS→ON_HOLD · resume ON_HOLD→재계산 · cancel
  DRAFT/ISSUED/IN_PROGRESS/ON_HOLD/PACKED→CANCELLED · close PACKED/SHIPPED→CLOSED. 위반 409
  ``STATE_CONFLICT``. rework · reprint 는 S4/개발B.
- ``split_wo`` (B4-04, §13.4 shopfloor ⑱ [S3]): ISSUED/IN_PROGRESS 만. 하위 WO(`-A`~`-Z`, UK
  (parent_wo_id, split_suffix))를 만들고 라우팅을 복사한다(1단계 qty_in = 분할 수량, shopfloor
  ⑧). 26개 초과 409 ``SPLIT_LIMIT``. STATION 은 ``approver_card``+``pin``(MANAGER/ADMIN,
  `/auth/worker`·승인과 같은 ``verify_pin`` 경로) — 카드 없이 JWT 만이면 라우터의
  ``require_roles`` 가 이미 ADMIN/MANAGER 로 제한한다.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Principal
from app.api.v1.schemas import order as S
from app.api.v1.schemas.common import normalize_code
from app.api.v1.schemas.master import RoutingStepInput
from app.core.errors import ApiError, not_found, state_conflict, validation
from app.core.sequence import next_code, split_code
from app.db.models.master import AppUser, Customer, Item, ItemRouting, PrintMethod
from app.db.models.ops import AuditLog
from app.db.models.order import Design, SalesOrder, SalesOrderLine, WorkOrder, WoRouteStep
from app.db.models.scan import ScanEvent
from app.domain.auth.service import resolve_manager_approver
from app.domain.common.listing import PageParams, paginate, parse_sort, q_filter
from app.domain.master import service as master
from app.domain.order import ports, recalc, so_service
from app.domain.order.views import WoView, load_wo_views

# admin #4 · #5 · §14.6: wo 기본 정렬 = 첫 컬럼 내림차순
WO_SORT: dict[str, Any] = {
    "due_date": SalesOrder.due_date,
    "code": WorkOrder.code,
    "status": WorkOrder.status,
    "current_step_seq": WorkOrder.current_step_seq,
    "issued_at": WorkOrder.issued_at,
}
WO_Q = (WorkOrder.code, SalesOrder.code, Customer.name, Item.name)

HOLDABLE = frozenset({"ISSUED", "IN_PROGRESS"})
CANCELLABLE = frozenset({"DRAFT", "ISSUED", "IN_PROGRESS", "ON_HOLD", "PACKED"})
CLOSABLE = frozenset({"PACKED", "SHIPPED"})
SPLITTABLE = frozenset({"ISSUED", "IN_PROGRESS"})


# ======================================================================
# 조회
# ======================================================================
async def resolve_wo(session: AsyncSession, key: str) -> WorkOrder:
    stmt = select(WorkOrder)
    if key.isdigit():
        stmt = stmt.where(WorkOrder.id == int(key))
    else:
        stmt = stmt.where(WorkOrder.code == normalize_code(key))
    wo = (await session.execute(stmt)).scalar_one_or_none()
    if wo is None:
        raise not_found("WO_NOT_FOUND", "작업지시", key)
    return wo


async def get_wo_view(session: AsyncSession, key: str) -> WoView:
    wo = await resolve_wo(session, key)
    return (await load_wo_views(session, [wo]))[0]


async def list_work_orders(
    session: AsyncSession,
    params: PageParams,
    *,
    so_code: str | None,
    status: str | None,
    process_code: str | None,
    delay: bool,
    q: str | None,
    sort: str | None,
) -> tuple[list[WoView], int]:
    stmt = (
        select(WorkOrder)
        .join(SalesOrder, SalesOrder.id == WorkOrder.so_id)
        .join(Customer, Customer.id == SalesOrder.customer_id)
        .join(Item, Item.id == WorkOrder.item_id)
    )
    if so_code:
        stmt = stmt.where(SalesOrder.code == normalize_code(so_code))
    if status:
        stmt = stmt.where(WorkOrder.status == status.upper())
    if process_code:
        # 현재 공정 = current_step_seq 단계의 process_code
        cur = exists().where(
            WoRouteStep.wo_id == WorkOrder.id,
            WoRouteStep.seq == WorkOrder.current_step_seq,
            WoRouteStep.process_code == normalize_code(process_code),
        )
        stmt = stmt.where(cur)
    if (f := q_filter(q, WO_Q)) is not None:
        stmt = stmt.where(f)
    stmt = stmt.order_by(*parse_sort(sort, WO_SORT, default="-due_date"))
    if not delay:
        rows, total = await paginate(session, stmt, params)
        return await load_wo_views(session, rows), total
    stmt = stmt.where(WorkOrder.status.in_(tuple(recalc.WO_ACTIVE)))
    rows = list((await session.execute(stmt)).scalars().all())
    views = [v for v in await load_wo_views(session, rows) if v.delay_risk]
    return views[params.offset : params.offset + params.size], len(views)


async def list_events(
    session: AsyncSession, wo: WorkOrder, params: PageParams
) -> tuple[list[ScanEvent], int]:
    stmt = select(ScanEvent).where(ScanEvent.wo_id == wo.id).order_by(ScanEvent.received_at.desc())
    return await paginate(session, stmt, params)


# ======================================================================
# 제안 (A2-03)
# ======================================================================
async def _lines_without_wo(session: AsyncSession, so: SalesOrder) -> list[SalesOrderLine]:
    has_wo = exists().where(
        WorkOrder.so_line_id == SalesOrderLine.id, WorkOrder.status != "CANCELLED"
    )
    rows = (
        await session.execute(
            select(SalesOrderLine)
            .where(SalesOrderLine.so_id == so.id, ~has_wo)
            .order_by(SalesOrderLine.line_no)
        )
    ).scalars()
    return list(rows.all())


def _step_inputs(routing: ItemRouting, item: Item) -> list[RoutingStepInput]:
    return [
        RoutingStepInput(
            seq=s.seq,
            process_code=s.process_code,
            std_lead_hours=float(s.std_lead_hours),
            tolerance_pct=float(
                s.tolerance_pct if s.tolerance_pct is not None else item.qty_tolerance_pct
            ),
        )
        for s in sorted(routing.steps, key=lambda x: x.seq)
    ]


async def propose_wo(session: AsyncSession, so_key: str) -> list[S.WoDraft]:
    so = await so_service.resolve_so(session, so_key)
    if so.status not in so_service.SO_EDITABLE:
        raise state_conflict(f"수주 상태 {so.status} — WO 를 제안할 수 없습니다")
    lines = await _lines_without_wo(session, so)
    items = {
        i.id: i
        for i in (
            await session.execute(select(Item).where(Item.id.in_({ln.item_id for ln in lines})))
        ).scalars()
    }
    drafts: list[S.WoDraft] = []
    errors: list[dict[str, Any]] = []
    for ln in lines:
        item = items[ln.item_id]
        try:
            routing = await master.resolve_routing(session, item.item_group, ln.print_method)
        except ApiError as e:
            if e.code != "ROUTING_NOT_FOUND":
                raise
            errors.append(
                {
                    "so_line_id": ln.id,
                    "line_no": ln.line_no,
                    "item_group": item.item_group,
                    "print_method": ln.print_method,
                    "msg": e.message,
                }
            )
            continue
        drafts.append(
            S.WoDraft(
                so_line_id=ln.id,
                item_id=ln.item_id,
                print_method=ln.print_method,
                qty=ln.qty,
                routing_id=routing.id,
                steps=_step_inputs(routing, item),
            )
        )
    if errors:
        raise ApiError(
            404,
            "ROUTING_NOT_FOUND",
            f"라우팅이 없는 라인이 {len(errors)}건 있습니다 — 라우팅(ADM-06)을 먼저 등록하세요",
            errors,
        )
    return drafts


# ======================================================================
# 발행 (A2-04)
# ======================================================================
async def _validate_drafts(
    session: AsyncSession, so: SalesOrder, drafts: list[S.WoDraft]
) -> tuple[dict[int, SalesOrderLine], dict[int, Item], dict[int, ItemRouting]]:
    lines = {
        ln.id: ln
        for ln in (
            await session.execute(select(SalesOrderLine).where(SalesOrderLine.so_id == so.id))
        ).scalars()
    }
    issued_line_ids = set(
        (
            await session.execute(
                select(WorkOrder.so_line_id).where(
                    WorkOrder.so_id == so.id, WorkOrder.status != "CANCELLED"
                )
            )
        )
        .scalars()
        .all()
    )
    items = {
        i.id: i
        for i in (
            await session.execute(
                select(Item).where(Item.id.in_({ln.item_id for ln in lines.values()}))
            )
        ).scalars()
    }
    routings: dict[int, ItemRouting] = {}
    qty_sum: dict[int, int] = {}
    for idx, d in enumerate(drafts):
        loc: list[str | int] = ["body", "drafts", idx]
        ln = lines.get(d.so_line_id)
        if ln is None:
            raise validation(
                [*loc, "so_line_id"], f"수주 {so.code} 에 라인 {d.so_line_id} 이(가) 없습니다"
            )
        if ln.id in issued_line_ids:
            raise ApiError(
                409,
                "WO_ALREADY_ISSUED",
                f"라인 #{ln.line_no} 은 이미 WO 가 발행되었습니다",
                [{"line_id": ln.id}],
            )
        if d.item_id != ln.item_id or d.print_method != ln.print_method:
            raise validation(
                [*loc, "item_id"],
                f"라인 #{ln.line_no} 의 품목·가공방식과 다릅니다 (분리만 허용, admin #26)",
            )
        item = items[ln.item_id]
        routing = routings.get(d.routing_id)
        if routing is None:
            routing = await master.resolve_routing(session, item.item_group, ln.print_method)
            routings[d.routing_id] = routing
        if routing.id != d.routing_id:
            raise validation(
                [*loc, "routing_id"],
                f"라인 #{ln.line_no} 의 라우팅은 {routing.id} 입니다 (받은 값 {d.routing_id})",
            )
        expected = [s.process_code for s in sorted(routing.steps, key=lambda x: x.seq)]
        got = [s.process_code for s in sorted(d.steps, key=lambda x: x.seq)]
        if got != expected:
            raise validation(
                [*loc, "steps"],
                f"라인 #{ln.line_no} 단계가 라우팅과 다릅니다: {got} ≠ {expected} (조정은 분리만)",
            )
        qty_sum[ln.id] = qty_sum.get(ln.id, 0) + d.qty
    for line_id, total in qty_sum.items():
        ln = lines[line_id]
        if total != ln.qty:
            raise validation(
                ["body", "drafts"],
                f"라인 #{ln.line_no} 의 초안 수량 합 {total} ≠ 라인 수량 {ln.qty}",
            )
    return lines, items, routings


async def _check_designs(
    session: AsyncSession, lines: list[SalesOrderLine]
) -> dict[int, int | None]:
    """라인별 design_version (NONE/skips_p30 는 None). 미확정 → 409 DESIGN_NOT_CONFIRMED."""
    pms = {
        p.code: p
        for p in (
            await session.execute(
                select(PrintMethod).where(PrintMethod.code.in_({ln.print_method for ln in lines}))
            )
        ).scalars()
    }
    designs = {
        d.id: d
        for d in (
            await session.execute(
                select(Design).where(
                    Design.id.in_([ln.design_id for ln in lines if ln.design_id is not None] or [0])
                )
            )
        ).scalars()
    }
    versions: dict[int, int | None] = {}
    unconfirmed: list[dict[str, Any]] = []
    for ln in lines:
        pm = pms[ln.print_method]
        if pm.skips_p30:  # NONE — 도안 불필요 (admin #25)
            versions[ln.id] = designs[ln.design_id].version if ln.design_id in designs else None
            continue
        if not ln.design_confirmed or ln.design_id is None:
            unconfirmed.append({"line_id": ln.id, "line_no": ln.line_no})
            continue
        versions[ln.id] = designs[ln.design_id].version
    if unconfirmed:
        raise ApiError(
            409,
            "DESIGN_NOT_CONFIRMED",
            "시안 미확정 라인이 있습니다: " + ", ".join(f"#{u['line_no']}" for u in unconfirmed),
            unconfirmed,
        )
    return versions


async def issue_wo(
    session: AsyncSession, so_key: str, drafts: list[S.WoDraft], user: AppUser
) -> tuple[SalesOrder, list[WorkOrder]]:
    # D43: SO 행 잠금 → 잠금 뒤 검증(이미 발행된 라인 → 409 WO_ALREADY_ISSUED). 같은 SO 의 동시
    # 발행은 여기서 직렬화된다. 잠금은 commit 까지.
    so = await so_service.resolve_so(session, so_key, for_update=True)
    if so.status not in so_service.SO_EDITABLE:
        raise state_conflict(f"수주 상태 {so.status} — WO 를 발행할 수 없습니다")
    lines, items, routings = await _validate_drafts(session, so, drafts)
    target_lines = [lines[lid] for lid in {d.so_line_id for d in drafts}]
    versions = await _check_designs(session, target_lines)

    now = datetime.now(UTC)
    created: list[WorkOrder] = []
    for d in drafts:
        ln = lines[d.so_line_id]
        item = items[ln.item_id]
        routing = routings[d.routing_id]
        wo = WorkOrder(
            code=await next_code(session, "WO", now),
            so_id=so.id,
            so_line_id=ln.id,
            item_id=ln.item_id,
            print_method=ln.print_method,
            design_version=versions.get(ln.id),
            qty_ordered=d.qty,
            status="ISSUED",
            issued_at=now,
        )
        session.add(wo)
        await session.flush()
        steps: list[WoRouteStep] = []
        for i, rs in enumerate(sorted(routing.steps, key=lambda x: x.seq)):
            tol = rs.tolerance_pct if rs.tolerance_pct is not None else item.qty_tolerance_pct
            step = WoRouteStep(
                wo_id=wo.id,
                seq=rs.seq,
                process_code=rs.process_code,
                std_lead_hours=Decimal(rs.std_lead_hours),
                tolerance_pct=Decimal(tol),
                status="WAITING",
                qty_in=d.qty if i == 0 else None,  # shopfloor ⑧: 1단계 qty_in = qty_ordered
                started_at=now if i == 0 else None,  # D6-12: 대기 시작 = issued_at
            )
            session.add(step)
            steps.append(step)
        await session.flush()
        recalc.recalc_wo(wo, steps)
        await ports.issue_labels_for_wo(session, wo, user.id)
        created.append(wo)

    if so.confirmed_at is None:
        so.confirmed_at = now  # D6-10: 첫 issue-wo
    await session.flush()
    await recalc.recalc_so(session, so)
    await session.commit()
    for wo in created:
        await session.refresh(wo)
    await session.refresh(so)
    return so, created


# ======================================================================
# 상태 전이 (B4-04 · B4-06 · 종결)
# ======================================================================
async def _steps_of(session: AsyncSession, wo: WorkOrder) -> list[WoRouteStep]:
    rows = (
        await session.execute(
            select(WoRouteStep).where(WoRouteStep.wo_id == wo.id).order_by(WoRouteStep.seq)
        )
    ).scalars()
    return list(rows.all())


async def _finish(session: AsyncSession, wo: WorkOrder) -> WorkOrder:
    so = await session.get(SalesOrder, wo.so_id)
    assert so is not None
    await session.flush()
    await recalc.recalc_so(session, so)
    await session.commit()
    await session.refresh(wo)
    return wo


async def hold_wo(session: AsyncSession, key: str, reason: str) -> WorkOrder:
    wo = await resolve_wo(session, key)
    if wo.status not in HOLDABLE:
        raise state_conflict(f"작업지시 상태 {wo.status} — 보류할 수 없습니다")
    wo.status = "ON_HOLD"
    wo.hold_reason = reason
    return await _finish(session, wo)


async def resume_wo(session: AsyncSession, key: str) -> WorkOrder:
    wo = await resolve_wo(session, key)
    if wo.status != "ON_HOLD":
        raise state_conflict(f"작업지시 상태 {wo.status} — 재개할 수 없습니다 (ON_HOLD 만)")
    wo.status = "ISSUED"  # 재계산 대상으로 되돌린 뒤 단계로부터 다시 계산
    wo.hold_reason = None
    recalc.recalc_wo(wo, await _steps_of(session, wo))
    return await _finish(session, wo)


async def cancel_wo(session: AsyncSession, key: str, reason: str, user: AppUser) -> WorkOrder:
    """취소 사유는 ``cancel_reason``(0007, F33). ``hold_reason`` 은 보류 이력으로 남긴다."""
    wo = await resolve_wo(session, key)
    if wo.status not in CANCELLABLE:
        raise state_conflict(f"작업지시 상태 {wo.status} — 취소할 수 없습니다")
    wo.status = "CANCELLED"
    wo.cancel_reason = reason
    wo.cancelled_at = datetime.now(UTC)
    wo.cancelled_by = user.id
    return await _finish(session, wo)


async def close_wo(session: AsyncSession, key: str) -> WorkOrder:
    wo = await resolve_wo(session, key)
    if wo.status not in CLOSABLE:
        raise state_conflict(f"작업지시 상태 {wo.status} — 종결할 수 없습니다 (PACKED/SHIPPED 만)")
    wo.status = "CLOSED"
    wo.closed_at = datetime.now(UTC)
    return await _finish(session, wo)


# ======================================================================
# 분할 (B4-04, api-contract §7.3 spec · §13.4 shopfloor ⑱ [S3])
# ======================================================================
async def _resolve_split_approver(
    session: AsyncSession, principal: Principal, body: S.SplitRequest
) -> AppUser:
    """JWT 는 라우터의 ``require_roles(*WO_MANAGE, station=True)`` 가 ADMIN/MANAGER 로 이미
    제한했다. STATION 은 ``approver_card``+``pin`` 필수(§13.4 ⑱, §14.1 「승인 PIN」과 같은 경로)."""
    if principal.user is not None:
        return principal.user
    if not body.approver_card or not body.pin:
        raise validation(["body", "approver_card"], "approver_card 와 pin 이 필요합니다")
    return await resolve_manager_approver(session, body.approver_card, body.pin)


async def split_wo(
    session: AsyncSession, key: str, body: S.SplitRequest, principal: Principal
) -> tuple[WorkOrder, WorkOrder]:
    """하위 WO 분할 — 입고 부족·분할 발송(A3-04(b)·B4-04). 라우팅을 그대로 복사하고
    ``parent.qty_ordered`` 를 분할 수량만큼 줄인다. 병합은 없다(B4-04 "병합 금지").

    채번은 ``core.sequence.split_code``(spec §2.1) 를 그대로 쓴다 — 접미사는 재사용하지 않고
    항상 다음 글자를 쓴다(인쇄된 코드 보호), 26개 초과·이미 분할된 WO 재분할은 ``ValueError``
    로 알려온다.
    """
    approver = await _resolve_split_approver(session, principal, body)

    wo = await resolve_wo(session, key)
    if wo.status not in SPLITTABLE:
        raise state_conflict(f"작업지시 상태 {wo.status} — 분할할 수 없습니다")
    if body.qty >= wo.qty_ordered:
        raise validation(
            ["body", "qty"], f"분할 수량은 작업지시 수량({wo.qty_ordered}) 보다 작아야 합니다"
        )
    remaining = wo.qty_ordered - body.qty
    progressed = max(wo.qty_received, wo.qty_good, wo.qty_packed, wo.qty_shipped)
    if remaining < progressed:
        raise ApiError(
            409,
            "STATE_CONFLICT",
            f"이미 진행된 수량({progressed})보다 적게 남기고 분할할 수 없습니다",
        )

    used_suffixes = {
        s
        for s in (
            await session.execute(
                select(WorkOrder.split_suffix).where(WorkOrder.parent_wo_id == wo.id)
            )
        )
        .scalars()
        .all()
        if s is not None  # CHECK split_parent 로 실제로는 항상 non-null (mypy 용)
    }
    try:
        child_code = split_code(wo.code, used_suffixes)
    except ValueError as e:
        if "split limit" in str(e):
            raise ApiError(409, "SPLIT_LIMIT", "분할은 26개(A~Z)를 초과할 수 없습니다") from e
        raise ApiError(
            409, "STATE_CONFLICT", "이미 분할된 작업지시는 다시 분할할 수 없습니다"
        ) from e
    suffix = child_code.rsplit("-", 1)[-1]

    parent_steps = await _steps_of(session, wo)
    now = datetime.now(UTC)
    child = WorkOrder(
        code=child_code,
        parent_wo_id=wo.id,
        split_suffix=suffix,
        so_id=wo.so_id,
        so_line_id=wo.so_line_id,
        item_id=wo.item_id,
        print_method=wo.print_method,
        design_version=wo.design_version,
        qty_ordered=body.qty,
        status="ISSUED",
        issued_at=now,
    )
    session.add(child)
    await session.flush()

    child_steps: list[WoRouteStep] = []
    for i, s in enumerate(sorted(parent_steps, key=lambda x: x.seq)):
        step = WoRouteStep(
            wo_id=child.id,
            seq=s.seq,
            process_code=s.process_code,
            std_lead_hours=s.std_lead_hours,
            tolerance_pct=s.tolerance_pct,
            status="WAITING",
            qty_in=body.qty if i == 0 else None,  # shopfloor ⑧: 1단계 qty_in = 분할 수량
            started_at=now if i == 0 else None,
        )
        session.add(step)
        child_steps.append(step)
    await session.flush()
    recalc.recalc_wo(child, child_steps)

    wo.qty_ordered = remaining
    recalc.recalc_wo(wo, parent_steps)

    so = await session.get(SalesOrder, wo.so_id)
    assert so is not None
    await session.flush()
    await recalc.recalc_so(session, so)

    session.add(
        AuditLog(
            table_name="work_order",
            row_id=wo.id,
            action="UPDATE",
            before=None,
            after={
                "split_reason": body.reason,
                "split_child_code": child.code,
                "split_qty": body.qty,
            },
            user_id=approver.id,
        )
    )

    await session.commit()
    await session.refresh(wo)
    await session.refresh(child)
    return wo, child

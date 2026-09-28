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

import uuid
from collections.abc import Sequence
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
from app.db.models.scan import ScanEvent, ScanEventKey
from app.domain.auth.service import resolve_manager_approver
from app.domain.common.listing import PageParams, paginate, parse_sort, q_filter
from app.domain.master import service as master
from app.domain.order import ports, recalc, so_service
from app.domain.order.views import WoView, load_wo_views, process_names
from app.domain.scan import engine as scan_engine
from app.domain.scan.service import add_stock_txn
from app.ws import broadcast as ws_broadcast

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
# B4-03 (E3): 불량 재작업은 P30 이 이미 끝난 뒤에나 뜻이 있다 — IN_PROGRESS(P30 DONE, 다음
# 단계 대기)·PACKED(포장 뒤에 불량 발견) 까지만 허용. SHIPPED 이후는 반품·클레임 절차라 범위 밖.
REWORKABLE = frozenset({"IN_PROGRESS", "PACKED"})
# E6 (§5.6): 이 액션까지만 replay_steps 로 되돌릴 수 있다 — 파일럿은 DONE 만(engine.py 모듈
# docstring "파일럿(완료 스캔만)의 최소 버전"). RECEIVE/PACK/START 취소는 [확장].
CANCEL_SUPPORTED_ACTIONS = frozenset({"DONE"})
# §13.5 ⑮ 대상 액션 — "마지막 반영 이벤트"를 찾을 때 이 액션들만 후보로 본다(로그인·승인·매핑·
# 취소 자체는 상태를 되돌릴 대상이 아니다)
STATE_CHANGING_ACTIONS = frozenset({"START", "DONE", "RECEIVE", "PACK"})


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
    if delay:
        # 0010 (S4, RISK-S1-1): 캐시 컬럼으로 SQL 필터. 지연 감지 잡(§6.5)이 갱신한다.
        stmt = stmt.where(WorkOrder.delay_risk.is_(True))
    stmt = stmt.order_by(*parse_sort(sort, WO_SORT, default="-due_date"))
    rows, total = await paginate(session, stmt, params)
    return await load_wo_views(session, rows), total


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
    for wo in created:
        await ws_broadcast.broadcast_wo_updated(session, wo)
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
    # api-contract §8: 보류·재개·취소·종결도 /ws/board 대상("…승인·취소·발행·보류")
    await ws_broadcast.broadcast_wo_updated(session, wo)
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
    await ws_broadcast.broadcast_wo_updated(session, wo)
    await ws_broadcast.broadcast_wo_updated(session, child)
    return wo, child


# ======================================================================
# 검색 (KSK-70 라벨 재발행 — WO 검색)
# ======================================================================
async def search_work_orders(session: AsyncSession, q: str, *, limit: int = 30) -> list[WoView]:
    """``GET /wo/search?q=`` (api-contract §7.3, §13.1 admin #5 "wo/search 는 원 §7.3").

    거래처명·SO 코드·품목명으로 찾는다(KSK-70). 2자 미만은 빈 목록(잡음 방지, 화면이
    "2자 이상에서 검색"을 이미 강제하지만 서버도 방어한다)."""
    term = (q or "").strip()
    if len(term) < 2:
        return []
    pattern = f"%{term}%"
    stmt = (
        select(WorkOrder)
        .join(SalesOrder, SalesOrder.id == WorkOrder.so_id)
        .join(Customer, Customer.id == SalesOrder.customer_id)
        .join(Item, Item.id == WorkOrder.item_id)
        .where(
            WorkOrder.code.ilike(pattern)
            | SalesOrder.code.ilike(pattern)
            | Customer.name.ilike(pattern)
            | Item.name.ilike(pattern)
        )
        .order_by(SalesOrder.due_date.asc())
        .limit(limit)
    )
    rows = (await session.execute(stmt)).scalars().all()
    return await load_wo_views(session, rows)


# ======================================================================
# 재작업 (E3, B4-03) — 불량분을 재작업 하위 WO 로 분리
# ======================================================================
async def rework_wo(
    session: AsyncSession, key: str, body: S.ReworkRequest, user: AppUser
) -> tuple[WorkOrder, WorkOrder]:
    """``POST /wo/{id}/rework`` (api-contract §7.3, spec B4-03).

    **설계 결정(계약이 이미 정해 둔 그대로 구현)**: 「불량분을 재작업 LOT 으로 분리 발행」은
    구조적으로 ``/wo/{id}/split`` 과 같다 — 하위 WO(부모의 ``-A``…``-Z`` 접미사 풀을
    공유, "-R" 같은 별도 접미사 없음, §7.3 "재작업 하위 WO(-R 아닌 일반 -A… 접미사)"). 다른
    점은 ① 시작 공정이 P20(입고)이 아니라 P30(``reinsert_p30=true``, 재인쇄) 또는
    P50(``reinsert_p30=false``, 재인쇄 불가 — 바로 포장) 이라는 것과 ② ``qty_ordered`` 가
    분할 잔량이 아니라 새 재작업 수량이라는 것, ③ 부모의 ``qty_ordered`` 를 줄이지 않는다는
    것(불량은 이미 생산된 수량의 일부이지 미생산 잔량이 아니다)뿐이다. 그래서 라우팅
    복사·채번·qty_in 승계는 ``split_wo`` 와 같은 패턴을 재사용한다.

    ``lot`` (InboundLot) 은 이번 구현에서 항상 ``None`` 이다 — 재작업 투입 자재는 이미 회사
    안에 있는 불량품 자체이지 새로 입고되는 자재가 아니라, P20 을 다시 거치지 않고 바로
    P30/P50 에 재삽입한다(``qty_in`` 을 그대로 승계, split_wo 의 "1단계 qty_in = 분할
    수량"과 동일한 논리). 계약의 ``ReworkResponse.lot`` 필드가 optional 인 것도 이 경우를
    예정하고 있다고 본다 — db-schema 에 "재작업용 LOT" 구조가 별도로 정의되어 있지 않다.
    """
    wo = await resolve_wo(session, key)
    if wo.status not in REWORKABLE:
        raise state_conflict(f"작업지시 상태 {wo.status} — 재작업 대상이 아닙니다 (B4-03)")
    if body.qty > wo.qty_bad:
        raise state_conflict(
            f"재작업 수량({body.qty})이 불량 수량({wo.qty_bad})을 초과할 수 없습니다"
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
        if s is not None
    }
    try:
        child_code = split_code(wo.code, used_suffixes)
    except ValueError as e:
        if "split limit" in str(e):
            raise ApiError(
                409, "SPLIT_LIMIT", "분할·재작업은 26개(A~Z)를 초과할 수 없습니다"
            ) from e
        raise ApiError(
            409, "STATE_CONFLICT", "이미 분할된 작업지시는 재작업 하위 WO 를 만들 수 없습니다"
        ) from e
    suffix = child_code.rsplit("-", 1)[-1]

    parent_steps = await _steps_of(session, wo)
    start_code = "P30" if body.reinsert_p30 else "P50"
    start_step = next((s for s in parent_steps if s.process_code == start_code), None)
    if start_step is None:
        raise state_conflict(
            f"이 작업지시 라우팅에는 {start_code} 단계가 없어 재작업할 수 없습니다"
        )
    carried = [s for s in sorted(parent_steps, key=lambda x: x.seq) if s.seq >= start_step.seq]

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
    for i, s in enumerate(carried):
        step = WoRouteStep(
            wo_id=child.id,
            seq=i + 1,
            process_code=s.process_code,
            std_lead_hours=s.std_lead_hours,
            tolerance_pct=s.tolerance_pct,
            status="WAITING",
            qty_in=body.qty if i == 0 else None,
            started_at=now if i == 0 else None,
        )
        session.add(step)
        child_steps.append(step)
    await session.flush()
    recalc.recalc_wo(child, child_steps)

    await add_stock_txn(
        session,
        wo.item_id,
        body.qty,
        txn_type="REWORK",
        ref_type="WORK_ORDER",
        ref_id=child.id,
        created_by=user.id,
        reason=body.reason,
    )

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
                "rework_reason": body.reason,
                "rework_child_code": child.code,
                "rework_qty": body.qty,
                "reinsert_p30": body.reinsert_p30,
            },
            user_id=user.id,
        )
    )

    await session.commit()
    await session.refresh(wo)
    await session.refresh(child)
    await ws_broadcast.broadcast_wo_updated(session, wo)
    await ws_broadcast.broadcast_wo_updated(session, child)
    return wo, child


# ======================================================================
# E6 취소 — 관리자 웹 전용 (§5.6, §13.4 admin #28)
# ======================================================================
def _wo_step_snapshots(
    steps: Sequence[WoRouteStep], names: dict[str, str]
) -> tuple[scan_engine.StepSnapshot, ...]:
    return tuple(
        scan_engine.StepSnapshot(
            seq=s.seq,
            process_code=s.process_code,
            process_name=names.get(s.process_code, s.process_code),
            status=s.status,
            qty_in=s.qty_in,
            qty_good=s.qty_good,
            qty_bad=s.qty_bad,
            tolerance_pct=s.tolerance_pct,
        )
        for s in sorted(steps, key=lambda x: x.seq)
    )


async def _last_reflected_event(session: AsyncSession, wo_id: int) -> ScanEvent | None:
    """§5.6 "해당 WO 의 마지막 반영 이벤트만". ``scan_event`` 에는 "실제로 상태를 바꿨는지"를
    나타내는 컬럼이 없다(PENDING·NOOP·APPLY 가 전부 같은 스키마다) — ``approval_status`` 가
    PENDING 인 것(아직 미반영)과 ``result_msg`` 가 60초 중복 문구("이미 처리됨", 반영 안 됨)인
    것을 뺀 나머지 중 가장 최근을 "마지막 반영"으로 본다. 그래도 걸러내지 못하는 극단적인
    동시성 케이스는 실패를 닫힌 쪽(취소 거부)으로 만든다 — 조용히 잘못된 상태를 되돌리는 것보다
    안전하다(보고: E6 리포트 "이벤트 반영 여부 플래그 없음" 참고).
    """
    stmt = (
        select(ScanEvent)
        .where(
            ScanEvent.wo_id == wo_id,
            ScanEvent.action.in_(STATE_CHANGING_ACTIONS),
            ScanEvent.result != "REJECT",
            ScanEvent.approval_status != "PENDING",
            ScanEvent.result_msg != "이미 처리됨",
        )
        .order_by(ScanEvent.received_at.desc())
        .limit(1)
    )
    return (await session.execute(stmt)).scalars().first()


async def cancel_wo_event(
    session: AsyncSession, key: str, event_uuid: uuid.UUID, reason: str, user: AppUser
) -> WorkOrder:
    """``POST /wo/{id}/events/{event_uuid}/cancel`` (admin #28 · §5.6).

    JWT 인증(MANAGER/ADMIN, 라우터의 ``require_roles`` 가 보장)이 곧 승인이라 별도 승인
    단계 없이 즉시 ``APPROVED`` 로 CANCEL 이벤트를 남기고 리플레이한다. 원본 이벤트는
    그대로 둔다(append-only, "원본 삭제 없음" B4-06) — ``compensates_uuid`` 로만 연결한다.
    엔진의 ``replay_steps``(파일럿: DONE 만) 를 재사용한다 — 다시 구현하지 않는다.
    """
    wo = await resolve_wo(session, key)
    scan_key = await session.get(ScanEventKey, event_uuid)
    if scan_key is None:
        raise not_found("EVENT_NOT_FOUND", "스캔 이벤트", str(event_uuid))
    ev = await session.get(ScanEvent, (scan_key.event_id, scan_key.received_at))
    if ev is None or ev.wo_id != wo.id:
        raise not_found("EVENT_NOT_FOUND", "스캔 이벤트", str(event_uuid))
    already = (
        await session.execute(
            select(ScanEvent.event_uuid).where(ScanEvent.compensates_uuid == event_uuid)
        )
    ).scalar_one_or_none()
    if already is not None:
        raise state_conflict("이미 취소된 이벤트입니다")
    if (
        ev.result == "REJECT"
        or ev.approval_status == "PENDING"
        or ev.action not in STATE_CHANGING_ACTIONS
    ):
        raise state_conflict("취소할 수 없는 이벤트입니다 (반영되지 않았거나 대상 액션이 아닙니다)")

    last = await _last_reflected_event(session, wo.id)
    if last is None or last.event_uuid != ev.event_uuid:
        raise state_conflict("해당 작업지시의 마지막 반영 이벤트만 취소할 수 있습니다 (B4-06)")
    if ev.action not in CANCEL_SUPPORTED_ACTIONS:
        raise state_conflict(
            f"이 액션({ev.action})의 취소는 아직 지원하지 않습니다 — 완료(DONE) 스캔만 "
            "취소할 수 있습니다(파일럿 범위, engine.replay_steps)"
        )
    if ev.process_code is None:
        raise state_conflict("취소 대상 이벤트에 공정 정보가 없습니다")

    steps = await _steps_of(session, wo)
    names = await process_names(session)
    target = next((s for s in steps if s.process_code == ev.process_code), None)
    if target is None:
        raise state_conflict("취소 대상 공정을 찾을 수 없습니다")

    baseline = tuple(
        (
            scan_engine.StepSnapshot(
                seq=s.seq,
                process_code=s.process_code,
                process_name=names.get(s.process_code, s.process_code),
                status="WAITING",
                qty_in=s.qty_in,
                qty_good=None,
                qty_bad=None,
                tolerance_pct=s.tolerance_pct,
            )
            if s.id == target.id
            else scan_engine.StepSnapshot(
                seq=s.seq,
                process_code=s.process_code,
                process_name=names.get(s.process_code, s.process_code),
                status=s.status,
                qty_in=s.qty_in,
                qty_good=s.qty_good,
                qty_bad=s.qty_bad,
                tolerance_pct=s.tolerance_pct,
            )
        )
        for s in sorted(steps, key=lambda x: x.seq)
    )
    survivors = (
        (
            await session.execute(
                select(ScanEvent)
                .where(
                    ScanEvent.wo_id == wo.id,
                    ScanEvent.process_code == ev.process_code,
                    ScanEvent.action == "DONE",
                    ScanEvent.result != "REJECT",
                    ScanEvent.event_uuid != ev.event_uuid,
                )
                .order_by(ScanEvent.received_at)
            )
        )
        .scalars()
        .all()
    )
    applied = tuple(
        scan_engine.AppliedEvent(
            process_code=s.process_code or "",
            action=s.action,
            qty_good=s.qty_good,
            qty_bad=s.qty_bad,
            result=s.result,
        )
        for s in survivors
    )
    replayed = scan_engine.replay_steps(baseline, applied)
    new_target = next(s for s in replayed if s.seq == target.seq)
    target.status = new_target.status
    target.qty_good = new_target.qty_good
    target.qty_bad = new_target.qty_bad
    if new_target.status in ("DONE", "DONE_ESTIMATED"):
        target.done_at = datetime.now(UTC)
    else:
        target.done_at = None
    if new_target.status == "WAITING":
        target.started_at = None
        target.variance_reason = None

    now = datetime.now(UTC)
    cancel_ev = ScanEvent(
        event_uuid=uuid.uuid4(),
        scanned_at=now,
        received_at=now,
        station_id=ev.station_id,
        process_code=ev.process_code,
        worker_id=user.id,
        target_type="WO",
        target_code=wo.code,
        action="CANCEL",
        payload={"reason": reason, "compensates": str(event_uuid)},
        result="OK",
        result_msg=f"관리자 취소: {reason}",
        approval_status="APPROVED",
        compensates_uuid=event_uuid,
        wo_id=wo.id,
    )
    session.add(cancel_ev)

    await session.flush()
    recalc.recalc_wo(wo, steps)
    so = await session.get(SalesOrder, wo.so_id)
    assert so is not None
    await recalc.recalc_so(session, so)

    session.add(
        AuditLog(
            table_name="scan_event",
            row_key=str(event_uuid),
            action="APPROVE",
            before=None,
            after={"decision": "CANCEL", "reason": reason},
            user_id=user.id,
        )
    )

    await session.commit()
    await session.refresh(wo)
    await ws_broadcast.broadcast_wo_updated(session, wo)
    return wo

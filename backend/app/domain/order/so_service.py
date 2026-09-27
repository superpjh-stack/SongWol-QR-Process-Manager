"""수주 서비스 (api-contract §7.3 · §13.4 · spec §5.2 A2-01/05/06/07).

- 등록: SO 채번(``next_code('SO')``), 배송지는 ``address_id`` 스냅샷 또는 ``ship_to`` 직접 입력,
  라인은 품목·가공방식·수량(·단가). 도안은 등록 후 ADM-14 에서 올린다.
- 변경(A2-05 최소): 미착수(WO 없음 또는 ISSUED 1건) 라인만 반영. 착수 WO 가 있으면 409
  ``STATE_CONFLICT``.
- 취소(A2-06): 미착수 WO(DRAFT/ISSUED) 일괄 CANCELLED, 착수 WO 는 pending 목록으로 돌려준다
  (admin #27 ``SoCancelResponse``).
- 상태 전이 OPEN → IN_PROGRESS 는 첫 ``issue-wo`` (wo_service), 그 뒤는 ``recalc.recalc_so``.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.schemas import order as S
from app.api.v1.schemas.common import normalize_code
from app.core.errors import not_found, state_conflict, validation
from app.core.sequence import TZ_SEOUL, next_code
from app.db.models.master import AppUser, Customer, Item, PrintMethod
from app.db.models.order import Design, SalesOrder, SalesOrderLine, WorkOrder, WoRouteStep
from app.domain.common.listing import PageParams, paginate, parse_sort, q_filter
from app.domain.master import service as master
from app.domain.order import recalc
from app.domain.order.views import SoView, load_so_views

# admin #4 · #5 · §14.6: so 기본 정렬 due_date 오름차순(납기 임박순)
SO_SORT: dict[str, Any] = {
    "due_date": SalesOrder.due_date,
    "order_date": SalesOrder.order_date,
    "code": SalesOrder.code,
    "status": SalesOrder.status,
    "progress_pct": SalesOrder.progress_pct,
    "updated_at": SalesOrder.updated_at,
}
SO_Q = (SalesOrder.code, Customer.name, SalesOrder.memo)

SO_EDITABLE = frozenset({"OPEN", "IN_PROGRESS", "PARTIAL_SHIPPED"})
SO_CANCELLABLE = frozenset({"OPEN", "IN_PROGRESS", "PARTIAL_SHIPPED"})
WO_NOT_STARTED = frozenset({"DRAFT", "ISSUED"})
WO_STARTED_PENDING = frozenset({"IN_PROGRESS", "PACKED", "ON_HOLD"})


def today_kst() -> date:
    return datetime.now(UTC).astimezone(TZ_SEOUL).date()


# ======================================================================
# 조회
# ======================================================================
async def resolve_so(session: AsyncSession, key: str) -> SalesOrder:
    """``{id|code}`` (api-contract §11-1). 숫자면 PK, 아니면 코드(정규화 후)."""
    stmt = select(SalesOrder)
    if key.isdigit():
        stmt = stmt.where(SalesOrder.id == int(key))
    else:
        stmt = stmt.where(SalesOrder.code == normalize_code(key))
    so = (await session.execute(stmt)).scalar_one_or_none()
    if so is None:
        raise not_found("SO_NOT_FOUND", "수주", key)
    return so


async def get_so_view(session: AsyncSession, key: str) -> SoView:
    so = await resolve_so(session, key)
    return (await load_so_views(session, [so]))[0]


async def list_sales_orders(
    session: AsyncSession,
    params: PageParams,
    *,
    from_: date | None,
    to: date | None,
    customer_id: int | None,
    status: str | None,
    due_within_days: int | None,
    delay: bool,
    q: str | None,
    sort: str | None,
) -> tuple[list[SoView], int]:
    """ADM-12. ``delay=true`` 는 지연 판정(§6.5)이 단계 데이터에 걸려 있어 후보를 다 읽은 뒤
    Python 에서 거른다 (파일럿 규모 — 활성 수주 수백 건).
    """
    stmt = select(SalesOrder).join(Customer, Customer.id == SalesOrder.customer_id)
    if from_ is not None:
        stmt = stmt.where(SalesOrder.order_date >= from_)
    if to is not None:
        stmt = stmt.where(SalesOrder.order_date <= to)
    if customer_id is not None:
        stmt = stmt.where(SalesOrder.customer_id == customer_id)
    if status:
        stmt = stmt.where(SalesOrder.status == status.upper())
    if due_within_days is not None:
        stmt = stmt.where(
            SalesOrder.due_date <= today_kst() + timedelta(days=due_within_days),
            SalesOrder.status.not_in(("SHIPPED", "CLOSED", "CANCELLED")),
        )
    if (f := q_filter(q, SO_Q)) is not None:
        stmt = stmt.where(f)
    stmt = stmt.order_by(*parse_sort(sort, SO_SORT))

    if not delay:
        rows, total = await paginate(session, stmt, params)
        return await load_so_views(session, rows), total

    stmt = stmt.where(SalesOrder.status.in_(("OPEN", "IN_PROGRESS", "PARTIAL_SHIPPED")))
    rows = list((await session.execute(stmt)).scalars().all())
    views = [v for v in await load_so_views(session, rows) if v.delay_risk]
    return views[params.offset : params.offset + params.size], len(views)


# ======================================================================
# 등록
# ======================================================================
async def _snapshot_ship_to(
    session: AsyncSession, customer: Customer, body: S.SalesOrderCreate
) -> dict[str, Any]:
    if body.address_id is not None:
        addr = await master.get_address(session, customer.id, body.address_id)
        if not addr.active:
            raise validation(["body", "address_id"], "비활성 배송지입니다")
        return S.ShipTo(
            receiver=addr.receiver,
            phone=addr.phone,
            postal_code=addr.postal_code,
            address1=addr.address1,
            address2=addr.address2,
        ).model_dump()
    assert body.ship_to is not None  # model_validator 가 보장
    return body.ship_to.model_dump()


async def _check_line_refs(
    session: AsyncSession, lines: list[S.SalesOrderLineInput]
) -> tuple[dict[int, Item], dict[str, PrintMethod]]:
    items = {
        i.id: i
        for i in (
            await session.execute(select(Item).where(Item.id.in_({ln.item_id for ln in lines})))
        ).scalars()
    }
    pms = {
        p.code: p
        for p in (
            await session.execute(
                select(PrintMethod).where(PrintMethod.code.in_({ln.print_method for ln in lines}))
            )
        ).scalars()
    }
    for idx, ln in enumerate(lines):
        item = items.get(ln.item_id)
        if item is None:
            raise not_found("ITEM_NOT_FOUND", "품목", ln.item_id)
        if not item.active:
            raise validation(["body", "lines", idx, "item_id"], f"비활성 품목입니다: {item.code}")
        pm = pms.get(ln.print_method)
        if pm is None:
            raise not_found("PRINT_METHOD_NOT_FOUND", "가공방식", ln.print_method)
        if not pm.active:
            raise validation(
                ["body", "lines", idx, "print_method"], f"비활성 가공방식입니다: {pm.code}"
            )
    return items, pms


def _line_values(ln: S.SalesOrderLineInput) -> dict[str, Any]:
    return {
        "item_id": ln.item_id,
        "print_method": ln.print_method,
        "qty": ln.qty,
        "unit_price": Decimal(str(ln.unit_price)) if ln.unit_price is not None else None,
    }


async def create_sales_order(
    session: AsyncSession, body: S.SalesOrderCreate, user: AppUser
) -> SalesOrder:
    customer = await master.get_customer(session, body.customer_id)
    if not customer.active:
        raise validation(["body", "customer_id"], f"비활성 거래처입니다: {customer.code}")
    ship_to = await _snapshot_ship_to(session, customer, body)
    await _check_line_refs(session, body.lines)

    so = SalesOrder(
        code=await next_code(session, "SO"),
        customer_id=customer.id,
        order_date=body.order_date,
        due_date=body.due_date,
        ship_to=ship_to,
        status="OPEN",
        progress_pct=Decimal(0),
        memo=body.memo,
        created_by=user.id,
    )
    session.add(so)
    await session.flush()
    for no, ln in enumerate(body.lines, start=1):
        session.add(SalesOrderLine(so_id=so.id, line_no=no, **_line_values(ln)))
    await session.commit()
    await session.refresh(so)
    return so


# ======================================================================
# 변경 (A2-05 최소)
# ======================================================================
async def _wos_by_line(session: AsyncSession, so_id: int) -> dict[int, list[WorkOrder]]:
    rows = (
        (
            await session.execute(
                select(WorkOrder).where(WorkOrder.so_id == so_id, WorkOrder.status != "CANCELLED")
            )
        )
        .scalars()
        .all()
    )
    out: dict[int, list[WorkOrder]] = {}
    for w in rows:
        out.setdefault(w.so_line_id, []).append(w)
    return out


async def _apply_qty_to_unstarted_wo(session: AsyncSession, wo: WorkOrder, qty: int) -> None:
    """미착수(ISSUED) WO 1건에 수량 변경 반영: qty_ordered · 1단계(P20) qty_in (shopfloor ⑧)."""
    wo.qty_ordered = qty
    first = (
        await session.execute(
            select(WoRouteStep).where(WoRouteStep.wo_id == wo.id).order_by(WoRouteStep.seq).limit(1)
        )
    ).scalar_one_or_none()
    if first is not None:
        first.qty_in = qty


async def update_sales_order(
    session: AsyncSession, key: str, body: S.SalesOrderUpdate, user: AppUser
) -> SalesOrder:
    so = await resolve_so(session, key)
    if so.status not in SO_EDITABLE:
        raise state_conflict(f"수주 상태 {so.status} — 변경할 수 없습니다")
    data = body.model_dump(exclude_unset=True)
    if "due_date" in data:
        if data["due_date"] is None:
            raise validation(["body", "due_date"], "납기일은 비울 수 없습니다")
        so.due_date = data["due_date"]
    if "ship_to" in data:
        if body.ship_to is None:
            raise validation(["body", "ship_to"], "배송지는 비울 수 없습니다")
        so.ship_to = body.ship_to.model_dump()
    if "memo" in data:
        so.memo = data["memo"]

    if body.lines is not None:
        await _check_line_refs(session, body.lines)
        existing = {
            ln.id: ln
            for ln in (
                await session.execute(select(SalesOrderLine).where(SalesOrderLine.so_id == so.id))
            ).scalars()
        }
        wos_by_line = await _wos_by_line(session, so.id)
        seen: set[int] = set()
        for idx, inp in enumerate(body.lines):
            if inp.id is None:
                continue
            ln = existing.get(inp.id)
            if ln is None:
                raise validation(
                    ["body", "lines", idx, "id"], f"수주 {so.code} 에 라인 {inp.id} 이(가) 없습니다"
                )
            if inp.id in seen:
                raise validation(["body", "lines", idx, "id"], "같은 라인이 두 번 있습니다")
            seen.add(inp.id)
            wos = wos_by_line.get(ln.id, [])
            core_changed = (
                inp.item_id != ln.item_id
                or inp.print_method != ln.print_method
                or inp.qty != ln.qty
            )
            if core_changed and wos:
                started = [w.code for w in wos if w.status not in WO_NOT_STARTED]
                if started:
                    raise state_conflict(
                        f"라인 #{ln.line_no} 은 착수한 WO {', '.join(started)} 가 있어 "
                        "변경할 수 없습니다 (경고·이력만, A2-05)",
                        [{"line_id": ln.id, "work_orders": started}],
                    )
                if inp.item_id != ln.item_id or inp.print_method != ln.print_method:
                    raise state_conflict(
                        f"라인 #{ln.line_no} 은 발행된 WO 가 있어 품목·가공방식을 바꿀 수 없습니다",
                        [{"line_id": ln.id, "work_orders": [w.code for w in wos]}],
                    )
                if len(wos) != 1:
                    raise state_conflict(
                        f"라인 #{ln.line_no} 은 WO 가 {len(wos)}건으로 분리되어 있어 수량을 자동 "
                        "반영할 수 없습니다 — WO 별로 처리하세요",
                        [{"line_id": ln.id, "work_orders": [w.code for w in wos]}],
                    )
                await _apply_qty_to_unstarted_wo(session, wos[0], inp.qty)
            for k, v in _line_values(inp).items():
                setattr(ln, k, v)
        # 목록에서 빠진 기존 라인은 삭제 — WO·도안이 걸려 있으면 409
        removed = [ln for ln in existing.values() if ln.id not in seen]
        design_line_ids = set(
            (
                await session.execute(
                    select(Design.so_line_id).where(
                        Design.so_line_id.in_([ln.id for ln in removed] or [0])
                    )
                )
            )
            .scalars()
            .all()
        )
        all_wo_line_ids = set(
            (await session.execute(select(WorkOrder.so_line_id).where(WorkOrder.so_id == so.id)))
            .scalars()
            .all()
        )
        for ln in removed:
            if ln.id in all_wo_line_ids:
                raise state_conflict(
                    f"라인 #{ln.line_no} 은 WO 가 있어 삭제할 수 없습니다", [{"line_id": ln.id}]
                )
            if ln.id in design_line_ids:
                raise state_conflict(
                    f"라인 #{ln.line_no} 은 도안이 등록되어 있어 삭제할 수 없습니다",
                    [{"line_id": ln.id}],
                )
            await session.delete(ln)
        await session.flush()
        # 삭제된 번호는 재사용하지 않는다 (작업지시서·도안 경로가 line_no 를 참조)
        next_no = max((ln.line_no for ln in existing.values()), default=0) + 1
        for inp in body.lines:
            if inp.id is None:
                session.add(SalesOrderLine(so_id=so.id, line_no=next_no, **_line_values(inp)))
                next_no += 1
    await session.commit()
    await session.refresh(so)
    return so


# ======================================================================
# 취소 (A2-06 · admin #27)
# ======================================================================
async def cancel_sales_order(
    session: AsyncSession, key: str, reason: str, user: AppUser
) -> tuple[SalesOrder, list[str], list[WorkOrder]]:
    so = await resolve_so(session, key)
    if so.status not in SO_CANCELLABLE:
        raise state_conflict(f"수주 상태 {so.status} — 취소할 수 없습니다")
    wos = (await session.execute(select(WorkOrder).where(WorkOrder.so_id == so.id))).scalars().all()
    cancelled: list[str] = []
    pending: list[WorkOrder] = []
    for w in wos:
        if w.status in WO_NOT_STARTED:
            w.status = "CANCELLED"
            w.hold_reason = reason  # 취소 사유 저장처 (db-schema 에 wo.cancel_reason 없음 → 보고)
            cancelled.append(w.code)
        elif w.status in WO_STARTED_PENDING:
            pending.append(w)
    so.status = "CANCELLED"
    so.cancel_reason = reason
    so.cancelled_at = datetime.now(UTC)
    so.cancelled_by = user.id
    await session.commit()
    await session.refresh(so)
    return so, cancelled, pending


async def get_line(session: AsyncSession, so: SalesOrder, line_id: int) -> SalesOrderLine:
    ln = (
        await session.execute(
            select(SalesOrderLine).where(
                SalesOrderLine.id == line_id, SalesOrderLine.so_id == so.id
            )
        )
    ).scalar_one_or_none()
    if ln is None:
        # §14.2 규칙 `{ENTITY}_NOT_FOUND` — 표에 행 추가 필요 (보고)
        raise not_found("SO_LINE_NOT_FOUND", f"수주 {so.code} 의 라인", line_id)
    return ln


__all__ = [
    "cancel_sales_order",
    "create_sales_order",
    "get_line",
    "get_so_view",
    "list_sales_orders",
    "recalc",
    "resolve_so",
    "update_sales_order",
]

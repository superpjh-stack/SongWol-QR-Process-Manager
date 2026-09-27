"""ORM → 응답 스키마 조립 (SalesOrder* · WorkOrder* · RouteStep · ScanEventSummary).

여러 엔드포인트가 같은 모양을 돌려주므로 여기 한 곳에서만 만든다 (재활용 원칙).
관련 행(거래처·품목·사용자·공정·설비·도안·단계)은 목록 단위로 한 번에 읽는다 (N+1 회피).
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.schemas import order as S
from app.api.v1.schemas.common import IdRef
from app.api.v1.schemas.master import UserSummary
from app.api.v1.schemas.material import ReceiptSummary
from app.api.v1.schemas.scan import ScanEventSummary
from app.api.v1.schemas.shipping import PackBoxSummary
from app.db.base import Base
from app.db.models.master import AppUser, Customer, Equipment, Item, Process
from app.db.models.material import InboundLot, MaterialReceipt
from app.db.models.order import (
    Design,
    SalesOrder,
    SalesOrderLine,
    StepWork,
    WorkOrder,
    WoRouteStep,
)
from app.db.models.scan import ScanEvent
from app.db.models.shipping import PackBox
from app.domain.master.admin_service import user_summary
from app.domain.order import recalc

RECENT_EVENTS = 20


# ======================================================================
# 공통 로더
# ======================================================================
async def load_by_id[M: Base](
    session: AsyncSession, model: type[M], ids: Iterable[int | None]
) -> dict[int, M]:
    """PK 목록 → {id: row}. None 은 무시."""
    wanted = {i for i in ids if i is not None}
    if not wanted:
        return {}
    id_col: Any = model.id  # type: ignore[attr-defined]
    rows = (await session.execute(select(model).where(id_col.in_(wanted)))).scalars().all()
    return {int(r.id): r for r in rows}  # type: ignore[attr-defined]


async def process_names(session: AsyncSession) -> dict[str, str]:
    rows = (await session.execute(select(Process.code, Process.name))).all()
    return {code: name for code, name in rows}


def item_ref(i: Item) -> S.ItemRef:
    return S.ItemRef(id=i.id, code=i.code, name=i.name, spec=i.spec, color=i.color)


def customer_ref(c: Customer) -> IdRef:
    return IdRef(id=c.id, code=c.code, name=c.name)


def equipment_ref(e: Equipment) -> IdRef:
    return IdRef(id=e.id, code=e.code, name=e.name)


def design_file_url(design_id: int) -> str:
    return f"/api/v1/designs/{design_id}/file"


def design_thumb_url(d: Design) -> str | None:
    return f"/api/v1/designs/{d.id}/thumbnail" if d.thumbnail_path else None


def design_out(d: Design) -> S.Design:
    return S.Design(
        id=d.id,
        so_line_id=d.so_line_id,
        version=d.version,
        file_url=design_file_url(d.id),
        thumbnail_url=design_thumb_url(d),
        confirmed_at=d.confirmed_at,
        is_current=d.is_current,
        created_at=d.created_at,
    )


# ======================================================================
# WO
# ======================================================================
@dataclass(slots=True)
class WoView:
    wo: WorkOrder
    so: SalesOrder
    customer: Customer
    item: Item
    steps: list[WoRouteStep]
    parent_code: str | None
    thumb_url: str | None
    delay_risk: bool = False


async def load_wo_views(
    session: AsyncSession, wos: Sequence[WorkOrder], *, now: datetime | None = None
) -> list[WoView]:
    if not wos:
        return []
    t = now or datetime.now(UTC)
    so_map = await load_by_id(session, SalesOrder, (w.so_id for w in wos))
    cust_map = await load_by_id(session, Customer, (s.customer_id for s in so_map.values()))
    item_map = await load_by_id(session, Item, (w.item_id for w in wos))
    parent_map = await load_by_id(
        session, WorkOrder, (w.parent_wo_id for w in wos if w.parent_wo_id is not None)
    )
    step_rows = (
        (
            await session.execute(
                select(WoRouteStep)
                .where(WoRouteStep.wo_id.in_([w.id for w in wos]))
                .order_by(WoRouteStep.wo_id, WoRouteStep.seq)
            )
        )
        .scalars()
        .all()
    )
    steps_by_wo: dict[int, list[WoRouteStep]] = {}
    for s in step_rows:
        steps_by_wo.setdefault(s.wo_id, []).append(s)
    # 발행 시점 도안(design_version) 의 썸네일
    keys = [(w.so_line_id, w.design_version) for w in wos if w.design_version is not None]
    thumb_by_key: dict[tuple[int, int], str | None] = {}
    if keys:
        drows = (
            (
                await session.execute(
                    select(Design).where(
                        Design.so_line_id.in_({k[0] for k in keys}),
                        Design.version.in_({k[1] for k in keys}),
                    )
                )
            )
            .scalars()
            .all()
        )
        for d in drows:
            thumb_by_key[(d.so_line_id, d.version)] = design_thumb_url(d)
    out: list[WoView] = []
    for w in wos:
        so = so_map[w.so_id]
        steps = steps_by_wo.get(w.id, [])
        parent = parent_map.get(w.parent_wo_id) if w.parent_wo_id is not None else None
        thumb = (
            thumb_by_key.get((w.so_line_id, w.design_version))
            if w.design_version is not None
            else None
        )
        out.append(
            WoView(
                wo=w,
                so=so,
                customer=cust_map[so.customer_id],
                item=item_map[w.item_id],
                steps=steps,
                parent_code=parent.code if parent else None,
                thumb_url=thumb,
                delay_risk=recalc.wo_delay_risk(w, steps, so.due_date, t),
            )
        )
    return out


def wo_summary(v: WoView, *, with_thumbnail: bool = True) -> S.WorkOrderSummary:
    w = v.wo
    cur = next((s for s in v.steps if s.seq == w.current_step_seq), None)
    return S.WorkOrderSummary(
        id=w.id,
        code=w.code,
        so_code=v.so.code,
        customer_name=v.customer.name,
        item=item_ref(v.item),
        print_method=w.print_method,
        qty_ordered=w.qty_ordered,
        qty_received=w.qty_received,
        qty_good=w.qty_good,
        qty_bad=w.qty_bad,
        qty_packed=w.qty_packed,
        qty_shipped=w.qty_shipped,
        receipt_status=w.receipt_status,
        status=w.status,
        current_step_seq=w.current_step_seq,
        current_process_code=cur.process_code if cur else None,
        due_date=v.so.due_date,
        delay_risk=v.delay_risk,
        design_version=w.design_version,
        design_thumbnail_url=v.thumb_url if with_thumbnail else None,
        parent_wo_code=v.parent_code,
        split_suffix=w.split_suffix,
        issued_at=w.issued_at,
    )


@dataclass(slots=True)
class StepCtx:
    """단계 상세 조립에 필요한 참조 행."""

    processes: dict[str, str]
    equipment: dict[int, Equipment]
    users: dict[int, AppUser]
    works: dict[int, list[StepWork]] = field(default_factory=dict)


async def load_step_ctx(session: AsyncSession, steps: Sequence[WoRouteStep]) -> StepCtx:
    step_ids = [s.id for s in steps]
    works: dict[int, list[StepWork]] = {}
    if step_ids:
        wrows = (
            (
                await session.execute(
                    select(StepWork)
                    .where(StepWork.route_step_id.in_(step_ids))
                    .order_by(StepWork.route_step_id, StepWork.seq)
                )
            )
            .scalars()
            .all()
        )
        for wk in wrows:
            works.setdefault(wk.route_step_id, []).append(wk)
    all_works = [wk for ws in works.values() for wk in ws]
    equip_ids = [s.equipment_id for s in steps if s.equipment_id is not None] + [
        wk.equipment_id for wk in all_works
    ]
    user_ids = (
        [s.worker_id for s in steps if s.worker_id is not None]
        + [s.approved_by for s in steps if s.approved_by is not None]
        + [wk.worker_id for wk in all_works]
    )
    return StepCtx(
        processes=await process_names(session),
        equipment=await load_by_id(session, Equipment, equip_ids),
        users=await load_by_id(session, AppUser, user_ids),
        works=works,
    )


def _user_or_none(users: dict[int, AppUser], uid: int | None) -> UserSummary | None:
    return user_summary(users[uid]) if uid is not None and uid in users else None


def route_step_out(s: WoRouteStep, ctx: StepCtx) -> S.RouteStep:
    return S.RouteStep(
        id=s.id,
        seq=s.seq,
        process_code=s.process_code,
        process_name=ctx.processes.get(s.process_code, s.process_code),
        std_lead_hours=float(s.std_lead_hours),
        tolerance_pct=float(s.tolerance_pct),
        status=s.status,
        started_at=s.started_at,
        done_at=s.done_at,
        qty_in=s.qty_in,
        qty_good=s.qty_good,
        qty_bad=s.qty_bad,
        equipment=equipment_ref(ctx.equipment[s.equipment_id])
        if s.equipment_id is not None and s.equipment_id in ctx.equipment
        else None,
        worker=_user_or_none(ctx.users, s.worker_id),
        is_estimated=s.is_estimated,
        approved_by=_user_or_none(ctx.users, s.approved_by),
        variance_reason=s.variance_reason,
        works=[
            S.StepWork(
                id=wk.id,
                seq=wk.seq,
                equipment=equipment_ref(ctx.equipment[wk.equipment_id]),
                worker=user_summary(ctx.users[wk.worker_id]),
                started_at=wk.started_at,
                done_at=wk.done_at,
                qty_good=wk.qty_good,
                qty_bad=wk.qty_bad,
            )
            for wk in ctx.works.get(s.id, [])
        ],
    )


async def wo_out(session: AsyncSession, v: WoView) -> S.WorkOrder:
    ctx = await load_step_ctx(session, v.steps)
    base = wo_summary(v).model_dump()
    return S.WorkOrder(
        **base,
        steps=[route_step_out(s, ctx) for s in v.steps],
        hold_reason=v.wo.hold_reason,
        closed_at=v.wo.closed_at,
    )


async def wo_outs(session: AsyncSession, views: Sequence[WoView]) -> list[S.WorkOrder]:
    all_steps = [s for v in views for s in v.steps]
    ctx = await load_step_ctx(session, all_steps)
    return [
        S.WorkOrder(
            **wo_summary(v).model_dump(),
            steps=[route_step_out(s, ctx) for s in v.steps],
            hold_reason=v.wo.hold_reason,
            closed_at=v.wo.closed_at,
        )
        for v in views
    ]


async def event_outs(session: AsyncSession, events: Sequence[ScanEvent]) -> list[ScanEventSummary]:
    users = await load_by_id(session, AppUser, (e.worker_id for e in events if e.worker_id))
    equip = await load_by_id(session, Equipment, (e.equipment_id for e in events if e.equipment_id))
    return [
        ScanEventSummary(
            event_uuid=e.event_uuid,
            scanned_at=e.scanned_at,
            received_at=e.received_at,
            station_id=e.station_id,
            process_code=e.process_code,
            worker=_user_or_none(users, e.worker_id),
            target_type=e.target_type,
            target_code=e.target_code,
            action=e.action,
            qty_good=e.qty_good,
            qty_bad=e.qty_bad,
            qty_box=e.qty_box,
            equipment=equipment_ref(equip[e.equipment_id])
            if e.equipment_id is not None and e.equipment_id in equip
            else None,
            result=e.result,
            result_msg=e.result_msg,
            approval_status=e.approval_status,
            compensates_uuid=e.compensates_uuid,
            payload=dict(e.payload or {}),
        )
        for e in events
    ]


async def wo_recent_events(session: AsyncSession, wo_id: int) -> list[ScanEvent]:
    rows = (
        await session.execute(
            select(ScanEvent)
            .where(ScanEvent.wo_id == wo_id)
            .order_by(ScanEvent.received_at.desc())
            .limit(RECENT_EVENTS)
        )
    ).scalars()
    return list(rows.all())


async def wo_boxes(session: AsyncSession, wo: WorkOrder) -> list[PackBoxSummary]:
    rows = (
        (
            await session.execute(
                select(PackBox).where(PackBox.wo_id == wo.id).order_by(PackBox.box_no)
            )
        )
        .scalars()
        .all()
    )
    return [
        PackBoxSummary(
            id=b.id,
            code=b.code,
            wo_code=wo.code,
            box_no=b.box_no,
            qty=b.qty,
            packed_at=b.packed_at,
            shipment_id=b.shipment_id,
        )
        for b in rows
    ]


async def wo_receipts(session: AsyncSession, wo: WorkOrder) -> list[ReceiptSummary]:
    rows = (
        await session.execute(
            select(MaterialReceipt, InboundLot)
            .join(InboundLot, InboundLot.id == MaterialReceipt.lot_id)
            .where(MaterialReceipt.wo_id == wo.id)
            .order_by(MaterialReceipt.received_at.desc())
        )
    ).all()
    items = await load_by_id(session, Item, (r.item_id for r, _ in rows))
    users = await load_by_id(session, AppUser, (r.worker_id for r, _ in rows))
    return [
        ReceiptSummary(
            id=r.id,
            wo_code=wo.code,
            item=IdRef(
                id=items[r.item_id].id, code=items[r.item_id].code, name=items[r.item_id].name
            ),
            lot_code=lot.code,
            qty=r.qty,
            box_count=r.box_count,
            inspection=r.inspection,
            received_at=r.received_at,
            worker=user_summary(users[r.worker_id]),
        )
        for r, lot in rows
    ]


async def wo_detail(session: AsyncSession, v: WoView) -> S.WorkOrderDetail:
    base = (await wo_out(session, v)).model_dump()
    children_rows = (
        (
            await session.execute(
                select(WorkOrder).where(WorkOrder.parent_wo_id == v.wo.id).order_by(WorkOrder.code)
            )
        )
        .scalars()
        .all()
    )
    children = [wo_summary(c) for c in await load_wo_views(session, children_rows)]
    return S.WorkOrderDetail(
        **base,
        recent_events=await event_outs(session, await wo_recent_events(session, v.wo.id)),
        boxes=await wo_boxes(session, v.wo),
        receipts=await wo_receipts(session, v.wo),
        children=children,
    )


# ======================================================================
# SO
# ======================================================================
@dataclass(slots=True)
class SoView:
    so: SalesOrder
    customer: Customer
    line_count: int
    wo_count: int
    wo_views: list[WoView]  # 비취소 포함 전부 (상세의 work_orders · 지연 판정)

    @property
    def delay_risk(self) -> bool:
        return any(v.delay_risk for v in self.wo_views)


async def load_so_views(
    session: AsyncSession, sos: Sequence[SalesOrder], *, now: datetime | None = None
) -> list[SoView]:
    if not sos:
        return []
    so_ids = [s.id for s in sos]
    cust_map = await load_by_id(session, Customer, (s.customer_id for s in sos))
    line_counts = dict(
        (
            await session.execute(
                select(SalesOrderLine.so_id, func.count())
                .where(SalesOrderLine.so_id.in_(so_ids))
                .group_by(SalesOrderLine.so_id)
            )
        ).all()
    )
    wos = (
        (
            await session.execute(
                select(WorkOrder).where(WorkOrder.so_id.in_(so_ids)).order_by(WorkOrder.id)
            )
        )
        .scalars()
        .all()
    )
    wo_views = await load_wo_views(session, wos, now=now)
    by_so: dict[int, list[WoView]] = {}
    for v in wo_views:
        by_so.setdefault(v.wo.so_id, []).append(v)
    return [
        SoView(
            so=s,
            customer=cust_map[s.customer_id],
            line_count=int(line_counts.get(s.id, 0)),
            wo_count=len(by_so.get(s.id, [])),
            wo_views=by_so.get(s.id, []),
        )
        for s in sos
    ]


def so_summary(v: SoView) -> S.SalesOrderSummary:
    s = v.so
    return S.SalesOrderSummary(
        id=s.id,
        code=s.code,
        customer=customer_ref(v.customer),
        order_date=s.order_date,
        due_date=s.due_date,
        status=s.status,
        progress_pct=float(s.progress_pct),
        delay_risk=v.delay_risk,
        line_count=v.line_count,
        wo_count=v.wo_count,
        confirmed_at=s.confirmed_at,
        shipped_at=s.shipped_at,
    )


async def load_so_lines(session: AsyncSession, so: SalesOrder) -> list[SalesOrderLine]:
    rows = (
        await session.execute(
            select(SalesOrderLine)
            .where(SalesOrderLine.so_id == so.id)
            .order_by(SalesOrderLine.line_no)
        )
    ).scalars()
    return list(rows.all())


async def line_outs(
    session: AsyncSession, lines: Sequence[SalesOrderLine]
) -> list[S.SalesOrderLine]:
    items = await load_by_id(session, Item, (ln.item_id for ln in lines))
    designs = await load_by_id(
        session, Design, (ln.design_id for ln in lines if ln.design_id is not None)
    )
    return [
        S.SalesOrderLine(
            id=ln.id,
            line_no=ln.line_no,
            item=item_ref(items[ln.item_id]),
            print_method=ln.print_method,
            qty=ln.qty,
            unit_price=float(ln.unit_price) if ln.unit_price is not None else None,
            design=design_out(designs[ln.design_id])
            if ln.design_id is not None and ln.design_id in designs
            else None,
            design_confirmed=ln.design_confirmed,
        )
        for ln in lines
    ]


async def so_out(session: AsyncSession, v: SoView) -> S.SalesOrder:
    s = v.so
    creator = await session.get(AppUser, s.created_by)
    assert creator is not None
    return S.SalesOrder(
        **so_summary(v).model_dump(),
        ship_to=S.ShipTo.model_validate(s.ship_to),
        memo=s.memo,
        lines=await line_outs(session, await load_so_lines(session, s)),
        created_by=user_summary(creator),
        created_at=s.created_at,
        updated_at=s.updated_at,
    )


async def so_detail(session: AsyncSession, v: SoView) -> S.SalesOrderDetail:
    base = (await so_out(session, v)).model_dump()
    active = [wv for wv in v.wo_views if wv.wo.status in recalc.WO_ACTIVE]
    current: list[str] = []
    for wv in active:
        cur = next((st for st in wv.steps if st.seq == wv.wo.current_step_seq), None)
        if cur is not None and cur.process_code not in current:
            current.append(cur.process_code)
    return S.SalesOrderDetail(
        **base,
        work_orders=[wo_summary(wv) for wv in v.wo_views],
        current_processes=current,
        est_complete_at=recalc.est_complete_at([(wv.wo, wv.steps) for wv in v.wo_views]),
    )


def as_page(items: Sequence[Any], total: int, page: int, size: int) -> dict[str, Any]:
    return {"items": list(items), "page": page, "size": size, "total": total}


async def load_so_with_lines(session: AsyncSession, so_id: int) -> SalesOrder | None:
    return (
        await session.execute(
            select(SalesOrder).options(selectinload(SalesOrder.lines)).where(SalesOrder.id == so_id)
        )
    ).scalar_one_or_none()

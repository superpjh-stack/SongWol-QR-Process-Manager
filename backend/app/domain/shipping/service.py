"""출하 서비스 (spec A4, api-contract §7.5 · §6.4). PACK·SHIP 은 ``domain/scan/service.py`` 의
``decide_pack``/``apply_pack``/``decide_ship``/``apply_ship``/``shipment_out``/``pack_box_out`` 를
그대로 호출한다 — "스캔 PACK/SHIP 과 같은 서비스"(§7.5, §13.6 발송 멱등).
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Principal
from app.api.v1.schemas import order as O
from app.api.v1.schemas import shipping as S
from app.api.v1.schemas.common import normalize_code
from app.core.errors import ApiError, not_found
from app.db.models.master import AppUser, Customer, Item
from app.db.models.order import SalesOrder, WorkOrder
from app.db.models.shipping import PackBox, Shipment, ShipmentBox
from app.domain.common.listing import PageParams, paginate, parse_sort
from app.domain.master.admin_service import user_summary
from app.domain.order import recalc
from app.domain.order.views import wo_summary
from app.domain.order.wo_service import get_wo_view
from app.domain.scan import service as scan_service

TZ_SEOUL = ZoneInfo("Asia/Seoul")

# admin #4 · #29 [S3]. boxes 는 §14.6 예외 목록에 없다 — 기본 오름차순(첫 컬럼).
BOX_SORT: dict[str, Any] = {"packed_at": PackBox.packed_at, "code": PackBox.code}
# shipments 는 §14.6 예외(최신순) — 기본 -shipped_at.
SHIPMENT_SORT: dict[str, Any] = {
    "shipped_at": Shipment.shipped_at,
    "so_code": SalesOrder.code,
    "tracking_no": Shipment.tracking_no,
}


def _kst_day_range(d: date) -> tuple[datetime, datetime]:
    start = datetime.combine(d, time.min, tzinfo=TZ_SEOUL).astimezone(UTC)
    return start, start + timedelta(days=1)


# ======================================================================
# POST/GET /boxes (A4-01, §7.5 — 스캔 PACK 과 같은 서비스)
# ======================================================================
async def create_box(session: AsyncSession, principal: Principal, body: S.BoxCreate) -> S.PackBox:
    if principal.is_station and body.event_uuid is None:
        raise ApiError(422, "EVENT_UUID_REQUIRED", "이벤트 ID 가 필요합니다")
    if body.event_uuid is not None:
        dup = (
            await session.execute(select(PackBox).where(PackBox.event_uuid == body.event_uuid))
        ).scalar_one_or_none()
        if dup is not None:
            dup_wo = await session.get(WorkOrder, dup.wo_id)
            assert dup_wo is not None
            return scan_service.pack_box_out(dup, dup_wo, None)

    wo = await scan_service.get_wo_by_code_or_404(session, body.wo_code)
    worker = await scan_service.resolve_worker_for_write(session, principal, body.worker_card)

    decision, steps = await scan_service.decide_pack(session, wo=wo, qty_box=body.qty)
    if decision.kind == "INVALID_REQUEST":
        raise ApiError(422, decision.code or "VALIDATION_ERROR", decision.message)
    if decision.kind != "APPLY":
        raise ApiError(409, decision.code or "STATE_CONFLICT", decision.message)

    box, label_job = await scan_service.apply_pack(
        session,
        decision=decision,
        wo=wo,
        steps=steps,
        qty_box=body.qty,
        printer_id=body.printer_id,
        worker=worker,
        station=principal.station,
        event_uuid=body.event_uuid,
        client_seq=None,
    )
    await session.refresh(wo)
    return scan_service.pack_box_out(box, wo, label_job)


async def list_boxes(
    session: AsyncSession,
    params: PageParams,
    *,
    wo_code: str | None,
    so_code: str | None,
    unshipped: bool,
    sort: str | None,
) -> tuple[list[S.PackBox], int]:
    stmt = select(PackBox).join(WorkOrder, WorkOrder.id == PackBox.wo_id)
    if wo_code:
        stmt = stmt.where(WorkOrder.code == normalize_code(wo_code))
    if so_code:
        stmt = stmt.join(SalesOrder, SalesOrder.id == WorkOrder.so_id).where(
            SalesOrder.code == normalize_code(so_code)
        )
    if unshipped:
        stmt = stmt.where(PackBox.shipment_id.is_(None))
    stmt = stmt.order_by(*parse_sort(sort, BOX_SORT, default="packed_at"))
    rows, total = await paginate(session, stmt, params)
    out: list[S.PackBox] = []
    for b in rows:
        wo = await session.get(WorkOrder, b.wo_id)
        assert wo is not None
        out.append(scan_service.pack_box_out(b, wo, None))
    return out, total


async def _shipment_summary(session: AsyncSession, shipment: Shipment) -> S.ShipmentSummary:
    so = await session.get(SalesOrder, shipment.so_id)
    assert so is not None
    customer = await session.get(Customer, so.customer_id)
    assert customer is not None
    box_count = (
        await session.execute(
            select(func.count()).where(ShipmentBox.shipment_id == shipment.id)
        )
    ).scalar_one()
    return S.ShipmentSummary(
        id=shipment.id,
        so_code=so.code,
        customer_name=customer.name,
        carrier=shipment.carrier,
        tracking_no=shipment.tracking_no,
        status=shipment.status,
        shipped_at=shipment.shipped_at,
        qty_total=shipment.qty_total,
        box_count=int(box_count),
    )


async def get_box_detail(session: AsyncSession, code: str) -> O.PackBoxDetail:
    box = await scan_service.get_box_by_code_or_404(session, code)
    wo = await session.get(WorkOrder, box.wo_id)
    assert wo is not None
    wo_view = await get_wo_view(session, wo.code)
    worker = await session.get(AppUser, box.worker_id)
    assert worker is not None
    shipment_summary: S.ShipmentSummary | None = None
    if box.shipment_id is not None:
        shipment = await session.get(Shipment, box.shipment_id)
        assert shipment is not None
        shipment_summary = await _shipment_summary(session, shipment)
    return O.PackBoxDetail(
        id=box.id,
        code=box.code,
        wo_code=wo.code,
        box_no=box.box_no,
        qty=box.qty,
        packed_at=box.packed_at,
        shipment_id=box.shipment_id,
        wo=wo_summary(wo_view),
        worker=user_summary(worker),
        shipment=shipment_summary,
    )


# ======================================================================
# POST/GET /shipments (A4-02~04, §7.5 · §6.4 — 스캔 SHIP 과 같은 서비스)
# ======================================================================
async def create_shipment(
    session: AsyncSession, principal: Principal, body: S.ShipmentCreate
) -> S.ShipmentDetail:
    if principal.is_station and body.event_uuid is None:
        raise ApiError(422, "EVENT_UUID_REQUIRED", "이벤트 ID 가 필요합니다")
    if body.event_uuid is not None:
        dup = (
            await session.execute(select(Shipment).where(Shipment.event_uuid == body.event_uuid))
        ).scalar_one_or_none()
        if dup is not None:
            return await scan_service.shipment_out(session, dup)

    boxes: list[PackBox] = []
    for code in body.box_codes:
        boxes.append(await scan_service.get_box_by_code_or_404(session, code))

    if body.so_code:
        first_wo = await session.get(WorkOrder, boxes[0].wo_id)
        assert first_wo is not None
        so = await session.get(SalesOrder, first_wo.so_id)
        assert so is not None
        if normalize_code(body.so_code) != so.code:
            raise ApiError(409, "BOX_SO_MISMATCH", "박스가 지정한 수주에 속하지 않습니다")

    worker = await scan_service.resolve_worker_for_write(session, principal, body.worker_card)

    decision = await scan_service.decide_ship(
        session, boxes=boxes, tracking_no=body.tracking_no, target_type="LT"
    )
    if decision.kind == "INVALID_REQUEST":
        raise ApiError(422, decision.code or "VALIDATION_ERROR", decision.message)
    if decision.kind != "APPLY":
        raise ApiError(409, decision.code or "STATE_CONFLICT", decision.message)

    shipment = await scan_service.apply_ship(
        session,
        decision=decision,
        boxes=boxes,
        tracking_no=body.tracking_no,
        carrier=body.carrier,
        worker=worker,
        station=principal.station,
        event_uuid=body.event_uuid,
        confirm=body.confirm,
    )
    await session.commit()
    await session.refresh(shipment)
    return await scan_service.shipment_out(session, shipment)


async def list_shipments(
    session: AsyncSession,
    params: PageParams,
    *,
    day: date | None,
    from_: date | None,
    to: date | None,
    customer_id: int | None,
    so_code: str | None,
    tracking_no: str | None,
    status: str | None,
    unmapped: bool,
    sort: str | None,
) -> tuple[list[S.ShipmentSummary], int]:
    """``unmapped=true``: §6.4 「매핑 누락 박스」는 pack_box 단위 개념(``/boxes?unshipped=true``)
    이지만 이 경로의 응답형은 계약상 Page<ShipmentSummary> 로 고정돼 있다(§7.5) — 박스 단위로는
    표현할 수 없어, 아직 확정(발송)되지 않은 ``READY`` 상태(= 박스는 모였지만 매핑·확정이
    끝나지 않은 상태)로 근사한다. spec 결함 — progress.md 「산출물 결함」 몫."""
    date_col = func.coalesce(Shipment.shipped_at, Shipment.created_at)
    stmt = select(Shipment).join(SalesOrder, SalesOrder.id == Shipment.so_id)
    if day is not None:
        start, end = _kst_day_range(day)
        stmt = stmt.where(date_col >= start, date_col < end)
    if from_ is not None:
        start, _ = _kst_day_range(from_)
        stmt = stmt.where(date_col >= start)
    if to is not None:
        _, end = _kst_day_range(to)
        stmt = stmt.where(date_col < end)
    if customer_id is not None:
        stmt = stmt.where(SalesOrder.customer_id == customer_id)
    if so_code:
        stmt = stmt.where(SalesOrder.code == normalize_code(so_code))
    if tracking_no:
        stmt = stmt.where(Shipment.tracking_no.ilike(f"%{tracking_no.strip()}%"))
    if status:
        stmt = stmt.where(Shipment.status == status.upper())
    if unmapped:
        stmt = stmt.where(Shipment.status == "READY")
    stmt = stmt.order_by(*parse_sort(sort, SHIPMENT_SORT, default="-shipped_at"))
    rows, total = await paginate(session, stmt, params)
    return [await _shipment_summary(session, s) for s in rows], total


async def get_shipment(session: AsyncSession, shipment_id: int) -> S.ShipmentDetail:
    shipment = await session.get(Shipment, shipment_id)
    if shipment is None:
        raise not_found("SHIPMENT_NOT_FOUND", "출하", shipment_id)
    return await scan_service.shipment_out(session, shipment)


# ======================================================================
# GET /shipments/daily-report (A4-06)
# ======================================================================
async def daily_report(session: AsyncSession, report_date: date) -> S.DailyShipmentReport:
    start, end = _kst_day_range(report_date)
    shipments = (
        (
            await session.execute(
                select(Shipment).where(
                    Shipment.status == "SHIPPED",
                    Shipment.shipped_at >= start,
                    Shipment.shipped_at < end,
                )
            )
        )
        .scalars()
        .all()
    )
    rows: list[S.DailyShipmentRow] = []
    total_boxes = 0
    total_qty = 0
    for shipment in shipments:
        so = await session.get(SalesOrder, shipment.so_id)
        assert so is not None
        customer = await session.get(Customer, so.customer_id)
        assert customer is not None
        box_rows = (
            (await session.execute(select(PackBox).where(PackBox.shipment_id == shipment.id)))
            .scalars()
            .all()
        )
        total_boxes += len(box_rows)
        overdue = shipment.shipped_at is not None and shipment.shipped_at > recalc.due_datetime(
            so.due_date
        )
        qty_by_wo: dict[int, int] = {}
        for b in box_rows:
            qty_by_wo[b.wo_id] = qty_by_wo.get(b.wo_id, 0) + b.qty
        for wo_id, qty in qty_by_wo.items():
            wo = await session.get(WorkOrder, wo_id)
            assert wo is not None
            item = await session.get(Item, wo.item_id)
            assert item is not None
            rows.append(
                S.DailyShipmentRow(
                    so_code=so.code,
                    customer_name=customer.name,
                    item_name=item.name,
                    qty=qty,
                    tracking_no=shipment.tracking_no,
                    shipped_at=shipment.shipped_at,
                    overdue=overdue,
                )
            )
            total_qty += qty
    return S.DailyShipmentReport(
        date=report_date.isoformat(),
        rows=rows,
        totals=S.DailyShipmentTotals(shipments=len(shipments), boxes=total_boxes, qty=total_qty),
    )

"""자재 서비스 (spec A3, api-contract §7.4). RECEIVE·MAP 은 ``domain/scan/service.py`` 의
``decide_receive``/``apply_receive``/``decide_map``/``apply_map`` 을 그대로 호출한다 — "스캔
RECEIVE 와 같은 서비스"(§7.4).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Principal
from app.api.v1.schemas import material as S
from app.api.v1.schemas import order as O
from app.api.v1.schemas import shipping as ShipS
from app.api.v1.schemas.common import IdRef, normalize_code
from app.core.errors import ApiError, not_found, validation
from app.db.models.master import AppUser, Item
from app.db.models.material import InboundLot, MaterialReceipt, StockTxn, VendorBarcodeMap
from app.db.models.order import WorkOrder
from app.db.models.shipping import PackBox
from app.domain.common.listing import PageParams, paginate, parse_sort
from app.domain.master.admin_service import user_summary
from app.domain.order.views import wo_summary
from app.domain.order.wo_service import get_wo_view
from app.domain.scan import service as scan_service

# admin #4 · #29 [S3]
RECEIPT_SORT: dict[str, Any] = {
    "received_at": MaterialReceipt.received_at,
    "wo_code": WorkOrder.code,
}
STOCK_TXN_SORT: dict[str, Any] = {"created_at": StockTxn.created_at}
VENDOR_BARCODE_SORT: dict[str, Any] = {"mapped_at": VendorBarcodeMap.mapped_at}


# ``_resolve_worker_for_write`` 는 ``scan_service.resolve_worker_for_write`` 로 옮겼다
# (shipping 서비스와 공유, 중복 금지).


# ======================================================================
# POST/GET /receipts (A3-01/A3-03, §7.4 — 스캔 RECEIVE 와 같은 서비스)
# ======================================================================
async def create_receipt(
    session: AsyncSession, principal: Principal, body: S.ReceiptCreate
) -> S.Receipt:
    """비수주 입고(A3-09)는 [확장] 범위 밖이라 ``wo_code`` 를 요구한다 (S3 의 의도적 범위 결정)."""
    if principal.is_station and body.event_uuid is None:
        raise ApiError(422, "EVENT_UUID_REQUIRED", "이벤트 ID 가 필요합니다")
    if not body.wo_code:
        raise validation(
            ["body", "wo_code"],
            "wo_code 가 필요합니다 (비수주 입고는 아직 지원하지 않습니다, spec A3-09 확장)",
        )
    if body.event_uuid is not None:
        dup = (
            await session.execute(
                select(MaterialReceipt).where(MaterialReceipt.event_uuid == body.event_uuid)
            )
        ).scalar_one_or_none()
        if dup is not None:
            dup_item = await session.get(Item, dup.item_id)
            dup_lot = await session.get(InboundLot, dup.lot_id)
            dup_worker = await session.get(AppUser, dup.worker_id)
            dup_wo = await session.get(WorkOrder, dup.wo_id) if dup.wo_id else None
            assert dup_item is not None and dup_lot is not None and dup_worker is not None
            return scan_service.receipt_out(dup, dup_lot, dup_item, dup_worker, dup_wo)

    wo = await scan_service.get_wo_by_code_or_404(session, body.wo_code)
    item = await session.get(Item, wo.item_id)
    if item is None:
        raise not_found("ITEM_NOT_FOUND", "품목", wo.item_id)
    worker = await scan_service.resolve_worker_for_write(session, principal, body.worker_card)
    received_at = body.received_at or datetime.now(UTC)

    decision, steps = await scan_service.decide_receive(
        session,
        wo=wo,
        qty=body.qty,
        inspection=body.inspection,
        variance_reason=None,
        recent_same_scan=False,
    )
    if decision.kind == "INVALID_REQUEST":
        raise ApiError(422, decision.code or "VALIDATION_ERROR", decision.message)
    if decision.kind != "APPLY":
        raise ApiError(409, decision.code or "STATE_CONFLICT", decision.message)

    lot, receipt = await scan_service.apply_receive(
        session,
        decision=decision,
        wo=wo,
        steps=steps,
        item=item,
        qty=body.qty,
        box_count=body.box_count,
        inspection=body.inspection,
        vendor=body.vendor,
        vendor_barcode=body.vendor_barcode,
        received_at=received_at,
        worker=worker,
        station=principal.station,
        event_uuid=body.event_uuid,
    )
    await session.commit()
    await session.refresh(wo)
    return scan_service.receipt_out(receipt, lot, item, worker, wo)


async def list_receipts(
    session: AsyncSession,
    params: PageParams,
    *,
    from_: datetime | None,
    to: datetime | None,
    item_id: int | None,
    wo_code: str | None,
    inspection: str | None,
    sort: str | None,
) -> tuple[list[S.ReceiptSummary], int]:
    stmt = (
        select(MaterialReceipt)
        .outerjoin(WorkOrder, WorkOrder.id == MaterialReceipt.wo_id)
        .order_by(*parse_sort(sort, RECEIPT_SORT, default="-received_at"))
    )
    if from_ is not None:
        stmt = stmt.where(MaterialReceipt.received_at >= from_)
    if to is not None:
        stmt = stmt.where(MaterialReceipt.received_at <= to)
    if item_id is not None:
        stmt = stmt.where(MaterialReceipt.item_id == item_id)
    if wo_code:
        stmt = stmt.where(WorkOrder.code == normalize_code(wo_code))
    if inspection:
        stmt = stmt.where(MaterialReceipt.inspection == inspection.upper())
    rows, total = await paginate(session, stmt, params)
    out: list[S.ReceiptSummary] = []
    for r in rows:
        item = await session.get(Item, r.item_id)
        lot = await session.get(InboundLot, r.lot_id)
        worker = await session.get(AppUser, r.worker_id)
        wo = await session.get(WorkOrder, r.wo_id) if r.wo_id else None
        assert item is not None and lot is not None and worker is not None
        out.append(
            S.ReceiptSummary(
                id=r.id,
                wo_code=wo.code if wo else None,
                item=IdRef(id=item.id, code=item.code, name=item.name),
                lot_code=lot.code,
                qty=r.qty,
                box_count=r.box_count,
                inspection=r.inspection,
                received_at=r.received_at,
                worker=user_summary(worker),
            )
        )
    return out, total


# ======================================================================
# 협력업체 바코드 (A3-02, §7.4 — 스캔 MAP 과 같은 서비스)
# ======================================================================
async def create_vendor_barcode_map(
    session: AsyncSession, principal: Principal, body: S.VendorBarcodeMapCreate
) -> S.VendorBarcodeMap:
    wo = await scan_service.get_wo_by_code_or_404(session, body.wo_code)
    worker = await scan_service.resolve_worker_for_write(session, principal, body.worker_card)
    decision = await scan_service.decide_map(wo=wo, wo_code=wo.code)
    if decision.kind == "INVALID_REQUEST":
        raise ApiError(422, decision.code or "VALIDATION_ERROR", decision.message)
    if decision.kind != "APPLY":
        raise ApiError(404, decision.code or "WO_NOT_FOUND", decision.message)
    mapping = await scan_service.apply_map(
        session, vendor_barcode=body.vendor_barcode, wo=wo, worker=worker, event_uuid=None
    )
    await session.commit()
    item = await session.get(Item, wo.item_id)
    assert item is not None
    return scan_service.vendor_barcode_map_out(mapping, wo, item, worker)


async def lookup_vendor_barcode(session: AsyncSession, barcode: str) -> O.VendorBarcodeLookup:
    mapping = (
        await session.execute(
            select(VendorBarcodeMap)
            .where(VendorBarcodeMap.vendor_barcode == barcode, VendorBarcodeMap.active.is_(True))
            .order_by(VendorBarcodeMap.mapped_at.desc())
        )
    ).scalars().first()
    if mapping is None:
        return O.VendorBarcodeLookup(mapping=None, wo=None)
    wo = await session.get(WorkOrder, mapping.wo_id)
    item = await session.get(Item, mapping.item_id)
    mapped_by = await session.get(AppUser, mapping.mapped_by)
    assert wo is not None and item is not None and mapped_by is not None
    wo_view = await get_wo_view(session, wo.code)
    return O.VendorBarcodeLookup(
        mapping=scan_service.vendor_barcode_map_out(mapping, wo, item, mapped_by),
        wo=wo_summary(wo_view),
    )


async def list_vendor_barcode_maps(
    session: AsyncSession,
    params: PageParams,
    *,
    wo_code: str | None,
    item_id: int | None,
    active: bool | None,
) -> tuple[list[S.VendorBarcodeMap], int]:
    """admin #32 [S3]: 화면 없음, 데이터 정합 확인용."""
    stmt = select(VendorBarcodeMap).order_by(VendorBarcodeMap.mapped_at.desc())
    if wo_code:
        stmt = stmt.join(WorkOrder, WorkOrder.id == VendorBarcodeMap.wo_id).where(
            WorkOrder.code == normalize_code(wo_code)
        )
    if item_id is not None:
        stmt = stmt.where(VendorBarcodeMap.item_id == item_id)
    if active is not None:
        stmt = stmt.where(VendorBarcodeMap.active.is_(active))
    rows, total = await paginate(session, stmt, params)
    out: list[S.VendorBarcodeMap] = []
    for m in rows:
        wo = await session.get(WorkOrder, m.wo_id)
        item = await session.get(Item, m.item_id)
        mapped_by = await session.get(AppUser, m.mapped_by)
        assert wo is not None and item is not None and mapped_by is not None
        out.append(scan_service.vendor_barcode_map_out(m, wo, item, mapped_by))
    return out, total


async def deactivate_vendor_barcode_map(session: AsyncSession, map_id: int) -> S.VendorBarcodeMap:
    """§7.4 (admin #32 확장, 기계적 추가): 매핑 해제. ``active=false`` — 물리 DELETE 없음."""
    mapping = await session.get(VendorBarcodeMap, map_id)
    if mapping is None:
        raise not_found("VENDOR_BARCODE_MAP_NOT_FOUND", "협력업체 바코드 매핑", map_id)
    mapping.active = False
    await session.commit()
    await session.refresh(mapping)
    wo = await session.get(WorkOrder, mapping.wo_id)
    item = await session.get(Item, mapping.item_id)
    mapped_by = await session.get(AppUser, mapping.mapped_by)
    assert wo is not None and item is not None and mapped_by is not None
    return scan_service.vendor_barcode_map_out(mapping, wo, item, mapped_by)


# ======================================================================
# LOT 조회 · 격리 · 해제 (A3-08)
# ======================================================================
async def get_lot_or_box(session: AsyncSession, code: str) -> S.InboundLot | Any:
    code = normalize_code(code)
    lot = (
        await session.execute(select(InboundLot).where(InboundLot.code == code))
    ).scalar_one_or_none()
    if lot is not None:
        item = await session.get(Item, lot.item_id)
        assert item is not None
        return S.InboundLot(
            id=lot.id,
            code=lot.code,
            item=IdRef(id=item.id, code=item.code, name=item.name),
            vendor=lot.vendor,
            received_at=lot.received_at,
            qty=lot.qty,
            status=lot.status,
            quarantine_memo=lot.quarantine_memo,
        )
    box = (await session.execute(select(PackBox).where(PackBox.code == code))).scalar_one_or_none()
    if box is not None:
        wo = await session.get(WorkOrder, box.wo_id)
        assert wo is not None
        return ShipS.PackBoxSummary(
            id=box.id,
            code=box.code,
            wo_code=wo.code,
            box_no=box.box_no,
            qty=box.qty,
            packed_at=box.packed_at,
            shipment_id=box.shipment_id,
        )
    raise not_found("LOT_NOT_FOUND", "LOT", code)


async def quarantine_lot(session: AsyncSession, code: str, memo: str) -> S.InboundLot:
    code = normalize_code(code)
    lot = (
        await session.execute(select(InboundLot).where(InboundLot.code == code))
    ).scalar_one_or_none()
    if lot is None:
        raise not_found("LOT_NOT_FOUND", "LOT", code)
    if lot.status == "QUARANTINE":
        raise ApiError(409, "STATE_CONFLICT", "이미 격리된 LOT 입니다")
    lot.status = "QUARANTINE"
    lot.quarantine_memo = memo
    await session.commit()
    await session.refresh(lot)
    item = await session.get(Item, lot.item_id)
    assert item is not None
    return S.InboundLot(
        id=lot.id,
        code=lot.code,
        item=IdRef(id=item.id, code=item.code, name=item.name),
        vendor=lot.vendor,
        received_at=lot.received_at,
        qty=lot.qty,
        status=lot.status,
        quarantine_memo=lot.quarantine_memo,
    )


async def release_lot(session: AsyncSession, code: str) -> S.InboundLot:
    code = normalize_code(code)
    lot = (
        await session.execute(select(InboundLot).where(InboundLot.code == code))
    ).scalar_one_or_none()
    if lot is None:
        raise not_found("LOT_NOT_FOUND", "LOT", code)
    if lot.status != "QUARANTINE":
        raise ApiError(409, "STATE_CONFLICT", "격리 상태가 아닙니다")
    lot.status = "OK"
    await session.commit()
    await session.refresh(lot)
    item = await session.get(Item, lot.item_id)
    assert item is not None
    return S.InboundLot(
        id=lot.id,
        code=lot.code,
        item=IdRef(id=item.id, code=item.code, name=item.name),
        vendor=lot.vendor,
        received_at=lot.received_at,
        qty=lot.qty,
        status=lot.status,
        quarantine_memo=lot.quarantine_memo,
    )


# ======================================================================
# 재고 (A3-05/A3-06/A3-07, §7.4 — v_stock_current 뷰 사용)
# ======================================================================
async def list_stock(
    session: AsyncSession, params: PageParams, *, q: str | None, item_group: str | None
) -> tuple[list[S.StockRow], int]:
    where_sql = []
    binds: dict[str, Any] = {}
    if q:
        where_sql.append("(v.item_code ILIKE :q OR v.item_name ILIKE :q)")
        binds["q"] = f"%{q}%"
    if item_group:
        where_sql.append("i.item_group = :item_group")
        binds["item_group"] = normalize_code(item_group)
    where = f"WHERE {' AND '.join(where_sql)}" if where_sql else ""
    join = "JOIN mes.item i ON i.id = v.item_id" if item_group else ""
    total: int = (
        await session.execute(
            text(f"SELECT COUNT(*) FROM mes.v_stock_current v {join} {where}"), binds
        )
    ).scalar_one()
    rows = (
        await session.execute(
            text(
                f"SELECT v.* FROM mes.v_stock_current v {join} {where} "
                "ORDER BY v.item_code LIMIT :limit OFFSET :offset"
            ),
            {**binds, "limit": params.size, "offset": params.offset},
        )
    ).mappings().all()
    out = [
        S.StockRow(
            item_id=r["item_id"],
            item_code=r["item_code"],
            item_name=r["item_name"],
            spec=r["spec"],
            color=r["color"],
            qty_on_hand=r["qty_on_hand"] or 0,
            updated_at=r["updated_at"],
            last_receive_at=r["last_receive_at"],
            last_ship_at=r["last_ship_at"],
        )
        for r in rows
    ]
    return out, int(total)


async def adjust_stock(
    session: AsyncSession, principal: Principal, body: S.StockAdjust
) -> S.StockTxn:
    item = await session.get(Item, body.item_id)
    if item is None:
        raise not_found("ITEM_NOT_FOUND", "품목", body.item_id)
    txn = await scan_service.add_stock_txn(
        session,
        body.item_id,
        body.qty_delta,
        txn_type="ADJUST",
        ref_type=None,
        ref_id=None,
        created_by=principal.user_id,
        reason=body.reason,
        source=body.source or "NEW",
    )
    await session.commit()
    await session.refresh(txn)
    creator = await session.get(AppUser, txn.created_by) if txn.created_by else None
    return S.StockTxn(
        id=txn.id,
        item=IdRef(id=item.id, code=item.code, name=item.name),
        txn_type=txn.txn_type,
        qty=txn.qty,
        ref_type=txn.ref_type,
        ref_id=txn.ref_id,
        reason=txn.reason,
        source=txn.source,
        created_by=user_summary(creator) if creator else None,
        created_at=txn.created_at,
    )


async def list_stock_txns(
    session: AsyncSession,
    params: PageParams,
    *,
    item_id: int | None,
    from_: datetime | None,
    to: datetime | None,
    txn_type: str | None,
    source: str | None,
) -> tuple[list[S.StockTxn], int]:
    stmt = select(StockTxn).order_by(StockTxn.created_at.desc())
    if item_id is not None:
        stmt = stmt.where(StockTxn.item_id == item_id)
    if from_ is not None:
        stmt = stmt.where(StockTxn.created_at >= from_)
    if to is not None:
        stmt = stmt.where(StockTxn.created_at <= to)
    if txn_type:
        stmt = stmt.where(StockTxn.txn_type == txn_type.upper())
    if source:
        stmt = stmt.where(StockTxn.source == source.upper())
    rows, total = await paginate(session, stmt, params)
    out: list[S.StockTxn] = []
    for t in rows:
        item = await session.get(Item, t.item_id)
        creator = await session.get(AppUser, t.created_by) if t.created_by else None
        assert item is not None
        out.append(
            S.StockTxn(
                id=t.id,
                item=IdRef(id=item.id, code=item.code, name=item.name),
                txn_type=t.txn_type,
                qty=t.qty,
                ref_type=t.ref_type,
                ref_id=t.ref_id,
                reason=t.reason,
                source=t.source,
                created_by=user_summary(creator) if creator else None,
                created_at=t.created_at,
            )
        )
    return out, total

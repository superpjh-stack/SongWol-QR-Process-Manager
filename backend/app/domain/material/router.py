"""자재 라우터 (spec A3, api-contract §7.4).

권한 (§13.1 admin #13 · §4): 입고 조회 전 역할 R(STATION 은 자기 단말) · 입고 생성 W+STATION ·
매핑 W+STATION · LOT 격리 W+STATION · LOT 해제/재고 조정 ADMIN·MANAGER.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import permissions as P
from app.api.deps import Principal, Session, get_principal, require_roles
from app.api.v1.schemas import material as S
from app.api.v1.schemas import order as O
from app.api.v1.schemas.common import Page
from app.core.errors import forbidden
from app.domain.common.listing import PageDep, PageParams
from app.domain.common.xlsx import XLSX_MIME, rows_to_xlsx
from app.domain.material import service as svc
from app.domain.order.views import as_page

router = APIRouter(tags=["material"])

FromQuery = Query(default=None, alias="from")  # B008: 모듈 수준 싱글턴 (order/router.py 관례)

_r = Depends(require_roles(*P.ORDER_READ, station=True))
_w = Depends(require_roles(*P.MATERIAL_WRITE, station=True))
_manage = Depends(require_roles("ADMIN", "MANAGER"))
_principal = Depends(get_principal)


# ======================================================================
# 입고 (A3-01/A3-03)
# ======================================================================
@router.post("/receipts", response_model=S.Receipt, status_code=201)
async def create_receipt(
    body: S.ReceiptCreate, principal: Principal = _principal, session: AsyncSession = Session
) -> S.Receipt:
    if principal.user is None and principal.station is None:
        raise forbidden()
    if principal.user is not None and principal.user.role not in P.MATERIAL_WRITE:
        raise forbidden()
    return await svc.create_receipt(session, principal, body)


@router.get("/receipts", response_model=Page[S.ReceiptSummary], dependencies=[_r])
async def list_receipts(
    params: PageParams = PageDep,
    from_: datetime | None = FromQuery,
    to: datetime | None = None,
    item_id: int | None = None,
    wo_code: str | None = None,
    inspection: str | None = None,
    sort: str | None = None,
    format: str | None = None,  # noqa: A002 — 계약(format) 그대로
    session: AsyncSession = Session,
) -> Any:
    rows, total = await svc.list_receipts(
        session,
        params,
        from_=from_,
        to=to,
        item_id=item_id,
        wo_code=wo_code,
        inspection=inspection,
        sort=sort,
    )
    if format == "xlsx":
        headers = [
            "lot_code", "wo_code", "item", "qty", "box_count",
            "inspection", "received_at", "worker",
        ]
        data = [
            [
                r.lot_code, r.wo_code, r.item.name, r.qty, r.box_count,
                r.inspection, r.received_at, r.worker.name,
            ]
            for r in rows
        ]
        return Response(
            content=rows_to_xlsx(headers, data),
            media_type=XLSX_MIME,
            headers={"Content-Disposition": 'attachment; filename="receipts.xlsx"'},
        )
    return as_page(rows, total, params.page, params.size)


# ======================================================================
# 협력업체 바코드 (A3-02, admin #32)
# ======================================================================
@router.post("/vendor-barcodes/map", response_model=S.VendorBarcodeMap, status_code=201)
async def map_vendor_barcode(
    body: S.VendorBarcodeMapCreate,
    principal: Principal = _principal,
    session: AsyncSession = Session,
) -> S.VendorBarcodeMap:
    if principal.user is None and principal.station is None:
        raise forbidden()
    if principal.user is not None and principal.user.role not in P.MATERIAL_WRITE:
        raise forbidden()
    return await svc.create_vendor_barcode_map(session, principal, body)


@router.get(
    "/vendor-barcodes/{barcode}", response_model=O.VendorBarcodeLookup, dependencies=[_r]
)
async def lookup_vendor_barcode(
    barcode: str, session: AsyncSession = Session
) -> O.VendorBarcodeLookup:
    return await svc.lookup_vendor_barcode(session, barcode)


@router.get("/vendor-barcodes", response_model=Page[S.VendorBarcodeMap], dependencies=[_manage])
async def list_vendor_barcodes(
    params: PageParams = PageDep,
    wo_code: str | None = None,
    item_id: int | None = None,
    active: bool | None = None,
    session: AsyncSession = Session,
) -> dict[str, Any]:
    rows, total = await svc.list_vendor_barcode_maps(
        session, params, wo_code=wo_code, item_id=item_id, active=active
    )
    return as_page(rows, total, params.page, params.size)


@router.post(
    "/vendor-barcodes/{map_id}/deactivate",
    response_model=S.VendorBarcodeMap,
    dependencies=[_manage],
)
async def deactivate_vendor_barcode(
    map_id: int, session: AsyncSession = Session
) -> S.VendorBarcodeMap:
    return await svc.deactivate_vendor_barcode_map(session, map_id)


# ======================================================================
# LOT (A3-08)
# ======================================================================
@router.get("/lots/{code}", dependencies=[_r])
async def get_lot(code: str, session: AsyncSession = Session) -> Any:
    return await svc.get_lot_or_box(session, code)


@router.post("/lots/{code}/quarantine", response_model=S.InboundLot)
async def quarantine_lot(
    code: str,
    body: S.QuarantineRequest,
    principal: Principal = _w,
    session: AsyncSession = Session,
) -> S.InboundLot:
    return await svc.quarantine_lot(session, code, body.memo)


@router.post("/lots/{code}/release", response_model=S.InboundLot, dependencies=[_manage])
async def release_lot(code: str, session: AsyncSession = Session) -> S.InboundLot:
    return await svc.release_lot(session, code)


# ======================================================================
# 재고 (A3-05/06/07)
# ======================================================================
@router.get("/stock", dependencies=[Depends(require_roles(*P.ORDER_READ))])
async def list_stock(
    params: PageParams = PageDep,
    q: str | None = None,
    item_group: str | None = None,
    format: str | None = None,  # noqa: A002
    session: AsyncSession = Session,
) -> Any:
    rows, total = await svc.list_stock(session, params, q=q, item_group=item_group)
    if format == "xlsx":
        headers = ["item_code", "item_name", "spec", "color", "qty_on_hand", "updated_at"]
        data = [
            [r.item_code, r.item_name, r.spec, r.color, r.qty_on_hand, r.updated_at] for r in rows
        ]
        return Response(
            content=rows_to_xlsx(headers, data),
            media_type=XLSX_MIME,
            headers={"Content-Disposition": 'attachment; filename="stock.xlsx"'},
        )
    return as_page(rows, total, params.page, params.size)


@router.post("/stock/adjust", response_model=S.StockTxn, dependencies=[_manage])
async def adjust_stock(
    body: S.StockAdjust, principal: Principal = _principal, session: AsyncSession = Session
) -> S.StockTxn:
    return await svc.adjust_stock(session, principal, body)


@router.get("/stock/txns", dependencies=[Depends(require_roles(*P.ORDER_READ))])
async def list_stock_txns(
    params: PageParams = PageDep,
    item_id: int | None = None,
    from_: datetime | None = FromQuery,
    to: datetime | None = None,
    txn_type: str | None = None,
    source: str | None = None,
    format: str | None = None,  # noqa: A002
    session: AsyncSession = Session,
) -> Any:
    rows, total = await svc.list_stock_txns(
        session, params, item_id=item_id, from_=from_, to=to, txn_type=txn_type, source=source
    )
    if format == "xlsx":
        headers = ["item", "txn_type", "qty", "reason", "source", "created_at"]
        data = [[r.item.name, r.txn_type, r.qty, r.reason, r.source, r.created_at] for r in rows]
        return Response(
            content=rows_to_xlsx(headers, data),
            media_type=XLSX_MIME,
            headers={"Content-Disposition": 'attachment; filename="stock_txns.xlsx"'},
        )
    return as_page(rows, total, params.page, params.size)

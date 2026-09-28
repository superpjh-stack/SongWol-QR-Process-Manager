"""출하 라우터 (spec A4, api-contract §7.5).

권한 (§4 「포장·발송」): 생성 W(ADMIN/MANAGER)+STATION · 조회 R · 박스 단건 조회는
R+STATION(§7.5 `GET /boxes/{code}`).
"""

from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import permissions as P
from app.api.deps import Principal, Session, get_principal, require_roles
from app.api.v1.schemas import order as O
from app.api.v1.schemas import shipping as S
from app.api.v1.schemas.common import Page
from app.core.errors import forbidden
from app.domain.common.listing import PageDep, PageParams
from app.domain.common.xlsx import XLSX_MIME, rows_to_xlsx
from app.domain.order.views import as_page
from app.domain.shipping import service as svc

router = APIRouter(tags=["shipping"])

FromQuery = Query(default=None, alias="from")  # B008: 모듈 수준 싱글턴 (order/router.py 관례)

_r = Depends(require_roles(*P.ORDER_READ))
_r_station = Depends(require_roles(*P.ORDER_READ, station=True))
_principal = Depends(get_principal)


def _check_write(principal: Principal) -> None:
    if principal.user is None and principal.station is None:
        raise forbidden()
    if principal.user is not None and principal.user.role not in P.MATERIAL_WRITE:
        raise forbidden()


# ======================================================================
# 박스 (A4-01)
# ======================================================================
@router.post("/boxes", response_model=S.PackBox, status_code=201)
async def create_box(
    body: S.BoxCreate, principal: Principal = _principal, session: AsyncSession = Session
) -> S.PackBox:
    _check_write(principal)
    return await svc.create_box(session, principal, body)


@router.get("/boxes/{code}", response_model=O.PackBoxDetail, dependencies=[_r_station])
async def get_box(code: str, session: AsyncSession = Session) -> O.PackBoxDetail:
    return await svc.get_box_detail(session, code)


@router.get("/boxes", response_model=Page[S.PackBox], dependencies=[_r])
async def list_boxes(
    params: PageParams = PageDep,
    wo_code: str | None = None,
    so_code: str | None = None,
    unshipped: bool = False,
    sort: str | None = None,
    session: AsyncSession = Session,
) -> dict[str, Any]:
    rows, total = await svc.list_boxes(
        session, params, wo_code=wo_code, so_code=so_code, unshipped=unshipped, sort=sort
    )
    return as_page(rows, total, params.page, params.size)


# ======================================================================
# 발송 (A4-02~04)
# ======================================================================
@router.post("/shipments", response_model=S.ShipmentDetail, status_code=201)
async def create_shipment(
    body: S.ShipmentCreate, principal: Principal = _principal, session: AsyncSession = Session
) -> S.ShipmentDetail:
    _check_write(principal)
    return await svc.create_shipment(session, principal, body)


@router.get("/shipments/daily-report")
async def get_daily_report(
    date: date,  # noqa: A002 — 계약(?date=) 그대로
    format: str | None = None,  # noqa: A002 — 계약(format) 그대로
    session: AsyncSession = Session,
    _principal: Principal = _r,
) -> Any:
    report = await svc.daily_report(session, date)
    if format == "json":
        return report
    headers = [
        "so_code", "customer_name", "item_name", "qty", "tracking_no", "shipped_at", "overdue",
    ]
    data = [
        [r.so_code, r.customer_name, r.item_name, r.qty, r.tracking_no, r.shipped_at, r.overdue]
        for r in report.rows
    ]
    return Response(
        content=rows_to_xlsx(headers, data),
        media_type=XLSX_MIME,
        headers={"Content-Disposition": f'attachment; filename="shipments_{date}.xlsx"'},
    )


@router.get("/shipments", response_model=Page[S.ShipmentSummary], dependencies=[_r])
async def list_shipments(
    params: PageParams = PageDep,
    date: date | None = None,  # noqa: A002
    from_: date | None = FromQuery,
    to: date | None = None,
    customer_id: int | None = None,
    so_code: str | None = None,
    tracking_no: str | None = None,
    status: str | None = None,
    unmapped: bool = False,
    sort: str | None = None,
    session: AsyncSession = Session,
) -> dict[str, Any]:
    rows, total = await svc.list_shipments(
        session,
        params,
        day=date,
        from_=from_,
        to=to,
        customer_id=customer_id,
        so_code=so_code,
        tracking_no=tracking_no,
        status=status,
        unmapped=unmapped,
        sort=sort,
    )
    return as_page(rows, total, params.page, params.size)


@router.get("/shipments/{shipment_id}", response_model=S.ShipmentDetail, dependencies=[_r])
async def get_shipment(shipment_id: int, session: AsyncSession = Session) -> S.ShipmentDetail:
    return await svc.get_shipment(session, shipment_id)

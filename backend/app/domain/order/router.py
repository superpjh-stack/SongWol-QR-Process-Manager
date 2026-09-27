"""수주·도안 라우터 (api-contract §7.3 · §13.4). ``/so`` · ``/so/{id}/lines/{line_id}/design`` ·
``/designs/{id}/file|thumbnail``.

상태코드 (admin #34): ``POST /so`` 201, 액션 POST 200. ``{id}`` 자리는 숫자 PK 또는 코드 (§11-1).
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import permissions as P
from app.api.deps import Principal, Session, require_roles
from app.api.v1.schemas import order as S
from app.api.v1.schemas.common import Page
from app.db.models.master import AppUser
from app.domain.common.listing import PageDep, PageParams
from app.domain.order import design_service, ports, so_service, wo_service
from app.domain.order.views import (
    as_page,
    design_out,
    load_so_views,
    load_wo_views,
    so_detail,
    so_out,
    so_summary,
    wo_outs,
    wo_summary,
)

router = APIRouter(tags=["order"])

FromQuery = Query(default=None, alias="from")
FileParam = File(...)

_r = Depends(require_roles(*P.ORDER_READ, station=True))
_w = Depends(require_roles(*P.ORDER_WRITE))


def _user(principal: Principal) -> AppUser:
    assert principal.user is not None  # _w 는 JWT 전용
    return principal.user


# ======================================================================
# 수주
# ======================================================================
@router.get("/so", response_model=Page[S.SalesOrderSummary], dependencies=[_r])
async def list_so(
    params: PageParams = PageDep,
    from_: date | None = FromQuery,
    to: date | None = None,
    customer_id: int | None = None,
    status: str | None = None,
    due_within_days: int | None = Query(default=None, ge=0),
    delay: bool = False,
    q: str | None = None,
    sort: str | None = None,
    session: AsyncSession = Session,
) -> dict[str, object]:
    views, total = await so_service.list_sales_orders(
        session,
        params,
        from_=from_,
        to=to,
        customer_id=customer_id,
        status=status,
        due_within_days=due_within_days,
        delay=delay,
        q=q,
        sort=sort,
    )
    return as_page([so_summary(v) for v in views], total, params.page, params.size)


@router.post("/so", response_model=S.SalesOrder, status_code=201)
async def create_so(
    body: S.SalesOrderCreate, principal: Principal = _w, session: AsyncSession = Session
) -> S.SalesOrder:
    so = await so_service.create_sales_order(session, body, _user(principal))
    return await so_out(session, (await load_so_views(session, [so]))[0])


@router.get("/so/{key}", response_model=S.SalesOrderDetail, dependencies=[_r])
async def get_so(key: str, session: AsyncSession = Session) -> S.SalesOrderDetail:
    return await so_detail(session, await so_service.get_so_view(session, key))


@router.patch("/so/{key}", response_model=S.SalesOrder)
async def update_so(
    key: str,
    body: S.SalesOrderUpdate,
    principal: Principal = _w,
    session: AsyncSession = Session,
) -> S.SalesOrder:
    so = await so_service.update_sales_order(session, key, body, _user(principal))
    return await so_out(session, (await load_so_views(session, [so]))[0])


@router.post("/so/{key}/cancel", response_model=S.SoCancelResponse)
async def cancel_so(
    key: str,
    body: S.ReasonRequest,
    principal: Principal = _w,
    session: AsyncSession = Session,
) -> S.SoCancelResponse:
    so, cancelled, pending = await so_service.cancel_sales_order(
        session, key, body.reason, _user(principal)
    )
    so_view = (await load_so_views(session, [so]))[0]
    pending_views = await load_wo_views(session, pending)
    return S.SoCancelResponse(
        so=await so_out(session, so_view),
        cancelled_wo=cancelled,
        pending_wo=[wo_summary(v) for v in pending_views],
    )


# ======================================================================
# 도안 (A2-02)
# ======================================================================
@router.post("/so/{key}/lines/{line_id}/design", response_model=S.Design, status_code=201)
async def upload_design(
    key: str,
    line_id: int,
    file: UploadFile = FileParam,
    principal: Principal = _w,
    session: AsyncSession = Session,
) -> S.Design:
    d = await design_service.upload_design(session, key, line_id, file, _user(principal))
    return design_out(d)


@router.post("/so/{key}/lines/{line_id}/design/confirm", response_model=S.Design)
async def confirm_design(
    key: str, line_id: int, principal: Principal = _w, session: AsyncSession = Session
) -> S.Design:
    return design_out(await design_service.confirm_design(session, key, line_id, _user(principal)))


@router.get("/designs/{design_id}/file", dependencies=[_r], response_class=FileResponse)
async def design_file(design_id: int, session: AsyncSession = Session) -> FileResponse:
    path = await design_service.design_file(session, design_id, thumbnail=False)
    return FileResponse(path, filename=path.name)


@router.get("/designs/{design_id}/thumbnail", dependencies=[_r], response_class=FileResponse)
async def design_thumbnail(design_id: int, session: AsyncSession = Session) -> FileResponse:
    path = await design_service.design_file(session, design_id, thumbnail=True)
    return FileResponse(path, media_type="image/png")


# ======================================================================
# WO 제안·발행 (A2-03 · A2-04)
# ======================================================================
@router.post("/so/{key}/propose-wo", response_model=S.WoProposal, dependencies=[_w])
async def propose_wo(key: str, session: AsyncSession = Session) -> S.WoProposal:
    return S.WoProposal(items=await wo_service.propose_wo(session, key))


@router.post("/so/{key}/issue-wo", response_model=S.IssueWoResponse)
async def issue_wo(
    key: str,
    body: S.IssueWoRequest,
    principal: Principal = _w,
    session: AsyncSession = Session,
) -> S.IssueWoResponse:
    so, wos = await wo_service.issue_wo(session, key, body.drafts, _user(principal))
    views = await load_wo_views(session, wos)
    return S.IssueWoResponse(
        work_orders=await wo_outs(session, views), pdf_url=ports.so_pdf_url(so.code)
    )

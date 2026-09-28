"""작업지시 라우터 (api-contract §7.3). ``/wo`` 목록·상세·이벤트·hold·resume·cancel·close·split.

rework · reprint · search 는 S4/개발B 몫이라 여기 없다.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import permissions as P
from app.api.deps import Principal, Session, require_roles
from app.api.v1.schemas import order as S
from app.api.v1.schemas.common import Page
from app.api.v1.schemas.scan import ScanEventSummary
from app.domain.common.listing import PageDep, PageParams
from app.domain.order import wo_service
from app.domain.order.views import as_page, event_outs, load_wo_views, wo_detail, wo_out, wo_summary

router = APIRouter(prefix="/wo", tags=["work-order"])

_r = Depends(require_roles(*P.ORDER_READ, station=True))
_m = Depends(require_roles(*P.WO_MANAGE))
# §13.4 shopfloor ⑱ [S3]: STATION 도 허용(본문 approver_card+pin 은 서비스가 검사한다)
_split_gate = Depends(require_roles(*P.WO_MANAGE, station=True))


@router.get("", response_model=Page[S.WorkOrderSummary], dependencies=[_r])
async def list_wo(
    params: PageParams = PageDep,
    so_code: str | None = None,
    status: str | None = None,
    process_code: str | None = None,
    delay: bool = False,
    q: str | None = None,
    sort: str | None = None,
    session: AsyncSession = Session,
) -> dict[str, object]:
    views, total = await wo_service.list_work_orders(
        session,
        params,
        so_code=so_code,
        status=status,
        process_code=process_code,
        delay=delay,
        q=q,
        sort=sort,
    )
    return as_page([wo_summary(v) for v in views], total, params.page, params.size)


@router.get("/{key}", response_model=S.WorkOrderDetail, dependencies=[_r])
async def get_wo(key: str, session: AsyncSession = Session) -> S.WorkOrderDetail:
    return await wo_detail(session, await wo_service.get_wo_view(session, key))


@router.get("/{key}/events", response_model=Page[ScanEventSummary], dependencies=[_r])
async def wo_events(
    key: str, params: PageParams = PageDep, session: AsyncSession = Session
) -> dict[str, object]:
    wo = await wo_service.resolve_wo(session, key)
    rows, total = await wo_service.list_events(session, wo, params)
    return as_page(await event_outs(session, rows), total, params.page, params.size)


async def _out(session: AsyncSession, wo: object) -> S.WorkOrder:
    from app.db.models.order import WorkOrder

    assert isinstance(wo, WorkOrder)
    return await wo_out(session, (await load_wo_views(session, [wo]))[0])


@router.post("/{key}/hold", response_model=S.WorkOrder, dependencies=[_m])
async def hold_wo(key: str, body: S.ReasonRequest, session: AsyncSession = Session) -> S.WorkOrder:
    return await _out(session, await wo_service.hold_wo(session, key, body.reason))


@router.post("/{key}/resume", response_model=S.WorkOrder, dependencies=[_m])
async def resume_wo(key: str, session: AsyncSession = Session) -> S.WorkOrder:
    return await _out(session, await wo_service.resume_wo(session, key))


@router.post("/{key}/cancel", response_model=S.WorkOrder)
async def cancel_wo(
    key: str, body: S.ReasonRequest, principal: Principal = _m, session: AsyncSession = Session
) -> S.WorkOrder:
    assert principal.user is not None  # _m 은 JWT 전용
    return await _out(
        session, await wo_service.cancel_wo(session, key, body.reason, principal.user)
    )


@router.post("/{key}/close", response_model=S.WorkOrder, dependencies=[_m])
async def close_wo(key: str, session: AsyncSession = Session) -> S.WorkOrder:
    return await _out(session, await wo_service.close_wo(session, key))


@router.post("/{key}/split", response_model=S.SplitResponse)
async def split_wo(
    key: str,
    body: S.SplitRequest,
    principal: Principal = _split_gate,
    session: AsyncSession = Session,
) -> S.SplitResponse:
    parent, child = await wo_service.split_wo(session, key, body, principal)
    return S.SplitResponse(parent=await _out(session, parent), child=await _out(session, child))

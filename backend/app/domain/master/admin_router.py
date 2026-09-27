"""단말 · 사용자 · 코드 체계 라우터 (api-contract §7.2 · §13.2 · §13.3). 권한: ADMIN W · MANAGER R
(§4).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import permissions as P
from app.api.deps import CurrentStation, Principal, Session, require_roles
from app.api.v1.schemas import master as S
from app.api.v1.schemas.common import Page
from app.db.models.master import Station
from app.domain.common.listing import PageDep, PageParams
from app.domain.master import admin_service as svc

router = APIRouter(tags=["master-admin"])

_r = Depends(require_roles(*P.ADMIN_MASTER_READ))
_w = Depends(require_roles(*P.ADMIN_MASTER_WRITE))
_w_principal = _w


# ======================================================================
# 단말 — /stations/me 는 /stations/{id} 보다 먼저
# ======================================================================
@router.get("/stations/me", response_model=S.Station)
async def station_me(
    station: Station = CurrentStation, session: AsyncSession = Session
) -> S.Station:
    return await svc.station_out(session, station)


@router.get("/stations", response_model=Page[S.Station], dependencies=[_r])
async def list_stations(
    params: PageParams = PageDep,
    q: str | None = None,
    active: bool | None = None,
    type: S.StationType | None = None,  # noqa: A002 — 쿼리 파라미터명은 계약(type) 그대로
    sort: str | None = None,
    session: AsyncSession = Session,
) -> dict[str, object]:
    items, total = await svc.list_stations(
        session, params, q=q, active=active, type_=type, sort=sort
    )
    return {"items": items, "page": params.page, "size": params.size, "total": total}


@router.post("/stations", response_model=S.StationCreated, status_code=201, dependencies=[_w])
async def create_station(
    body: S.StationCreate, session: AsyncSession = Session
) -> S.StationCreated:
    return await svc.create_station(session, body)


@router.get("/stations/{station_id}", response_model=S.Station, dependencies=[_r])
async def get_station(station_id: str, session: AsyncSession = Session) -> S.Station:
    return await svc.station_out(session, await svc.get_station(session, station_id))


@router.patch("/stations/{station_id}", response_model=S.Station, dependencies=[_w])
async def update_station(
    station_id: str, body: S.StationUpdate, session: AsyncSession = Session
) -> S.Station:
    return await svc.update_station(session, station_id, body)


@router.post(
    "/stations/{station_id}/rotate-key", response_model=S.StationKeyRotated, dependencies=[_w]
)
async def rotate_key(station_id: str, session: AsyncSession = Session) -> S.StationKeyRotated:
    return await svc.rotate_station_key(session, station_id)


@router.post("/stations/{station_id}/deactivate", response_model=S.Station, dependencies=[_w])
async def deactivate_station(station_id: str, session: AsyncSession = Session) -> S.Station:
    return await svc.set_station_active(session, station_id, False)


@router.post("/stations/{station_id}/activate", response_model=S.Station, dependencies=[_w])
async def activate_station(station_id: str, session: AsyncSession = Session) -> S.Station:
    return await svc.set_station_active(session, station_id, True)


# ======================================================================
# 사용자
# ======================================================================
@router.get("/users", response_model=Page[S.User], dependencies=[_r])
async def list_users(
    params: PageParams = PageDep,
    q: str | None = None,
    active: bool | None = None,
    role: S.Role | None = None,
    sort: str | None = None,
    session: AsyncSession = Session,
) -> dict[str, object]:
    items, total = await svc.list_users(session, params, q=q, active=active, role=role, sort=sort)
    return {
        "items": [svc.user_out(u) for u in items],
        "page": params.page,
        "size": params.size,
        "total": total,
    }


@router.post("/users", response_model=S.User, status_code=201, dependencies=[_w])
async def create_user(body: S.UserCreate, session: AsyncSession = Session) -> S.User:
    return svc.user_out(await svc.create_user(session, body))


@router.get("/users/{user_id}", response_model=S.User, dependencies=[_r])
async def get_user(user_id: int, session: AsyncSession = Session) -> S.User:
    return svc.user_out(await svc.get_user(session, user_id))


@router.patch("/users/{user_id}", response_model=S.User, dependencies=[_w])
async def update_user(user_id: int, body: S.UserUpdate, session: AsyncSession = Session) -> S.User:
    return svc.user_out(await svc.update_user(session, user_id, body))


@router.post("/users/{user_id}/deactivate", response_model=S.User, dependencies=[_w])
async def deactivate_user(user_id: int, session: AsyncSession = Session) -> S.User:
    return svc.user_out(await svc.set_user_active(session, user_id, False))


@router.post("/users/{user_id}/activate", response_model=S.User, dependencies=[_w])
async def activate_user(user_id: int, session: AsyncSession = Session) -> S.User:
    return svc.user_out(await svc.set_user_active(session, user_id, True))


@router.post("/users/{user_id}/issue-card", response_model=S.IssueCardResponse, dependencies=[_w])
async def issue_card(
    user_id: int, body: S.IssueCardRequest | None = None, session: AsyncSession = Session
) -> S.IssueCardResponse:
    return await svc.issue_card(session, user_id, body or S.IssueCardRequest())


@router.post("/users/{user_id}/set-pin", response_model=S.User, dependencies=[_w])
async def set_pin(user_id: int, body: S.SetPinRequest, session: AsyncSession = Session) -> S.User:
    return svc.user_out(await svc.set_pin(session, user_id, body.pin))


@router.post("/users/{user_id}/set-password", response_model=S.User, dependencies=[_w])
async def set_password(
    user_id: int, body: S.SetPasswordRequest, session: AsyncSession = Session
) -> S.User:
    return svc.user_out(await svc.set_password(session, user_id, body.password))


# ======================================================================
# 코드 체계 (ADM-10) — 저장처 app_setting.CODE_SETTINGS
# ======================================================================
@router.get("/settings/codes", response_model=S.CodeSettings, dependencies=[_r])
async def get_code_settings(session: AsyncSession = Session) -> S.CodeSettings:
    return await svc.get_code_settings(session)


@router.put("/settings/codes", response_model=S.CodeSettings)
async def put_code_settings(
    body: S.CodeSettings,
    principal: Principal = _w_principal,
    session: AsyncSession = Session,
) -> S.CodeSettings:
    assert principal.user is not None
    return await svc.put_code_settings(session, body, principal.user.id)

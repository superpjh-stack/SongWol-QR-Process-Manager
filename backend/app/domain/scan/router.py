"""스캔 · 단말 라우터 (api-contract §7.6). ``/scan`` · ``/scan/batch`` ·
``/scan/{event_uuid}/approve`` · ``/scan/pending`` · ``/stations/{id}/queue`` ·
``/stations/{id}/equipment``.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentStation, Principal, Session, get_principal, require_roles
from app.api.v1.schemas import master as M
from app.api.v1.schemas import order as O
from app.api.v1.schemas import scan as S
from app.core.errors import ApiError, forbidden, not_found
from app.db.models.master import Station
from app.domain.scan import service

router = APIRouter(tags=["scan"])

_PRINCIPAL = Depends(get_principal)
_pending_r = Depends(require_roles("MANAGER", "ADMIN", station=True))


async def _resolve_station(session: AsyncSession, station_id: str) -> Station:
    station = await session.get(Station, station_id.strip().upper())
    if station is None:
        raise not_found("STATION_NOT_FOUND", "단말", station_id)
    return station


# ======================================================================
# 스캔 (§5)
# ======================================================================
@router.post("/scan", response_model=S.ScanResponse)
async def scan(
    body: S.ScanRequest,
    station: Station = CurrentStation,
    session: AsyncSession = Session,
) -> S.ScanResponse:
    return await service.handle_scan(session, station, body)


@router.post("/scan/batch", response_model=S.ScanBatchResponse)
async def scan_batch(
    body: dict[str, Any],
    station: Station = CurrentStation,
    session: AsyncSession = Session,
) -> S.ScanBatchResponse:
    events = body.get("events")
    if not isinstance(events, list):
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "events 배열이 필요합니다",
            [{"loc": ["body", "events"], "msg": "field required", "type": "missing"}],
        )
    if len(events) > 200:
        raise ApiError(
            422,
            "VALIDATION_ERROR",
            "한 번에 최대 200건까지 처리할 수 있습니다",
            [{"loc": ["body", "events"], "msg": "too many items", "type": "value_error"}],
        )
    return await service.handle_batch(session, station, events)


@router.post("/scan/{event_uuid}/approve", response_model=S.ScanResponse)
async def approve_scan(
    event_uuid: uuid.UUID,
    body: S.ApproveRequest,
    principal: Principal = _PRINCIPAL,
    session: AsyncSession = Session,
) -> S.ScanResponse:
    return await service.approve(session, principal, event_uuid, body)


@router.get("/scan/pending", response_model=list[S.PendingScan], dependencies=[_pending_r])
async def scan_pending(
    station_id: str | None = Query(default=None),
    principal: Principal = _PRINCIPAL,
    session: AsyncSession = Session,
) -> list[S.PendingScan]:
    effective = station_id
    if principal.is_station:
        assert principal.station is not None
        effective = principal.station.id
    return await service.list_pending(session, station_id=effective)


# ======================================================================
# 단말 (B2-04, B5-02)
# ======================================================================
@router.get("/stations/{station_id}/queue", response_model=O.QueueResponse)
async def stations_queue(
    station_id: str,
    limit: int = Query(default=8, ge=1, le=50),
    principal: Principal = _PRINCIPAL,
    session: AsyncSession = Session,
) -> O.QueueResponse:
    station = await _resolve_station(session, station_id)
    if principal.is_station:
        assert principal.station is not None
        if principal.station.id != station.id:
            raise forbidden()
    elif principal.role not in ("ADMIN", "MANAGER"):
        raise forbidden()
    return await service.station_queue(session, station, limit=limit)


@router.get("/stations/{station_id}/equipment", response_model=list[M.Equipment])
async def stations_equipment(
    station_id: str,
    print_method: str | None = Query(default=None),
    station: Station = CurrentStation,
    session: AsyncSession = Session,
) -> list[M.Equipment]:
    # station=자기 단말만 (CurrentStation 은 요청자 자신). path 의 station_id 가 다르면 거부.
    if station.id != station_id.strip().upper():
        raise forbidden()
    rows = await service.station_equipment(session, station, print_method=print_method)
    return [M.Equipment.model_validate(r) for r in rows]

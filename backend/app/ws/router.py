"""``WS /ws/board`` (api-contract §8 · §13.5 ㉓).

접속: ``?key=<station api key>``(BOARD/KIOSK 단말) 또는 ``?token=<jwt>``(관리자 웹, 모든
JWT 역할 — 대시보드 조회 권한은 §4 「대시보드·현황판」이 전 역할 R). 접속 직후 ``snapshot``,
5분마다 재전송(``app_setting BOARD_SNAPSHOT_INTERVAL_SEC``), 60초마다 ``ping`` — 클라이언트가
``pong`` 도 그 외 어떤 메시지도 120초 넘게 보내지 않으면 종료한다(단말은 재접속).

라우터는 최상위(``app.main`` 에 prefix 없이 include) — 계약 경로가 ``/ws/board`` 지
``/api/v1/ws/board`` 가 아니다.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import _load_station_from_key, _load_user_from_token
from app.api.v1.schemas import board as B
from app.core.config import get_settings
from app.core.errors import ApiError
from app.db.models.master import AppSetting, AppUser, Station
from app.db.session import SessionLocal
from app.domain.board import service as board_service
from app.ws.manager import manager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["ws"])

PING_INTERVAL_SEC = 60.0
PONG_TIMEOUT_SEC = PING_INTERVAL_SEC * 2  # 120초 무응답 → 종료 (spec: "무응답 시 종료")


async def _authenticate(
    session: AsyncSession, *, key: str | None, token: str | None
) -> tuple[Station | None, AppUser | None]:
    if token:
        try:
            user = await _load_user_from_token(session, token)
            return None, user
        except ApiError:
            return None, None
    if key:
        try:
            station = await _load_station_from_key(session, key)
            return station, None
        except ApiError:
            return None, None
    return None, None


async def _snapshot_interval_sec() -> float:
    async with SessionLocal() as session:
        row = await session.get(AppSetting, "BOARD_SNAPSHOT_INTERVAL_SEC")
        if row is not None:
            try:
                return float(row.value)
            except (TypeError, ValueError):
                pass
    return float(get_settings().board_snapshot_interval_sec)


async def _send_snapshot(websocket: WebSocket) -> None:
    async with SessionLocal() as session:
        summary = await board_service.dashboard_summary(session)
    msg = B.SnapshotMessage(at=datetime.now(UTC), summary=summary)
    await websocket.send_json(msg.model_dump(mode="json", by_alias=True))


async def _send_ping(websocket: WebSocket) -> None:
    msg = B.PingMessage(at=datetime.now(UTC))
    await websocket.send_json(msg.model_dump(mode="json", by_alias=True))


@router.websocket("/ws/board")
async def ws_board(
    websocket: WebSocket,
    key: str | None = Query(default=None),
    token: str | None = Query(default=None),
) -> None:
    async with SessionLocal() as session:
        station, user = await _authenticate(session, key=key, token=token)
    if station is None and user is None:
        await websocket.close(code=4401)
        return

    await manager.connect(websocket)
    try:
        await _send_snapshot(websocket)
        snapshot_interval = await _snapshot_interval_sec()
        last_activity = datetime.now(UTC)
        last_snapshot = datetime.now(UTC)
        while True:
            try:
                raw = await _receive_with_timeout(websocket, PING_INTERVAL_SEC)
            except TimeoutError:
                if (datetime.now(UTC) - last_activity).total_seconds() > PONG_TIMEOUT_SEC:
                    logger.info("WS /ws/board 무응답 — 연결을 종료합니다")
                    break
                await _send_ping(websocket)
            else:
                if raw is None:  # 연결 종료
                    break
                last_activity = datetime.now(UTC)
                # 클라이언트 → 서버는 {"type":"pong"} 뿐(§8) — 그 외 어떤 메시지가 와도
                # 활동으로만 보고 조용히 무시한다(구독 필터 없음, 계약 밖 메시지로 연결을
                # 끊지 않는다).
                with contextlib.suppress(ValueError):
                    json.loads(raw)
            if (datetime.now(UTC) - last_snapshot).total_seconds() >= snapshot_interval:
                await _send_snapshot(websocket)
                last_snapshot = datetime.now(UTC)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WS /ws/board 처리 중 오류")
    finally:
        await manager.disconnect(websocket)


async def _receive_with_timeout(websocket: WebSocket, timeout: float) -> str | None:
    try:
        return await asyncio.wait_for(websocket.receive_text(), timeout=timeout)
    except WebSocketDisconnect:
        return None

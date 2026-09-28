"""도메인 커밋 → ``/ws/board`` 브로드캐스트 연결점 (api-contract §8 표: "스캔 반영·승인·취소·
발행·보류").

``domain/scan/service.py`` · ``domain/order/wo_service.py`` 가 커밋 **직후**(이미 반영된
뒤) 이 모듈을 부른다 — 브로드캐스트는 부가 효과라 실패해도 삼킨다(스캔·발행 자체는 이미
성공했다, §8 은 "약 1초 내 반영"을 요구하지만 브로드캐스트 실패로 API 응답이 실패해서는
안 된다).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.schemas import board as B
from app.api.v1.schemas.scan import PendingScan
from app.db.models.order import WorkOrder
from app.domain.board import service as board_service
from app.ws.manager import manager

logger = logging.getLogger(__name__)


async def broadcast_wo_updated(session: AsyncSession, wo: WorkOrder) -> None:
    if manager.connection_count == 0:
        return
    try:
        msg = await board_service.wo_updated_message(session, wo)
        await manager.broadcast(msg.model_dump(mode="json", by_alias=True))
    except Exception:
        logger.exception("wo_updated 브로드캐스트 실패 (wo=%s)", wo.code)


async def broadcast_approval_pending(pending: PendingScan) -> None:
    if manager.connection_count == 0:
        return
    try:
        msg = B.ApprovalPendingMessage(at=datetime.now(UTC), pending=pending)
        await manager.broadcast(msg.model_dump(mode="json", by_alias=True))
    except Exception:
        logger.exception("approval_pending 브로드캐스트 실패")


async def broadcast_notification(n: B.Notification) -> None:
    if manager.connection_count == 0:
        return
    try:
        msg = B.NotificationMessage(at=datetime.now(UTC), notification=n)
        await manager.broadcast(msg.model_dump(mode="json", by_alias=True))
    except Exception:
        logger.exception("notification 브로드캐스트 실패")

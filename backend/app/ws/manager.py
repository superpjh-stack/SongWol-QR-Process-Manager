"""프로세스 내 WS 브로드캐스터 (api-contract §8, plan §5.1 "파일럿은 프로세스 내 브로드캐스터").

FastAPI 의 ``WebSocket`` 만 쓴다 — Redis 등 별도 브로커 없음(단일 프로세스 파일럿 규모).
이 모듈은 연결 registry 와 전송만 맡는다. 메시지 조립은 ``app/domain/board`` 가 한다(도메인
로직을 인프라 모듈에 섞지 않는다).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class BoardConnectionManager:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._connections.add(ws)

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(ws)

    @property
    def connection_count(self) -> int:
        return len(self._connections)

    async def send(self, ws: WebSocket, message: dict[str, Any]) -> None:
        await ws.send_json(message)

    async def broadcast(self, message: dict[str, Any]) -> None:
        """실패한 연결은 조용히 registry 에서 뺀다 — 스캔 커밋 경로가 죽은 소켓 하나 때문에
        느려지거나 실패해서는 안 된다(브로드캐스트는 부가 효과, 스캔 반영이 본질)."""
        async with self._lock:
            targets = list(self._connections)
        dead: list[WebSocket] = []
        for ws in targets:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    self._connections.discard(ws)
            logger.info("WS 브로드캐스트: 끊긴 연결 %d개 정리", len(dead))


manager = BoardConnectionManager()

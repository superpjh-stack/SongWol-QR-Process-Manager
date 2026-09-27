"""FastAPI 앱 진입점.

Phase 0 에는 ``/health`` 만 있다. 도메인 라우터·WebSocket 은 다음 웨이브에서 붙인다.
"""

import logging
from datetime import UTC, datetime
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel
from sqlalchemy import text

from app.core.config import get_settings
from app.db.session import engine

logger = logging.getLogger(__name__)

settings = get_settings()

app = FastAPI(title=settings.app_name, version="0.0.1")


class Health(BaseModel):
    status: Literal["ok"]
    db: Literal["ok", "error"]
    time: str


@app.get("/health", response_model=Health)
async def health() -> Health:
    """프로세스 생존 + DB 연결 확인.

    DB 가 죽어 있어도 200 을 돌려주되 ``db: "error"`` 로 드러낸다 (조용히 숨기지 않는다).
    프로세스 자체는 살아 있으므로 status 는 ok.
    """
    db: Literal["ok", "error"] = "ok"
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:
        logger.exception("health: DB check failed")
        db = "error"
    return Health(status="ok", db=db, time=datetime.now(UTC).isoformat())

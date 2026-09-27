"""ZPL 최소 렌더·전송 (api-contract §9). S0 는 작업자 카드(issue-card printer_id)만 쓴다.

S1-6 라벨 웨이브가 이 모듈을 확장한다 (템플릿 캐시·프린터 선택 순서 §13.7·label_issue 통합).
전송 실패는 예외로 올린다 — 호출자가 ``label_job.error`` 로 화면에 드러낸다 (재시도 큐 없음).
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

from jinja2 import Environment
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.checkcode import make_check
from app.core.config import get_settings
from app.db.models.master import LabelTemplate
from app.domain.label.templates import load_default_template

SEND_TIMEOUT_SEC = 3.0

_env = Environment(autoescape=False)  # noqa: S701 — ZPL 은 HTML 이 아니다


class PrinterUnreachable(Exception):
    pass


def qr_url(code: str) -> str:
    """spec §6: ``https://{PUBLIC_HOST}/q/{CODE}?c={CHECK}``."""
    return f"{get_settings().public_host.rstrip('/')}/q/{code}?c={make_check(code)}"


async def template_body(session: AsyncSession, label_type: str) -> str:
    row = await session.get(LabelTemplate, label_type)
    if row is not None:
        return row.body
    return load_default_template(label_type)[1]


def render(body: str, **ctx: Any) -> str:
    ctx.setdefault("printed_at", datetime.now(UTC).astimezone().strftime("%Y-%m-%d %H:%M"))
    return _env.from_string(body).render(**ctx)


async def send_zpl(host: str, port: int, zpl: str) -> None:
    """TCP 9100 전송, 3초 타임아웃. 실패 → PrinterUnreachable."""
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=SEND_TIMEOUT_SEC
        )
        writer.write(zpl.encode("utf-8"))
        await asyncio.wait_for(writer.drain(), timeout=SEND_TIMEOUT_SEC)
        writer.close()
        await writer.wait_closed()
    except (OSError, TimeoutError) as e:
        raise PrinterUnreachable(f"{host}:{port}: {e}") from e

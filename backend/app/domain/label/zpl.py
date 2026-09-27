"""ZPL 렌더·전송 (api-contract §9, plan §5.1).

- 템플릿은 label_template 테이블(없으면 ``templates/*.j2`` 기본본)의 Jinja2 원문
- ``compile_template()`` 은 문법 검증 (PUT 시 422 BAD_TEMPLATE)
- 렌더는 ``StrictUndefined`` — 플레이스홀더 밖의 변수를 쓰면 즉시 오류 (조용한 빈 문자열 금지)
- ``send_zpl()`` TCP ``host:port`` 3초 타임아웃. 실패는 ``PrinterUnreachable`` — 호출자가 응답에
  ``zpl_sent=false, error=PRINTER_UNREACHABLE`` 로 드러낸다 (§13.7, 재시도 큐 없음)

S0 의 issue-card(admin #17) 경로가 ``template_body``·``render``·``send_zpl``·``qr_url`` 을 쓴다 —
이름·시그니처를 유지한다.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

from jinja2 import Environment, StrictUndefined, Template, TemplateSyntaxError, UndefinedError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.schemas.common import TZ_SEOUL
from app.db.models.master import LabelTemplate
from app.domain.label.placeholders import TEST_LABEL_TYPE
from app.domain.label.qr import ZPL_QR_MAG_DEFAULT, qr_url
from app.domain.label.templates import load_default_template, load_test_template

__all__ = [
    "SEND_TIMEOUT_SEC",
    "BadTemplate",
    "PrinterUnreachable",
    "compile_template",
    "qr_url",
    "render",
    "send_zpl",
    "template_body",
    "with_copies",
]

SEND_TIMEOUT_SEC = 3.0

_env = Environment(autoescape=False, undefined=StrictUndefined)  # noqa: S701 — ZPL 은 HTML 이 아니다


class PrinterUnreachable(Exception):
    pass


class BadTemplate(Exception):
    """Jinja2 문법 오류 또는 선언되지 않은 변수 사용."""


def compile_template(body: str) -> Template:
    try:
        return _env.from_string(body)
    except TemplateSyntaxError as e:
        raise BadTemplate(f"{e.lineno}행: {e.message}") from e


async def template_body(session: AsyncSession, label_type: str) -> str:
    if label_type == TEST_LABEL_TYPE:
        return load_test_template()
    row = await session.get(LabelTemplate, label_type)
    if row is not None:
        return row.body
    return load_default_template(label_type)[1]


def printed_now() -> str:
    return datetime.now(UTC).astimezone(TZ_SEOUL).strftime("%Y-%m-%d %H:%M")


def render(body: str, **ctx: Any) -> str:
    """Jinja2 렌더. ``printed_at``·``qr_ecc``·``qr_mag`` 은 없으면 기본값을 채운다."""
    ctx.setdefault("printed_at", printed_now())
    ctx.setdefault("qr_ecc", "Q")
    ctx.setdefault("qr_mag", ZPL_QR_MAG_DEFAULT)
    try:
        return compile_template(body).render(**ctx)
    except UndefinedError as e:
        raise BadTemplate(f"정의되지 않은 변수: {e.message}") from e


def with_copies(zpl: str, copies: int) -> str:
    """부수만큼 라벨 블록을 이어 붙인다 (템플릿의 ^PQ 유무와 무관)."""
    return zpl if copies <= 1 else "\n".join([zpl] * copies)


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

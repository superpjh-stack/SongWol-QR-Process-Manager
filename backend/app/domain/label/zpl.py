"""ZPL 렌더·전송 (api-contract §9, plan §5.1).

- 템플릿은 label_template 테이블(없으면 ``templates/*.j2`` 기본본)의 Jinja2 원문
- ``compile_template()`` 은 문법 검증 (PUT 시 422 BAD_TEMPLATE)
- 렌더는 ``ImmutableSandboxedEnvironment`` + ``StrictUndefined`` (D42, DEF-QA2-S1-002 SSTI):
  ``__class__``·``__globals__`` 같은 안전하지 않은 속성 접근은 SecurityError → BadTemplate.
  PUT 은 추가로 ``undeclared_names()`` 로 플레이스홀더 밖의 이름(``cycler``·``self``·``range``
  같은 전역 포함)을 거부한다 — 허용 변수만
- ``send_zpl()`` TCP ``host:port`` 3초 타임아웃. 실패는 ``PrinterUnreachable`` — 호출자가 응답에
  ``zpl_sent=false, error=PRINTER_UNREACHABLE`` 로 드러낸다 (§13.7, 재시도 큐 없음)

S0 의 issue-card(admin #17) 경로가 ``template_body``·``render``·``send_zpl``·``qr_url`` 을 쓴다 —
이름·시그니처를 유지한다.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

from jinja2 import StrictUndefined, Template, TemplateSyntaxError, UndefinedError, nodes
from jinja2.exceptions import SecurityError
from jinja2.sandbox import ImmutableSandboxedEnvironment
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

# autoescape 없음: ZPL 은 HTML 이 아니다. HTML 양식은 관리자만 편집 (D42: 샌드박스로 코드 실행 차단)
_env = ImmutableSandboxedEnvironment(autoescape=False, undefined=StrictUndefined)  # noqa: S701
_env.globals.clear()  # range·cycler·joiner·namespace·lipsum·dict 전역 제거 — 플레이스홀더만 보인다

# for 안의 ``loop`` 만 묵시 허용. 그 외 전역·``self``·``super``·``caller`` 는 전부 거부한다
IMPLICIT_NAMES = frozenset({"loop"})


class PrinterUnreachable(Exception):
    pass


class BadTemplate(Exception):
    """Jinja2 문법 오류 또는 선언되지 않은 변수 사용."""


def compile_template(body: str) -> Template:
    try:
        return _env.from_string(body)
    except TemplateSyntaxError as e:
        raise BadTemplate(f"{e.lineno}행: {e.message}") from e


def undeclared_names(body: str) -> set[str]:
    """템플릿이 읽는 자유 변수 이름 — for 변수·set·macro 인자로 묶인 이름과 ``loop`` 는 제외.

    ``jinja2.meta`` 와 달리 전역(``range``·``cycler``)과 ``self`` 도 보고한다 (D42: 허용 변수만).
    ``_`` 로 시작하는 속성·키 접근(``__class__`` 등) 은 문법 단계에서 바로 거부한다.
    """
    try:
        ast = _env.parse(body)
    except TemplateSyntaxError as e:
        raise BadTemplate(f"{e.lineno}행: {e.message}") from e
    for attr in ast.find_all(nodes.Getattr):
        if attr.attr.startswith("_"):
            raise BadTemplate(f"허용되지 않는 속성 접근: .{attr.attr}")
    for item in ast.find_all(nodes.Getitem):
        arg = item.arg
        if (
            isinstance(arg, nodes.Const)
            and isinstance(arg.value, str)
            and arg.value.startswith("_")
        ):
            raise BadTemplate(f"허용되지 않는 키 접근: [{arg.value!r}]")
    bound = {n.name for n in ast.find_all(nodes.Name) if n.ctx in ("store", "param")}
    loaded = {n.name for n in ast.find_all(nodes.Name) if n.ctx == "load"}
    return loaded - bound - IMPLICIT_NAMES


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
    except SecurityError as e:
        raise BadTemplate(f"허용되지 않는 표현식: {e}") from e
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

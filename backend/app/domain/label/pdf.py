"""작업지시서 PDF (S1-5, spec §6 ①, api-contract §9).

표지(SO QR 30 mm · 거래처 · 납기 · 라인 요약 · WO 요약) + WO 마다 1쪽(WO QR 30 mm · 품목·규격·
색상·수량·가공방식 · 도안 썸네일 · 라우팅 단계 · 표준 리드타임 · 발행 차수).
HTML(Jinja2, label_template WORK_ORDER_PDF) → WeasyPrint.

- 차수: GET 은 읽기 전용이다. 표지·WO 쪽의 ``issue_no`` 는 label_issue 의 마지막 차수
  (``issue_labels_for_wo`` 가 발행 시 1차를 기록, 재발행은 개발A 의 ``POST /wo/{id}/reprint`` 가
  ``record_issue`` 로 올린다). 한 번도 발행되지 않았으면 0 (양식이 「미발행」으로 표시)
- 한글 폰트: NanumGothic ttf 가 있으면 @font-face, 없으면 시스템 폰트 이름(Apple SD Gothic Neo 등)에
  맡긴다. 둘 다 없으면 글자가 깨진다 → ``korean_font_status()`` 로 드러낸다
- WeasyPrint 는 시스템 라이브러리(pango·cairo·gdk-pixbuf·libffi)가 필요하다. import 실패는
  ``PdfUnavailable`` 로 올린다 (조용히 빈 PDF 를 주지 않는다)
"""

from __future__ import annotations

import base64
import logging
import mimetypes
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import ApiError
from app.db.models.master import Customer, Item, PrintMethod
from app.db.models.order import SalesOrder, SalesOrderLine, WorkOrder
from app.domain.label import zpl as zpl_mod
from app.domain.label.qr import qr_png_data_uri, qr_url

logger = logging.getLogger(__name__)

PDF_QR_PX = 360  # 30 mm 박스에 들어갈 심볼 PNG 목표 픽셀 (배율 내림, 확대 시 nearest)

_REPO_ROOT = Path(__file__).resolve().parents[4]

KOREAN_FONT_CANDIDATES: tuple[Path, ...] = (
    Path("/usr/share/fonts/truetype/nanum/NanumGothic.ttf"),
    Path("/usr/share/fonts/nanum/NanumGothic.ttf"),
    Path("/Library/Fonts/NanumGothic.ttf"),
    Path.home() / "Library/Fonts/NanumGothic.ttf",
    _REPO_ROOT / "backend/var/fonts/NanumGothic.ttf",
)
SYSTEM_FONT_NAMES: tuple[Path, ...] = (
    Path("/System/Library/Fonts/AppleSDGothicNeo.ttc"),  # macOS — 이름(fontconfig)으로 쓴다
)


class PdfUnavailable(Exception):
    pass


def korean_font_file() -> Path | None:
    for p in KOREAN_FONT_CANDIDATES:
        if p.is_file():
            return p
    return None


def korean_font_status() -> str:
    """보고·/health 용: 어떤 한글 폰트를 쓰는지."""
    f = korean_font_file()
    if f is not None:
        return f"@font-face {f}"
    for p in SYSTEM_FONT_NAMES:
        if p.is_file():
            return f"system {p.name}"
    return "NONE — 한글이 깨진다 (fonts-nanum 설치 필요)"


def korean_font_css() -> str:
    f = korean_font_file()
    if f is None:
        return "/* 시스템 한글 폰트 사용 */"
    return f'@font-face {{ font-family: "SongwolKR"; src: url("{f.as_uri()}"); }}'


def _file_data_uri(path: str | None) -> str | None:
    """도안 썸네일 경로 → data URI. 절대경로 또는 backend/var 기준 상대경로. 없으면 None."""
    if not path:
        return None
    candidates = [Path(path), _REPO_ROOT / "backend" / "var" / path, _REPO_ROOT / path]
    for p in candidates:
        if p.is_file():
            mime = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
            return f"data:{mime};base64,{base64.b64encode(p.read_bytes()).decode('ascii')}"
    return None


async def so_lines(session: AsyncSession, so_id: int) -> list[dict[str, Any]]:
    stmt = (
        select(SalesOrderLine, Item, PrintMethod)
        .join(Item, Item.id == SalesOrderLine.item_id)
        .outerjoin(PrintMethod, PrintMethod.code == SalesOrderLine.print_method)
        .where(SalesOrderLine.so_id == so_id)
        .order_by(SalesOrderLine.line_no)
    )
    return [
        {
            "line_no": line.line_no,
            "item_code": item.code,
            "item_name": item.name,
            "spec": item.spec,
            "color": item.color,
            "print_method_name": pm.name if pm else line.print_method,
            "qty": line.qty,
        }
        for line, item, pm in (await session.execute(stmt)).all()
    ]


async def document_context(
    session: AsyncSession, so: SalesOrder, only_wo: WorkOrder | None
) -> dict[str, Any]:
    """표지 + work_orders[] 컨텍스트. ``only_wo`` 면 그 WO 한 쪽만."""
    from app.domain.label.service import last_issue_no, wo_context

    customer = await session.get(Customer, so.customer_id)
    cancelled = 0
    if only_wo is not None:
        wos = [only_wo]
    else:
        # DRAFT(미발행)·CANCELLED(취소, DEF-QA1-S1-004) 는 쪽을 만들지 않는다. 취소는 표지에 건수만.
        stmt = (
            select(WorkOrder)
            .where(WorkOrder.so_id == so.id, WorkOrder.status != "DRAFT")
            .order_by(WorkOrder.code)
        )
        all_wos = list((await session.execute(stmt)).scalars().all())
        wos = [w for w in all_wos if w.status != "CANCELLED"]
        cancelled = len(all_wos) - len(wos)
    work_orders: list[dict[str, Any]] = []
    for wo in wos:
        ctx = await wo_context(session, wo)
        ctx["qr_png_uri"] = qr_png_data_uri(wo.code, "M", PDF_QR_PX, border=0)
        ctx["design_thumbnail_uri"] = _file_data_uri(ctx["design_thumbnail_path"])
        ctx["issue_no"] = await last_issue_no(session, "WO", wo.code, "WORK_ORDER_PDF")
        ctx["std_lead_total"] = _sum_hours(ctx["steps"])
        work_orders.append(ctx)
    return {
        "code": so.code,
        "qr_url": qr_url(so.code),
        "qr_png_uri": qr_png_data_uri(so.code, "M", PDF_QR_PX, border=0),
        "issue_no": await last_issue_no(session, "SO", so.code, "WORK_ORDER_PDF"),
        "cancelled_count": cancelled,
        "customer_name": customer.name if customer else "",
        "order_date": so.order_date.isoformat(),
        "due_date": so.due_date.isoformat(),
        "lines": await so_lines(session, so.id),
        "work_orders": work_orders,
        "font_css": korean_font_css(),
        # admin #18 의 WO 플레이스홀더를 표지 수준에서도 참조할 수 있게 첫 WO 값(없으면 빈값)
        **_first_wo_fields(work_orders),
    }


def _sum_hours(steps: list[dict[str, Any]]) -> str:
    total = 0.0
    for s in steps:
        try:
            total += float(s["std_lead_hours"] or 0)
        except (TypeError, ValueError):
            pass
    return f"{total:g}"


_WO_TOP_FIELDS = (
    "so_code",
    "item_name",
    "spec",
    "color",
    "print_method_name",
    "qty_ordered",
    "design_thumbnail_path",
    "steps",
)


def _first_wo_fields(work_orders: list[dict[str, Any]]) -> dict[str, Any]:
    first = work_orders[0] if work_orders else {}
    return {k: first.get(k, [] if k == "steps" else None) for k in _WO_TOP_FIELDS}


def sample_document_context() -> dict[str, Any]:
    from app.domain.label.placeholders import SAMPLE_CONTEXT

    wo: dict[str, Any] = dict(SAMPLE_CONTEXT["WO_LABEL"])
    wo.update(
        qr_url=qr_url(str(wo["code"])),
        qr_png_uri=qr_png_data_uri(str(wo["code"]), "M", PDF_QR_PX, border=0),
        design_thumbnail_uri=None,
        issue_no=1,
        std_lead_total=_sum_hours(wo["steps"]),
    )
    so_code = str(wo["so_code"])
    return {
        "code": so_code,
        "qr_url": qr_url(so_code),
        "qr_png_uri": qr_png_data_uri(so_code, "M", PDF_QR_PX, border=0),
        "issue_no": 1,
        "cancelled_count": 0,
        "customer_name": wo["customer_name"],
        "order_date": "2026-09-28",
        "due_date": wo["due_date"],
        "lines": [
            {
                "line_no": 1,
                "item_code": "I-0001",
                "item_name": wo["item_name"],
                "spec": wo["spec"],
                "color": wo["color"],
                "print_method_name": wo["print_method_name"],
                "qty": wo["qty_ordered"],
            }
        ],
        "work_orders": [wo],
        "font_css": korean_font_css(),
        **_first_wo_fields([wo]),
    }


def html_to_pdf(html: str) -> bytes:
    try:
        from weasyprint import HTML
    except (ImportError, OSError) as e:  # OSError: pango/cairo 시스템 라이브러리 없음
        raise PdfUnavailable(str(e)) from e
    result: bytes = HTML(string=html, base_url=str(_REPO_ROOT)).write_pdf()
    return result


async def render_work_order_pdf(
    session: AsyncSession, so: SalesOrder, only_wo: WorkOrder | None = None
) -> bytes:
    body = await zpl_mod.template_body(session, "WORK_ORDER_PDF")
    ctx = await document_context(session, so, only_wo)
    try:
        html = zpl_mod.render(body, **ctx)
    except zpl_mod.BadTemplate as e:
        raise ApiError(422, "BAD_TEMPLATE", f"WORK_ORDER_PDF 양식 오류: {e}") from e
    try:
        return html_to_pdf(html)
    except PdfUnavailable as e:
        # 배포 결함(시스템 라이브러리 누락). §14.2 에 맞는 코드가 없어 500 으로 드러낸다 — 보고 항목
        logger.error("WeasyPrint unavailable: %s", e)
        raise RuntimeError(f"PDF 렌더러(WeasyPrint)를 불러올 수 없습니다: {e}") from e


def public_pdf_url(so_code: str) -> str:
    """IssueWoResponse.pdf_url 용 (개발A 가 쓴다)."""
    return f"{get_settings().public_host.rstrip('/')}/api/v1/labels/so/{so_code}.pdf"

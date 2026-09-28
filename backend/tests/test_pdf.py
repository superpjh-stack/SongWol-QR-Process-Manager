"""S1-5 작업지시서 PDF: `%PDF` 헤더 · 쪽 수(표지 + WO 수) · WO 없는 SO 는 표지만 · 권한 ·
한글 폰트."""

from __future__ import annotations

import io

import pypdfium2 as pdfium
from httpx import AsyncClient

from app.db.session import SessionLocal
from app.domain.label import pdf as pdf_mod
from app.domain.label import service as svc
from tests.conftest import headers_for
from tests.label_helpers import make_so

API = "/api/v1"


def _pages(pdf: bytes) -> int:
    return len(pdfium.PdfDocument(io.BytesIO(pdf)))


def _text(pdf: bytes) -> str:
    doc = pdfium.PdfDocument(io.BytesIO(pdf))
    return "\n".join(doc[i].get_textpage().get_text_range() for i in range(len(doc)))


async def test_so_pdf_cover_plus_wo_pages(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    data = await make_so(with_wo=2)
    async with SessionLocal() as s:
        await svc.record_issue(s, "SO", data["so_code"], "WORK_ORDER_PDF")
        await s.commit()
    res = await client.get(f"{API}/labels/so/{data['so_code']}.pdf", headers=admin_headers)
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("application/pdf")
    assert data["so_code"] in res.headers["content-disposition"]
    pdf = res.content
    assert pdf[:5] == b"%PDF-"
    assert _pages(pdf) == 3  # 표지 + WO 2쪽
    text = _text(pdf)
    assert data["so_code"] in text and all(c in text for c in data["wo_codes"])
    assert data["customer_name"] in text and "P30" in text and "24.0" in text
    assert "발행 1차" in text  # 표지 차수 (record_issue)
    # GET 은 차수를 올리지 않는다
    async with SessionLocal() as s:
        assert await svc.last_issue_no(s, "SO", data["so_code"], "WORK_ORDER_PDF") == 1


async def test_so_pdf_without_wo_is_cover_only(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    data = await make_so(with_wo=0)
    res = await client.get(f"{API}/labels/so/{data['so_code'].lower()}.pdf", headers=admin_headers)
    assert res.status_code == 200 and _pages(res.content) == 1
    assert "미발행" in _text(res.content)
    # DRAFT WO 는 표지 요약에도 넣지 않는다
    data = await make_so(with_wo=1, issued=False)
    res = await client.get(f"{API}/labels/so/{data['so_code']}.pdf", headers=admin_headers)
    assert res.status_code == 200 and _pages(res.content) == 1


async def test_wo_pdf_and_errors(client: AsyncClient, admin_headers: dict[str, str]) -> None:
    data = await make_so(with_wo=2)
    res = await client.get(
        f"{API}/labels/work-order/{data['wo_codes'][1]}.pdf", headers=admin_headers
    )
    assert res.status_code == 200 and _pages(res.content) == 2
    assert data["wo_codes"][1] in _text(res.content)
    res = await client.get(f"{API}/labels/so/SO-990101-9999.pdf", headers=admin_headers)
    assert res.status_code == 404 and res.json()["code"] == "SO_NOT_FOUND"
    res = await client.get(f"{API}/labels/work-order/WO-990101-9999.pdf", headers=admin_headers)
    assert res.status_code == 404 and res.json()["code"] == "WO_NOT_FOUND"
    assert (await client.get(f"{API}/labels/so/{data['so_code']}.pdf")).status_code == 401
    viewer = await headers_for(client, "t_viewer", "VIEWER")
    assert (
        await client.get(f"{API}/labels/so/{data['so_code']}.pdf", headers=viewer)
    ).status_code == 200  # 전 역할 R


def test_korean_font_and_sample_document() -> None:
    assert not pdf_mod.korean_font_status().startswith("NONE"), pdf_mod.korean_font_status()
    ctx = pdf_mod.sample_document_context()
    assert ctx["work_orders"] and ctx["qr_png_uri"].startswith("data:image/png")
    pdf = pdf_mod.html_to_pdf("<html><body><p>한글</p></body></html>")
    assert pdf[:5] == b"%PDF-" and _pages(pdf) == 1


async def test_so_pdf_excludes_cancelled_wo(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    """DEF-QA1-S1-004: CANCELLED WO 는 쪽 없음, 표지에 「취소 n건」."""
    from sqlalchemy import select

    from app.db.models.order import WorkOrder

    data = await make_so(with_wo=2)
    async with SessionLocal() as s:
        wo = (
            await s.execute(select(WorkOrder).where(WorkOrder.code == data["wo_codes"][1]))
        ).scalar_one()
        wo.status = "CANCELLED"
        await s.commit()
    res = await client.get(f"{API}/labels/so/{data['so_code']}.pdf", headers=admin_headers)
    assert res.status_code == 200 and _pages(res.content) == 2
    text = _text(res.content)
    assert data["wo_codes"][0] in text and data["wo_codes"][1] not in text
    assert "취소 1건" in text


def _qr_symbol_mm(pdf: bytes, page: int = 0, dpi: int = 300) -> tuple[float, float]:
    """오른쪽 상단 QR 심볼의 검은 모듈 영역 폭·높이(mm). 행별 어두운 구간 폭이 26~36mm 인 행만 센다
    (테두리선은 훨씬 넓고, 캡션 글자는 더 좁다)."""
    doc = pdfium.PdfDocument(io.BytesIO(pdf))
    im = doc[page].render(scale=dpi / 72).to_pil().convert("L")
    w, h = im.size
    px = im.load()
    x0 = int(w * 0.6)
    per_mm = dpi / 25.4
    rows: list[tuple[int, int, int]] = []
    for y in range(0, int(h * 0.25)):
        xs = [x for x in range(x0, w) if px[x, y] < 128]
        if not xs:
            continue
        width_mm = (xs[-1] - xs[0] + 1) / per_mm
        if 26 <= width_mm <= 36:
            rows.append((y, xs[0], xs[-1]))
    assert rows, "QR rows not found"
    # 파인더 패턴 행(위·아래 7모듈)은 항상 전폭이므로 y 범위가 심볼 높이다
    width = (max(r[2] for r in rows) - min(r[1] for r in rows) + 1) / per_mm
    height = (max(r[0] for r in rows) - min(r[0] for r in rows) + 1) / per_mm
    return width, height


async def test_pdf_qr_symbol_is_30mm(client: AsyncClient, admin_headers: dict[str, str]) -> None:
    """DEF-QA2-S1-006 / D50: 심볼 자체 ≥ 29mm (quiet zone 은 CSS 여백)."""
    data = await make_so(with_wo=1)
    res = await client.get(f"{API}/labels/so/{data['so_code']}.pdf", headers=admin_headers)
    assert res.status_code == 200
    for page in (0, 1):
        width, height = _qr_symbol_mm(res.content, page)
        assert 29.0 <= width <= 31.5, (page, width)
        assert height >= 29.0, (page, height)

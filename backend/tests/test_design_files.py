"""S1 수정: 도안 업로드 형식 판정(매직 바이트, D51) · svg script 차단 · 파일 GET attachment ·
단말 키 허용(F37/D49). 순수 함수 ``app.core.filetype`` 도 함께."""

from __future__ import annotations

import io

import pytest
from httpx import AsyncClient

from app.core import filetype
from app.core.errors import ApiError
from tests.conftest import ensure_station
from tests.helpers_order import make_so, png_bytes, setup_master, upload_design

API = "/api/v1"
SVG_OK = (
    b'<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg">'
    b'<rect width="1" height="1"/></svg>'
)
SVG_SCRIPT = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
SVG_ONLOAD = b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'
SVG_JS_HREF = b'<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"/></svg>'


def jpeg_bytes() -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (32, 32), (10, 200, 10)).save(buf, format="JPEG")
    return buf.getvalue()


def test_sniff_and_resolve_ext() -> None:
    assert filetype.sniff(png_bytes()) == "png"
    assert filetype.sniff(jpeg_bytes()) == "jpeg"
    assert filetype.sniff(b"%PDF-1.7\n") == "pdf"
    assert filetype.sniff(SVG_OK) == "svg"
    assert filetype.sniff(b"<!-- c -->\n<SVG>") == "svg"
    assert filetype.sniff(b"MZ\x90\x00") is None
    assert filetype.resolve_design_ext("jpeg", jpeg_bytes()) == "jpg"
    assert filetype.resolve_design_ext("ai", b"%PDF-1.4") == "ai"
    assert filetype.resolve_design_ext("pdf", b"%PDF-1.4") == "pdf"
    for claimed, head in (
        ("jpg", png_bytes()),
        ("png", b"%PDF-"),
        ("svg", png_bytes()),
        ("png", b"junk"),
    ):
        with pytest.raises(ApiError) as ei:
            filetype.resolve_design_ext(claimed, head)
        assert ei.value.status == 422 and ei.value.code == "BAD_FILE_TYPE"
    filetype.check_svg_safe(SVG_OK.decode())
    for bad in (SVG_SCRIPT, SVG_ONLOAD, SVG_JS_HREF):
        with pytest.raises(ApiError) as ei:
            filetype.check_svg_safe(bad.decode())
        assert ei.value.code == "BAD_FILE_TYPE"


async def test_design_upload_magic_bytes_and_svg(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    m = await setup_master(client, admin_headers)
    so = await make_so(client, admin_headers, m)
    line_id = so["lines"][0]["id"]
    up = lambda name, data: upload_design(  # noqa: E731
        client, admin_headers, so["id"], line_id, filename=name, content=data
    )
    # DEF-QA2-S1-013: .jpg 이름의 PNG 바이트 → 422
    res = await up("design.jpg", png_bytes())
    assert res.status_code == 422 and res.json()["code"] == "BAD_FILE_TYPE", res.text
    # 내용 미판정 → 422
    res = await up("design.png", b"not an image at all")
    assert res.status_code == 422 and res.json()["code"] == "BAD_FILE_TYPE"
    # DEF-QA2-S1-010: svg script / on* / javascript: → 422
    for bad in (SVG_SCRIPT, SVG_ONLOAD, SVG_JS_HREF):
        res = await up("design.svg", bad)
        assert res.status_code == 422 and res.json()["code"] == "BAD_FILE_TYPE", bad
    # 정상: jpeg 는 .jpg 로 저장, svg 안전본 OK, .ai(PDF 헤더) 유지
    res = await up("photo.jpeg", jpeg_bytes())
    assert res.status_code == 201, res.text
    v_jpg = res.json()
    res = await client.get(v_jpg["file_url"], headers=admin_headers)
    assert res.status_code == 200 and res.content[:3] == b"\xff\xd8\xff"
    assert res.headers["content-disposition"].startswith("attachment")
    assert res.headers["content-disposition"].endswith('.jpg"')
    res = await up("art.svg", SVG_OK)
    assert res.status_code == 201, res.text
    v_svg = res.json()
    res = await client.get(v_svg["file_url"], headers=admin_headers)
    assert res.status_code == 200 and res.headers["content-disposition"].startswith("attachment")
    assert v_svg["thumbnail_url"] is None
    res = await up("logo.ai", b"%PDF-1.5\n%\xe2\xe3\xcf\xd3\n")
    assert res.status_code == 201 and res.json()["version"] == 3
    res = await client.get(res.json()["file_url"], headers=admin_headers)
    assert res.headers["content-disposition"].endswith('.ai"')
    # 실패한 업로드는 임시 파일을 남기지 않는다
    from pathlib import Path

    from app.core.config import get_settings

    leftovers = list((Path(get_settings().design_dir) / so["code"]).rglob("*.upload"))
    assert leftovers == []


async def test_design_file_station_key_and_thumbnail_inline(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    """F37 / D49: JWT 또는 X-Station-Key. 썸네일은 inline(png), 원본은 attachment."""
    m = await setup_master(client, admin_headers)
    so = await make_so(client, admin_headers, m)
    line_id = so["lines"][0]["id"]
    res = await upload_design(client, admin_headers, so["id"], line_id)
    assert res.status_code == 201
    d = res.json()
    _, key = await ensure_station("T-K-DSN-1")
    for url in (d["file_url"], d["thumbnail_url"]):
        assert (await client.get(url)).status_code == 401
        assert (await client.get(url, headers={"X-Station-Key": key})).status_code == 200
        assert (await client.get(url, headers={"X-Station-Key": "bogus"})).status_code == 401
    res = await client.get(d["file_url"], headers={"X-Station-Key": key})
    assert (
        res.headers["content-disposition"].startswith("attachment")
        and res.content[:4] == b"\x89PNG"
    )
    res = await client.get(d["thumbnail_url"], headers={"X-Station-Key": key})
    assert res.headers["content-type"].startswith("image/png")
    assert not res.headers.get("content-disposition", "").startswith("attachment")

"""업로드 파일 형식 판정 — 확장자가 아니라 매직 바이트로 (D51, DEF-QA2-S1-010/013).

- ``sniff(head)`` → 'png' | 'jpeg' | 'pdf' | 'svg' | None
- ``resolve_design_ext(claimed_ext, head)`` → 저장 확장자. 내용을 못 알아보거나 확장자와 어긋나면
  422 BAD_FILE_TYPE. ``.ai`` 는 PDF 호환(현대 AI 파일은 %PDF 헤더)이라 ai 로 유지
- ``check_svg_safe(text)``: ``<script`` · ``on*=`` 이벤트 속성 · ``javascript:`` 가 있으면 422
"""

from __future__ import annotations

import re

from app.core.errors import ApiError, validation

SNIFF_BYTES = 4096

_PNG = b"\x89PNG\r\n\x1a\n"
_JPEG = b"\xff\xd8\xff"
_PDF = b"%PDF-"
_SVG_ROOT = re.compile(rb"<svg[\s>]", re.IGNORECASE)
_XML_OR_WS = re.compile(rb"^\s*(<\?xml[^>]*\?>\s*)?(<!--.*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?", re.S)

# 판정된 형식 → 허용 확장자, 저장 확장자
_COMPAT: dict[str, tuple[frozenset[str], str]] = {
    "png": (frozenset({"png"}), "png"),
    "jpeg": (frozenset({"jpg", "jpeg"}), "jpg"),
    "pdf": (frozenset({"pdf", "ai"}), "pdf"),
    "svg": (frozenset({"svg"}), "svg"),
}

_SVG_UNSAFE = (
    re.compile(r"<\s*script", re.IGNORECASE),
    re.compile(r"\son[a-z]+\s*=", re.IGNORECASE),
    re.compile(r"javascript\s*:", re.IGNORECASE),
)


def sniff(head: bytes) -> str | None:
    if head.startswith(_PNG):
        return "png"
    if head.startswith(_JPEG):
        return "jpeg"
    if head.startswith(_PDF):
        return "pdf"
    m = _XML_OR_WS.match(head)
    rest = head[m.end() :] if m else head
    if _SVG_ROOT.match(rest):
        return "svg"
    return None


def _bad(msg: str) -> ApiError:
    return validation(["body", "file"], msg, "BAD_FILE_TYPE")


def resolve_design_ext(claimed_ext: str, head: bytes) -> str:
    """저장에 쓸 확장자 (내용 기준). 불일치·미판정은 422 BAD_FILE_TYPE."""
    kind = sniff(head)
    if kind is None:
        raise _bad(f"파일 내용이 png/jpeg/pdf/svg 형식이 아닙니다 (.{claimed_ext})")
    allowed, canonical = _COMPAT[kind]
    if claimed_ext not in allowed:
        raise _bad(f"확장자 .{claimed_ext} 와 파일 내용({kind}) 이 다릅니다")
    return "ai" if claimed_ext == "ai" else canonical


def check_svg_safe(text: str) -> None:
    for pat in _SVG_UNSAFE:
        if pat.search(text):
            raise _bad("svg 에 스크립트·이벤트 속성·javascript: 는 허용하지 않습니다")

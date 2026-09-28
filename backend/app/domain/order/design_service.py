"""도안 서비스 (A2-02 · api-contract §7.3 · §13.4 admin #25).

- 파일: 확장자 png/jpg/jpeg/pdf/ai/svg (422 ``BAD_FILE_TYPE``), 최대 20MB (413 ``FILE_TOO_LARGE``,
  Content-Length 선검사 + 스트림 상한). 저장 ``{DESIGN_DIR}/{so_code}/{line_no}/v{n}.{ext}``,
  DB 에는 DESIGN_DIR 기준 상대 경로.
- 버전: 라인당 1부터 자동 증가. 새 버전이 ``is_current``, 이전 버전은 해제. 새 버전을 올리면
  라인의 ``design_confirmed`` 는 false 로 돌아간다 (다시 「시안 확정」해야 발행 가능).
- 썸네일: png/jpg 만 Pillow 로 생성(긴 변 320px png). pdf/ai/svg 는 ``thumbnail_url=null``
  (admin #25).
- 확정: ``confirmed_at`` · ``confirmed_by`` · line.design_confirmed=true. NONE(P30 생략) 라인은 확정
  면제라 도안 없이 발행 가능 — 도안이 있으면 확정은 할 수 있다.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import filetype
from app.core.config import get_settings
from app.core.errors import ApiError, not_found, state_conflict, validation
from app.db.models.master import AppUser
from app.db.models.order import Design, SalesOrder, SalesOrderLine
from app.domain.order import so_service

logger = logging.getLogger(__name__)

ALLOWED_EXT = frozenset({"png", "jpg", "jpeg", "pdf", "ai", "svg"})
THUMB_EXT = frozenset({"png", "jpg", "jpeg"})
THUMB_MAX_PX = 320
CHUNK = 1024 * 1024


def design_root() -> Path:
    return Path(get_settings().design_dir)


def abs_path(rel: str) -> Path:
    return design_root() / rel


def _ext_of(filename: str | None) -> str:
    name = (filename or "").rsplit("/", 1)[-1]
    if "." not in name:
        raise validation(
            ["body", "file"], "확장자가 없습니다 (png/jpg/jpeg/pdf/ai/svg)", "BAD_FILE_TYPE"
        )
    ext = name.rsplit(".", 1)[1].lower()
    if ext not in ALLOWED_EXT:
        raise validation(
            ["body", "file"],
            f"지원하지 않는 파일 형식입니다: .{ext} (허용: {', '.join(sorted(ALLOWED_EXT))})",
            "BAD_FILE_TYPE",
        )
    return ext


def _too_large() -> ApiError:
    mb = get_settings().design_max_bytes // (1024 * 1024)
    return ApiError(413, "FILE_TOO_LARGE", f"도안 파일이 {mb}MB 를 넘습니다")


async def _write_upload(upload: UploadFile, target: Path) -> int:
    """스트림을 상한까지만 쓴다. 넘으면 파일을 지우고 413."""
    limit = get_settings().design_max_bytes
    if upload.size is not None and upload.size > limit:
        raise _too_large()
    target.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with target.open("wb") as fh:
        while True:
            chunk = await upload.read(CHUNK)
            if not chunk:
                break
            written += len(chunk)
            if written > limit:
                fh.close()
                target.unlink(missing_ok=True)
                raise _too_large()
            fh.write(chunk)
    if written == 0:
        target.unlink(missing_ok=True)
        raise validation(["body", "file"], "빈 파일입니다")
    return written


def _make_thumbnail(src: Path, dst: Path) -> None:
    from PIL import Image

    with Image.open(src) as im:
        im.thumbnail((THUMB_MAX_PX, THUMB_MAX_PX))
        out = im if im.mode in ("RGB", "RGBA") else im.convert("RGBA")
        out.save(dst, format="PNG")


async def upload_design(
    session: AsyncSession, so_key: str, line_id: int, upload: UploadFile, user: AppUser
) -> Design:
    so = await so_service.resolve_so(session, so_key)
    if so.status not in so_service.SO_EDITABLE:
        raise state_conflict(f"수주 상태 {so.status} — 도안을 올릴 수 없습니다")
    line = await so_service.get_line(session, so, line_id)
    ext = _ext_of(upload.filename)

    last = (
        await session.execute(select(func.max(Design.version)).where(Design.so_line_id == line.id))
    ).scalar_one()
    version = int(last or 0) + 1
    rel_dir = Path(so.code) / str(line.line_no)
    # D51: 임시 이름으로 쓴 뒤 매직 바이트로 형식을 판정해 실제 확장자로 저장 (svg 는 script 검사)
    tmp_abs = abs_path(str(rel_dir / f"v{version}.upload"))
    await _write_upload(upload, tmp_abs)
    try:
        with tmp_abs.open("rb") as fh:
            ext = filetype.resolve_design_ext(ext, fh.read(filetype.SNIFF_BYTES))
        if ext == "svg":
            filetype.check_svg_safe(tmp_abs.read_text(encoding="utf-8", errors="replace"))
    except ApiError:
        tmp_abs.unlink(missing_ok=True)
        raise
    rel_file = rel_dir / f"v{version}.{ext}"
    file_abs = abs_path(str(rel_file))
    tmp_abs.replace(file_abs)

    thumb_rel: str | None = None
    if ext in THUMB_EXT:
        thumb_abs = abs_path(str(rel_dir / f"v{version}.thumb.png"))
        try:
            await asyncio.to_thread(_make_thumbnail, file_abs, thumb_abs)
            thumb_rel = str(rel_dir / f"v{version}.thumb.png")
        except Exception as e:
            # 손상된 이미지 — 파일을 버리고 422 (조용히 넘기지 않는다)
            file_abs.unlink(missing_ok=True)
            logger.exception("design thumbnail failed: %s", file_abs)
            raise validation(
                ["body", "file"], "이미지 파일을 읽을 수 없습니다", "BAD_FILE_TYPE"
            ) from e

    # 이전 current 해제 → flush (부분 UK uq_design_current) → 새 버전
    current_rows = (
        await session.execute(
            select(Design).where(Design.so_line_id == line.id, Design.is_current.is_(True))
        )
    ).scalars()
    for d in current_rows:
        d.is_current = False
    await session.flush()
    design = Design(
        so_line_id=line.id,
        version=version,
        file_path=str(rel_file),
        thumbnail_path=thumb_rel,
        is_current=True,
        uploaded_by=user.id,
    )
    session.add(design)
    await session.flush()
    line.design_id = design.id
    line.design_confirmed = False
    await session.commit()
    await session.refresh(design)
    return design


async def confirm_design(session: AsyncSession, so_key: str, line_id: int, user: AppUser) -> Design:
    so = await so_service.resolve_so(session, so_key)
    if so.status not in so_service.SO_EDITABLE:
        raise state_conflict(f"수주 상태 {so.status} — 시안을 확정할 수 없습니다")
    line = await so_service.get_line(session, so, line_id)
    if line.design_id is None:
        raise state_conflict(f"라인 #{line.line_no} 에 도안이 없습니다 — 먼저 업로드하세요")
    design = await session.get(Design, line.design_id)
    assert design is not None
    if line.design_confirmed and design.confirmed_at is not None:
        raise state_conflict(f"라인 #{line.line_no} 도안 v{design.version} 은 이미 확정되었습니다")
    design.confirmed_at = datetime.now(UTC)
    design.confirmed_by = user.id
    line.design_confirmed = True
    await session.commit()
    await session.refresh(design)
    return design


async def get_design(session: AsyncSession, design_id: int) -> Design:
    d = await session.get(Design, design_id)
    if d is None:
        # §14.2 규칙 `{ENTITY}_NOT_FOUND` — 표에 행 추가 필요 (보고)
        raise not_found("DESIGN_NOT_FOUND", "도안", design_id)
    return d


async def design_file(session: AsyncSession, design_id: int, *, thumbnail: bool) -> Path:
    d = await get_design(session, design_id)
    rel = d.thumbnail_path if thumbnail else d.file_path
    if rel is None:
        raise not_found("DESIGN_NOT_FOUND", "도안 썸네일", design_id)
    p = abs_path(rel)
    if not p.is_file():
        logger.error("design file missing on disk: %s", p)
        raise not_found("DESIGN_NOT_FOUND", "도안 파일", design_id)
    return p


async def list_designs(session: AsyncSession, so_key: str, line_id: int) -> list[Design]:
    """``GET /so/{id}/lines/{line_id}/designs`` (F39, S4) — version 내림차순, is_current 포함."""
    so = await so_service.resolve_so(session, so_key)
    line = await so_service.get_line(session, so, line_id)
    rows = (
        await session.execute(
            select(Design).where(Design.so_line_id == line.id).order_by(Design.version.desc())
        )
    ).scalars()
    return list(rows.all())


async def line_of_design(session: AsyncSession, d: Design) -> tuple[SalesOrder, SalesOrderLine]:
    line = await session.get(SalesOrderLine, d.so_line_id)
    assert line is not None
    so = await session.get(SalesOrder, line.so_id)
    assert so is not None
    return so, line

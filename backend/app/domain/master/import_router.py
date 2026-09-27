"""엑셀 일괄 등록 · 마이그레이션 배치 라우터 (api-contract §7.2 · §7.8 · §13.3 admin #12/#22~#24).

권한 (§13.1 admin #13): entity=customer/item → ADMIN·SALES, entity=stock → ADMIN·MANAGER.
migration/batches: ADMIN R/W · MANAGER R.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import permissions as P
from app.api.deps import CurrentUser, Session, require_roles
from app.api.v1.schemas import master as S
from app.api.v1.schemas.common import Page
from app.core.config import get_settings
from app.core.errors import ApiError, forbidden
from app.db.models.master import AppUser
from app.domain.common.listing import PageDep, PageParams
from app.domain.master import import_service as svc

router = APIRouter(tags=["import"])

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_entity_query = Query()
_file_field = File()
_entity_form = Form()
_source_form = Form(default=None)
_migration_read = Depends(require_roles(*P.MIGRATION_READ))


def _check_import_role(user: AppUser, entity: str) -> None:
    allowed = P.IMPORT_STOCK if entity == "stock" else P.IMPORT_CUSTOMER_ITEM
    if user.role not in allowed:
        raise forbidden()


@router.get("/master/import/template")
async def import_template(
    entity: S.ImportEntity = _entity_query, user: AppUser = CurrentUser
) -> Response:
    _check_import_role(user, entity)
    return Response(
        content=svc.build_template(entity),
        media_type=XLSX_MIME,
        headers={"Content-Disposition": f'attachment; filename="import_template_{entity}.xlsx"'},
    )


async def _read_upload(file: UploadFile) -> bytes:
    """§14.5: Content-Length 선검사는 ``app.main`` 미들웨어(본문 파싱 전 413), 여기서는 스트림 상한.

    상한을 넘으면 다 읽기 전에 끊는다.
    """
    limit = get_settings().import_max_bytes
    too_large = ApiError(413, "FILE_TOO_LARGE", f"파일이 {limit // (1024 * 1024)}MB 를 넘습니다")
    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(256 * 1024):
        total += len(chunk)
        if total > limit:
            raise too_large
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/master/import/preview", response_model=S.ImportPreview, status_code=201)
async def import_preview(
    file: UploadFile = _file_field,
    entity: S.ImportEntity = _entity_form,
    source: Literal["IMS_XLS", "COUNT"] | None = _source_form,
    user: AppUser = CurrentUser,
    session: AsyncSession = Session,
) -> S.ImportPreview:
    _check_import_role(user, entity)
    data = await _read_upload(file)
    return await svc.preview(
        session,
        entity=entity,
        source=source,
        filename=file.filename or "upload.xlsx",
        data=data,
        user_id=user.id,
    )


@router.post("/master/import/{batch_id}/commit", response_model=S.ImportResult)
async def import_commit(
    batch_id: int,
    body: S.ImportCommitRequest,
    user: AppUser = CurrentUser,
    session: AsyncSession = Session,
) -> S.ImportResult:
    batch = await svc.get_batch(session, batch_id)
    _check_import_role(user, batch.entity)
    return await svc.commit(session, batch_id, body)


@router.get(
    "/migration/batches",
    response_model=Page[S.MigrationBatch],
    dependencies=[_migration_read],
)
async def list_batches(
    params: PageParams = PageDep,
    entity: str | None = None,
    status: str | None = None,
    source: str | None = None,
    sort: str | None = None,
    session: AsyncSession = Session,
) -> dict[str, object]:
    items, total = await svc.list_batches(
        session, params, entity=entity, status=status, source=source, sort=sort
    )
    return {"items": items, "page": params.page, "size": params.size, "total": total}


@router.get("/migration/batches/{batch_id}", response_model=S.MigrationBatchDetail)
async def batch_detail(
    batch_id: int,
    maps_params: PageParams = PageDep,
    user: AppUser = CurrentUser,
    session: AsyncSession = Session,
) -> S.MigrationBatchDetail:
    """§14.3: ADMIN/MANAGER R + 본인 배치는 작성자(SALES 등)도 R."""
    batch = await svc.get_batch(session, batch_id)
    if user.role not in P.MIGRATION_READ and batch.created_by != user.id:
        raise forbidden()
    return await svc.batch_detail(session, batch_id, maps_params)


@router.post("/migration/batches/{batch_id}/discard", response_model=S.MigrationBatch)
async def discard_batch(
    batch_id: int, user: AppUser = CurrentUser, session: AsyncSession = Session
) -> S.MigrationBatch:
    """§14.3: ADMIN 또는 그 배치의 created_by 본인(role 무관). 남의 배치는 403."""
    batch = await svc.get_batch(session, batch_id)
    if user.role not in P.MIGRATION_WRITE and batch.created_by != user.id:
        raise forbidden()
    return await svc.discard(session, batch_id)

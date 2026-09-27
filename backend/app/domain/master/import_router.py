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
from app.api.deps import CurrentUser, Principal, Session, require_roles
from app.api.v1.schemas import master as S
from app.api.v1.schemas.common import Page
from app.core.errors import forbidden
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
_migration_write = Depends(require_roles(*P.MIGRATION_WRITE))


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


@router.post("/master/import/preview", response_model=S.ImportPreview, status_code=201)
async def import_preview(
    file: UploadFile = _file_field,
    entity: S.ImportEntity = _entity_form,
    source: Literal["IMS_XLS", "COUNT"] | None = _source_form,
    user: AppUser = CurrentUser,
    session: AsyncSession = Session,
) -> S.ImportPreview:
    _check_import_role(user, entity)
    data = await file.read()
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


@router.get(
    "/migration/batches/{batch_id}",
    response_model=S.MigrationBatchDetail,
    dependencies=[_migration_read],
)
async def batch_detail(
    batch_id: int, maps_params: PageParams = PageDep, session: AsyncSession = Session
) -> S.MigrationBatchDetail:
    return await svc.batch_detail(session, batch_id, maps_params)


@router.post("/migration/batches/{batch_id}/discard", response_model=S.MigrationBatch)
async def discard_batch(
    batch_id: int,
    principal: Principal = _migration_write,
    session: AsyncSession = Session,
) -> S.MigrationBatch:
    return await svc.discard(session, batch_id)

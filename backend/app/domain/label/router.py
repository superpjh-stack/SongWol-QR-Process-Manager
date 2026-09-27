"""프린터 · 라벨 양식 · 라벨 출력·PDF 라우터 (api-contract §7.2 printers/label-templates · §7.7).

권한 (§4 · §13.8): 프린터·라벨양식 ADMIN W · MANAGER R · STATION R. 라벨 출력 ADMIN/MANAGER/SALES W
+ STATION. PDF·발행 이력 조회는 전 역할 R (JWT).
"""

from __future__ import annotations

import importlib
import logging

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import permissions as P
from app.api.deps import Principal, Session, require_roles
from app.api.v1.schemas import label as S
from app.api.v1.schemas.order import LabelJob
from app.db.models.order import SalesOrder
from app.domain.label import pdf as pdf_mod
from app.domain.label import service as svc

logger = logging.getLogger(__name__)

router = APIRouter(tags=["label"])


def bind_order_ports() -> bool:
    """개발A 의 ``app.domain.order.ports.set_label_issuer`` 에 실제 구현을 꽂는다.

    order 도메인은 동시 개발 중이라 정적 import 를 하지 않는다 — 모듈이 없으면 False 를 돌려주고
    경고를 남긴다 (WO 발행 시 label_issue 가 기록되지 않는 상태를 로그로 드러낸다).
    """
    try:
        ports = importlib.import_module("app.domain.order.ports")
    except ModuleNotFoundError:
        logger.warning("app.domain.order.ports 없음 — issue_labels_for_wo 훅 미연결")
        return False
    ports.set_label_issuer(svc.label_issuer)
    return True


ORDER_PORTS_BOUND = bind_order_ports()

_r = Depends(require_roles(*P.ADMIN_MASTER_READ, station=True))
_w = Depends(require_roles(*P.ADMIN_MASTER_WRITE))
LABEL_PRINT = ("ADMIN", "MANAGER", "SALES")  # §4 「라벨 출력·재발행 (B1)」 + STATION
_print = Depends(require_roles(*LABEL_PRINT, station=True))
_read_all = Depends(require_roles(*P.ALL_USER_ROLES))


# ======================================================================
# 프린터 (ADM-09 탭 1) — 소형 마스터: 배열 응답 (admin #7)
# ======================================================================
@router.get("/printers", response_model=list[S.Printer], dependencies=[_r])
async def list_printers(
    active: bool | None = None, session: AsyncSession = Session
) -> list[S.Printer]:
    return [svc.printer_out(p) for p in await svc.list_printers(session, active=active)]


@router.post("/printers", response_model=S.Printer, status_code=201, dependencies=[_w])
async def create_printer(body: S.PrinterCreate, session: AsyncSession = Session) -> S.Printer:
    return svc.printer_out(await svc.create_printer(session, body))


@router.get("/printers/{printer_id}", response_model=S.Printer, dependencies=[_r])
async def get_printer(printer_id: str, session: AsyncSession = Session) -> S.Printer:
    return svc.printer_out(await svc.get_printer(session, printer_id))


@router.patch("/printers/{printer_id}", response_model=S.Printer, dependencies=[_w])
async def update_printer(
    printer_id: str, body: S.PrinterUpdate, session: AsyncSession = Session
) -> S.Printer:
    return svc.printer_out(await svc.update_printer(session, printer_id, body))


@router.post("/printers/{printer_id}/deactivate", response_model=S.Printer, dependencies=[_w])
async def deactivate_printer(printer_id: str, session: AsyncSession = Session) -> S.Printer:
    return svc.printer_out(await svc.set_printer_active(session, printer_id, False))


@router.post("/printers/{printer_id}/activate", response_model=S.Printer, dependencies=[_w])
async def activate_printer(printer_id: str, session: AsyncSession = Session) -> S.Printer:
    return svc.printer_out(await svc.set_printer_active(session, printer_id, True))


@router.post("/printers/{printer_id}/test", response_model=S.PrinterTestResult, dependencies=[_w])
async def test_printer(printer_id: str, session: AsyncSession = Session) -> S.PrinterTestResult:
    """테스트 라벨 전송. 실패도 200 — ``zpl_sent=false, error=PRINTER_UNREACHABLE``."""
    return await svc.test_printer(session, printer_id)


# ======================================================================
# 라벨 양식 (ADM-09 탭 2)
# ======================================================================
@router.get("/label-templates", response_model=list[S.LabelTemplate], dependencies=[_r])
async def list_templates(session: AsyncSession = Session) -> list[S.LabelTemplate]:
    return await svc.list_templates(session)


@router.get("/label-templates/{label_type}", response_model=S.LabelTemplate, dependencies=[_r])
async def get_template(label_type: str, session: AsyncSession = Session) -> S.LabelTemplate:
    return await svc.get_template(session, label_type)


@router.put("/label-templates/{label_type}", response_model=S.LabelTemplate)
async def put_template(
    label_type: str,
    body: S.LabelTemplateUpdate,
    principal: Principal = _w,
    session: AsyncSession = Session,
) -> S.LabelTemplate:
    assert principal.user is not None
    return await svc.put_template(session, label_type, body, principal.user.id)


@router.post(
    "/label-templates/{label_type}/preview",
    response_model=S.LabelPreview,
    dependencies=[Depends(require_roles(*P.ADMIN_MASTER_READ))],
)
async def preview_template(
    label_type: str, body: S.LabelPreviewRequest | None = None, session: AsyncSession = Session
) -> S.LabelPreview:
    """§11-7: ZPL/HTML 텍스트만 (이미지 렌더 없음)."""
    return await svc.preview_template(session, label_type, body or S.LabelPreviewRequest())


# ======================================================================
# 라벨 출력 · 발행 이력 · 작업지시서 PDF (§7.7)
# ======================================================================
@router.post("/labels/print", response_model=LabelJob)
async def print_label(
    body: S.LabelPrintRequest, principal: Principal = _print, session: AsyncSession = Session
) -> LabelJob:
    """항상 200. 실패 ``zpl_sent=false, error=PRINTER_UNREACHABLE``, 미지정 ``NO_PRINTER``."""
    return await svc.print_label(session, body, principal)


@router.get("/labels/issues", response_model=list[S.LabelIssue], dependencies=[_read_all])
async def list_issues(target_code: str, session: AsyncSession = Session) -> list[S.LabelIssue]:
    return await svc.list_issues(session, target_code)


def _pdf_response(pdf: bytes, filename: str) -> Response:
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.get("/labels/so/{so_code}.pdf", dependencies=[_read_all], response_class=Response)
async def so_pdf(so_code: str, session: AsyncSession = Session) -> Response:
    """표지 + 발행된 WO 마다 1쪽. WO 가 없으면 표지만."""
    so = await svc.load_so(session, so_code.upper())
    return _pdf_response(await pdf_mod.render_work_order_pdf(session, so), f"{so.code}.pdf")


@router.get("/labels/work-order/{wo_code}.pdf", dependencies=[_read_all], response_class=Response)
async def wo_pdf(wo_code: str, session: AsyncSession = Session) -> Response:
    """표지 + 그 WO 1쪽."""
    wo = await svc.load_wo(session, wo_code.upper())
    so = await session.get(SalesOrder, wo.so_id)
    assert so is not None
    return _pdf_response(await pdf_mod.render_work_order_pdf(session, so, wo), f"{wo.code}.pdf")

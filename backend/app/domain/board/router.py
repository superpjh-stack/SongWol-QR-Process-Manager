"""현황판 · 집계 · 알림 · 감사 로그 라우터 (api-contract §7.8).

``GET /dashboard/summary`` · ``GET /reports/output`` · ``GET/POST /notifications*`` ·
``GET /audit-logs``. ``GET /migration/batches`` 는 이미 ``domain/master/import_router.py`` 에
있다(§7.8 표에 같이 묶여 있을 뿐 리소스는 마이그레이션 도메인 소관).
"""

from __future__ import annotations

from datetime import date, datetime

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import permissions as P
from app.api.deps import Principal, Session, require_roles
from app.api.v1.schemas import board as B
from app.api.v1.schemas.common import Page
from app.domain.board import notify
from app.domain.board import service as svc
from app.domain.common.listing import PageDep, PageParams
from app.domain.common.xlsx import XLSX_MIME

router = APIRouter(tags=["board"])

FromQuery = Query(default=None, alias="from")

_dashboard_r = Depends(require_roles(*P.DASHBOARD_READ, station=True))
_report_r = Depends(require_roles(*P.REPORT_READ))
_notif_r = Depends(require_roles(*P.NOTIFICATION_READ))
_notif_w = Depends(require_roles(*P.NOTIFICATION_WRITE))
_audit_r = Depends(require_roles(*P.AUDIT_READ))


@router.get("/dashboard/summary", response_model=B.DashboardSummary, dependencies=[_dashboard_r])
async def dashboard_summary(session: AsyncSession = Session) -> B.DashboardSummary:
    return await svc.dashboard_summary(session)


@router.get("/reports/output", response_model=None, dependencies=[_report_r])
async def reports_output(
    from_: date = FromQuery,
    to: date | None = None,
    group: str = Query(default="day"),
    process_code: str | None = None,
    equipment_id: int | None = None,
    worker_id: int | None = None,
    format: str | None = None,  # noqa: A002 — 계약(format) 그대로
    session: AsyncSession = Session,
) -> B.OutputReport | Response:
    to_ = to or from_
    report = await svc.output_report(
        session,
        from_=from_,
        to=to_,
        group=group,
        process_code=process_code,
        equipment_id=equipment_id,
        worker_id=worker_id,
    )
    if format == "xlsx":
        return Response(
            content=svc.output_report_xlsx(report),
            media_type=XLSX_MIME,
            headers={"Content-Disposition": 'attachment; filename="output-report.xlsx"'},
        )
    return report


@router.get("/notifications", response_model=Page[B.Notification], dependencies=[_notif_r])
async def list_notifications(
    params: PageParams = PageDep,
    unacked: bool = False,
    type: str | None = None,  # noqa: A002 — 계약(type) 그대로
    from_: datetime | None = FromQuery,
    to: datetime | None = None,
    session: AsyncSession = Session,
) -> dict[str, object]:
    rows, total = await notify.list_notifications(
        session, params, unacked=unacked, type_=type, from_=from_, to=to
    )
    return {"items": rows, "page": params.page, "size": params.size, "total": total}


@router.post("/notifications/{notification_id}/ack", response_model=B.Notification)
async def ack_notification(
    notification_id: int, principal: Principal = _notif_w, session: AsyncSession = Session
) -> B.Notification:
    assert principal.user is not None  # _notif_w 는 JWT 전용
    return await notify.ack_notification(session, notification_id, principal.user)


@router.get("/audit-logs", response_model=Page[B.AuditLog], dependencies=[_audit_r])
async def list_audit_logs(
    params: PageParams = PageDep,
    table_name: str | None = None,
    row_id: int | None = None,
    user_id: int | None = None,
    from_: datetime | None = FromQuery,
    to: datetime | None = None,
    session: AsyncSession = Session,
) -> dict[str, object]:
    rows, total = await svc.list_audit_logs(
        session, params, table_name=table_name, row_id=row_id, user_id=user_id, from_=from_, to=to
    )
    return {"items": rows, "page": params.page, "size": params.size, "total": total}


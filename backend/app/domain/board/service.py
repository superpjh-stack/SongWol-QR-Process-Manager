"""현황판 집계 · 생산 실적 · 감사 로그 조회 (api-contract §7.8 · §7.3 §9.5).

집계 7종 뷰는 그대로 쿼리만 한다 — SQL 로직을 여기서 다시 구현하지 않는다(engineering
지시). ``domain/material/service.py`` 의 ``v_stock_current`` 조회와 같은 패턴(raw SQL
``text()`` + ``.mappings()``)을 그대로 따른다.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.schemas import board as B
from app.core.errors import ApiError
from app.db.models.master import AppUser
from app.db.models.ops import AuditLog
from app.db.models.order import SalesOrder, WorkOrder
from app.db.models.scan import ScanEvent
from app.domain.common.listing import PageParams, paginate
from app.domain.common.xlsx import rows_to_xlsx
from app.domain.master.admin_service import user_summary
from app.domain.order import recalc
from app.domain.order.so_service import today_kst
from app.domain.order.views import SoView, load_so_views, load_wo_views, wo_summary

TZ_SEOUL = ZoneInfo("Asia/Seoul")
LATE_ARRIVAL_THRESHOLD = timedelta(minutes=5)
OFFLINE_BACKLOG_WINDOW = timedelta(hours=24)


# ======================================================================
# 뷰 조회 헬퍼
# ======================================================================
def _so_progress_out(r: Any) -> B.SoProgress:
    procs = (r["current_processes"] or "").split(",") if r["current_processes"] else []
    due = r["due_date"]
    return B.SoProgress(
        so_id=r["so_id"],
        so_code=r["so_code"],
        customer_name=r["customer_name"],
        due_date=due.isoformat() if isinstance(due, date) else str(due),
        status=r["status"],
        progress_pct=float(r["progress_pct"]),
        current_processes=[p for p in procs if p],
        delay_risk=bool(r["delay_risk"]),
        est_complete_at=r["est_complete_at"],
    )


async def today_due(session: AsyncSession, today: date) -> list[B.SoProgress]:
    rows = (
        await session.execute(
            text("SELECT * FROM mes.v_so_progress WHERE due_date = :d ORDER BY so_code"),
            {"d": today},
        )
    ).mappings().all()
    return [_so_progress_out(r) for r in rows]


async def delay_risk_list(session: AsyncSession) -> list[B.SoProgress]:
    """0010 캐시 컬럼(``sales_order.delay_risk``, 지연 감지 잡이 갱신) 기준 — §6.5 두 조건을
    전부 반영한다(뷰 자체의 ``delay_risk`` 는 조건 (b)만, db-schema §9 주석)."""
    rows = (
        await session.execute(
            text(
                "SELECT v.* FROM mes.v_so_progress v "
                "JOIN mes.sales_order so ON so.id = v.so_id "
                "WHERE so.delay_risk ORDER BY v.due_date"
            )
        )
    ).mappings().all()
    return [_so_progress_out(r) for r in rows]


async def process_queue(session: AsyncSession) -> list[B.ProcessQueueRow]:
    rows = (
        await session.execute(
            text("SELECT * FROM mes.v_process_queue ORDER BY process_code")
        )
    ).mappings().all()
    return [
        B.ProcessQueueRow(
            process_code=r["process_code"],
            process_name=r["process_name"],
            wo_count=r["wo_count"],
            qty_total=int(r["qty_total"] or 0),
            max_wait_hours=float(r["max_wait_hours"] or 0),
        )
        for r in rows
    ]


async def today_shipments(session: AsyncSession, today: date) -> B.TodayShipments:
    rows = (
        await session.execute(
            text(
                "SELECT so_code, due_date, shipment_status, shipped_at, overdue "
                "FROM mes.v_shipment_today"
            )
        )
    ).mappings().all()
    planned = {r["so_code"] for r in rows if r["due_date"] == today}
    done = {
        r["so_code"]
        for r in rows
        if r["shipment_status"] == "SHIPPED"
        and r["shipped_at"] is not None
        and r["shipped_at"].astimezone(TZ_SEOUL).date() == today
    }
    overdue = {r["so_code"] for r in rows if r["overdue"]}
    return B.TodayShipments(planned=len(planned), done=len(done), overdue=len(overdue))


async def output_per_hour_today(session: AsyncSession, today: date) -> float:
    qty: int = (
        await session.execute(
            text(
                "SELECT COALESCE(SUM(qty_good),0) FROM mes.v_daily_output WHERE work_date = :d"
            ),
            {"d": today},
        )
    ).scalar_one()
    now_kst = datetime.now(UTC).astimezone(TZ_SEOUL)
    start = datetime.combine(now_kst.date(), time.min, tzinfo=TZ_SEOUL)
    elapsed_h = max((now_kst - start).total_seconds() / 3600, 1 / 60)
    return round(float(qty) / elapsed_h, 2)


async def pending_approvals_count(session: AsyncSession) -> int:
    return int(
        (
            await session.execute(
                select(func.count()).select_from(ScanEvent).where(
                    ScanEvent.approval_status == "PENDING"
                )
            )
        ).scalar_one()
    )


async def offline_backlog(session: AsyncSession) -> list[B.OfflineBacklogRow]:
    """§9.5 「오프라인 backlog」: 서버는 단말의 로컬 큐 크기를 알 수 없다(플러시 전까지는 아예
    보이지 않는다) — 대신 최근 24시간 동안 "늦게 도착한"(``received_at - scanned_at`` >
    5분) 이벤트 수를 단말별로 세어 근사한다. 이는 §13.7 오프라인 포장 절차가 남기는 것과 같은
    신호(오프라인 동안 쌓였다가 재접속 시 한꺼번에 flush 된 이벤트)라 정직한 프록시다 — 계약이
    정확한 산식을 정하지 않아 이 절충안을 report 에 남긴다.
    """
    rows = (
        await session.execute(
            text(
                "SELECT station_id, COUNT(*) AS cnt FROM mes.scan_event "
                "WHERE received_at - scanned_at > make_interval(mins => :mins) "
                "AND received_at > now() - make_interval(hours => :hours) "
                "GROUP BY station_id ORDER BY station_id"
            ),
            {
                "mins": int(LATE_ARRIVAL_THRESHOLD.total_seconds() // 60),
                "hours": int(OFFLINE_BACKLOG_WINDOW.total_seconds() // 3600),
            },
        )
    ).mappings().all()
    return [B.OfflineBacklogRow(station_id=r["station_id"], count=int(r["cnt"])) for r in rows]


def so_progress_out(v: SoView) -> B.SoProgress:
    """SoView → SoProgress (WS ``wo_updated``·향후 다른 실시간 지점이 공유). ``so_detail()``
    (order/views.py) 과 같은 계산이나, 반환 타입이 board 스키마라 order/views.py 에 두지
    않는다(order 도메인이 board 스키마를 알 필요는 없다)."""
    active = [wv for wv in v.wo_views if wv.wo.status in recalc.WO_ACTIVE]
    current: list[str] = []
    for wv in active:
        cur = next((s for s in wv.steps if s.seq == wv.wo.current_step_seq), None)
        if cur is not None and cur.process_code not in current:
            current.append(cur.process_code)
    return B.SoProgress(
        so_id=v.so.id,
        so_code=v.so.code,
        customer_name=v.customer.name,
        due_date=v.so.due_date.isoformat(),
        status=v.so.status,
        progress_pct=float(v.so.progress_pct),
        current_processes=current,
        delay_risk=v.delay_risk,
        est_complete_at=recalc.est_complete_at([(wv.wo, wv.steps) for wv in v.wo_views]),
    )


async def process_queue_row_for(
    session: AsyncSession, process_code: str
) -> B.ProcessQueueRow | None:
    row = (
        await session.execute(
            text("SELECT * FROM mes.v_process_queue WHERE process_code = :p"), {"p": process_code}
        )
    ).mappings().first()
    if row is None:
        return None
    return B.ProcessQueueRow(
        process_code=row["process_code"],
        process_name=row["process_name"],
        wo_count=row["wo_count"],
        qty_total=int(row["qty_total"] or 0),
        max_wait_hours=float(row["max_wait_hours"] or 0),
    )


async def wo_updated_message(session: AsyncSession, wo: WorkOrder) -> B.WoUpdatedMessage:
    """스캔 반영·승인·취소·발행·보류 커밋 직후 호출(§8 표) — ``/ws/board`` 브로드캐스트 본문을
    조립한다. 실제 전송은 호출자가 ``app.ws.manager.manager.broadcast()`` 로 한다(이 함수는
    순수 조립만, 브로드캐스터에 의존하지 않는다 — 테스트하기 쉽고, 브로드캐스트 실패가 이
    조립 실패와 섞이지 않는다)."""
    wo_view = (await load_wo_views(session, [wo]))[0]
    so = await session.get(SalesOrder, wo.so_id)
    assert so is not None
    so_view = (await load_so_views(session, [so]))[0]
    delta: list[B.ProcessQueueDelta] = []
    cur = next((s for s in wo_view.steps if s.seq == wo.current_step_seq), None)
    if cur is not None:
        row = await process_queue_row_for(session, cur.process_code)
        if row is not None:
            delta.append(B.ProcessQueueDelta(process_code=row.process_code, wo_count=row.wo_count))
    return B.WoUpdatedMessage(
        at=datetime.now(UTC),
        wo=wo_summary(wo_view),
        so=so_progress_out(so_view),
        process_queue_delta=delta,
    )


async def dashboard_summary(session: AsyncSession) -> B.DashboardSummary:
    today = today_kst()
    return B.DashboardSummary(
        today_due=await today_due(session, today),
        delay_risk=await delay_risk_list(session),
        process_queue=await process_queue(session),
        today_shipments=await today_shipments(session, today),
        output_per_hour_today=await output_per_hour_today(session, today),
        pending_approvals=await pending_approvals_count(session),
        offline_backlog=await offline_backlog(session),
        generated_at=datetime.now(UTC),
    )


# ======================================================================
# 생산 실적 (GET /reports/output, B5-04, v_daily_output 집계)
# ======================================================================
_GROUP_TRUNC = {"day": "day", "week": "week", "month": "month"}


async def output_report(
    session: AsyncSession,
    *,
    from_: date,
    to: date,
    group: str,
    process_code: str | None,
    equipment_id: int | None,
    worker_id: int | None,
) -> B.OutputReport:
    if group not in _GROUP_TRUNC:
        raise ApiError(422, "VALIDATION_ERROR", "group 은 day|week|month 여야 합니다")
    where = ["v.work_date BETWEEN :from_ AND :to_"]
    binds: dict[str, Any] = {"from_": from_, "to_": to}
    if process_code:
        where.append("v.process_code = :process_code")
        binds["process_code"] = process_code.strip().upper()
    if equipment_id is not None:
        where.append("v.equipment_code = (SELECT code FROM mes.equipment WHERE id = :equipment_id)")
        binds["equipment_id"] = equipment_id
    if worker_id is not None:
        where.append("v.worker_id = :worker_id")
        binds["worker_id"] = worker_id
    where_sql = " AND ".join(where)
    rows = (
        await session.execute(
            text(
                f"SELECT date_trunc('{_GROUP_TRUNC[group]}', v.work_date)::date AS period, "
                "v.process_code, v.equipment_code, v.equip_type, v.worker_name, "
                "SUM(v.qty_good) AS qty_good, SUM(v.qty_bad) AS qty_bad, "
                "SUM(v.wo_count) AS wo_count "
                f"FROM mes.v_daily_output v WHERE {where_sql} "
                "GROUP BY 1, v.process_code, v.equipment_code, v.equip_type, v.worker_name "
                "ORDER BY 1, v.process_code"
            ),
            binds,
        )
    ).mappings().all()

    period_hours = _hours_per_period(group)

    def _rate(qty_good: int) -> float | None:
        return round(qty_good / period_hours, 2) if period_hours else None

    out_rows = [
        B.OutputReportRow(
            period=r["period"].isoformat(),
            process_code=r["process_code"],
            equipment_code=r["equipment_code"],
            equip_type=r["equip_type"],
            worker_name=r["worker_name"],
            qty_good=int(r["qty_good"] or 0),
            qty_bad=int(r["qty_bad"] or 0),
            wo_count=int(r["wo_count"] or 0),
            output_per_hour=_rate(int(r["qty_good"] or 0)),
        )
        for r in rows
    ]
    total_good = sum(r.qty_good for r in out_rows)
    total_bad = sum(r.qty_bad for r in out_rows)
    span_hours = max((to - from_).days + 1, 1) * 24
    totals = B.OutputReportTotals(
        qty_good=total_good,
        qty_bad=total_bad,
        output_per_hour=round(total_good / span_hours, 2) if span_hours else None,
    )
    return B.OutputReport(
        **{"from": from_.isoformat()}, to=to.isoformat(), group=group, rows=out_rows, totals=totals
    )


def _hours_per_period(group: str) -> float:
    return {"day": 24.0, "week": 24.0 * 7, "month": 24.0 * 30}[group]


def output_report_xlsx(report: B.OutputReport) -> bytes:
    headers = [
        "period", "process_code", "equipment_code", "equip_type", "worker_name",
        "qty_good", "qty_bad", "wo_count", "output_per_hour",
    ]
    data = [
        [
            r.period, r.process_code, r.equipment_code, r.equip_type, r.worker_name,
            r.qty_good, r.qty_bad, r.wo_count, r.output_per_hour,
        ]
        for r in report.rows
    ]
    return rows_to_xlsx(headers, data)


# ======================================================================
# 감사 로그 (GET /audit-logs)
# ======================================================================
async def list_audit_logs(
    session: AsyncSession,
    params: PageParams,
    *,
    table_name: str | None,
    row_id: int | None,
    user_id: int | None,
    from_: datetime | None,
    to: datetime | None,
) -> tuple[list[B.AuditLog], int]:
    stmt = select(AuditLog)
    if table_name:
        stmt = stmt.where(AuditLog.table_name == table_name)
    if row_id is not None:
        stmt = stmt.where(AuditLog.row_id == row_id)
    if user_id is not None:
        stmt = stmt.where(AuditLog.user_id == user_id)
    if from_ is not None:
        stmt = stmt.where(AuditLog.at >= from_)
    if to is not None:
        stmt = stmt.where(AuditLog.at <= to)
    stmt = stmt.order_by(AuditLog.at.desc())
    rows, total = await paginate(session, stmt, params)
    users = {
        u.id: u
        for u in (
            await session.execute(
                select(AppUser).where(
                    AppUser.id.in_([r.user_id for r in rows if r.user_id is not None] or [0])
                )
            )
        ).scalars()
    }
    out = [
        B.AuditLog(
            id=r.id,
            table_name=r.table_name,
            row_id=r.row_id,
            row_key=r.row_key,
            action=r.action,
            before=r.before,
            after=r.after,
            user=user_summary(users[r.user_id]) if r.user_id in users else None,
            at=r.at,
            request_id=r.request_id,
        )
        for r in rows
    ]
    return out, total


__all__ = [
    "dashboard_summary",
    "list_audit_logs",
    "output_report",
    "output_report_xlsx",
    "so_progress_out",
    "wo_updated_message",
]

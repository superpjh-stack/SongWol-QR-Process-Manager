"""집계 캐시 갱신 (db-schema §8) · WO 상태 재계산 (api-contract §6.1) · 지연 판정 (§6.5).

- ``recalc_wo(wo, steps)`` — 단계 상태로부터 ``work_order.status`` · ``current_step_seq`` ·
  P30 양품/불량 캐시. CANCELLED · ON_HOLD · CLOSED 는 명시 설정이라 건드리지 않는다.
- ``recalc_so(session, so)`` — 비취소 WO 로부터 ``sales_order.status`` · ``progress_pct``.
  CANCELLED · CLOSED 는 유지. ``shipped_at`` 은 출하 서비스 몫.
- ``wo_delay_risk`` · ``remaining_hours`` — 순수 함수. S4 지연 잡(§6.5)과 조회 응답이 같이 쓴다.

전부 flush/commit 을 하지 않는다 — 호출자의 트랜잭션 안에서 값만 바꾼다.
S2 스캔 엔진은 스캔 커밋마다 ``recalc_wo`` → ``recalc_so`` 순으로 부른다.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models.order import SalesOrder, WorkOrder, WoRouteStep

TZ_SEOUL = ZoneInfo("Asia/Seoul")
DUE_TIME_KST = time(18, 0)  # db-schema §12-22: 납기 시각 = due_date 18:00 KST

PROGRESSED = frozenset({"STARTED", "DONE", "DONE_ESTIMATED", "PARTIAL"})
STEP_COMPLETE = frozenset({"DONE", "DONE_ESTIMATED", "SKIPPED"})
STEP_OPEN = frozenset({"WAITING", "STARTED", "PARTIAL"})
WO_FIXED = frozenset({"CANCELLED", "ON_HOLD", "CLOSED"})
WO_ACTIVE = frozenset({"ISSUED", "IN_PROGRESS"})
SO_FIXED = frozenset({"CANCELLED", "CLOSED"})
WO_SHIPPED_LIKE = frozenset({"SHIPPED", "CLOSED"})


def _now(now: datetime | None) -> datetime:
    return now if now is not None else datetime.now(UTC)


def current_step(steps: Sequence[WoRouteStep]) -> WoRouteStep | None:
    """첫 WAITING/STARTED/PARTIAL 단계. 없으면 마지막 단계 (§6.1 current_step_seq 규칙)."""
    ordered = sorted(steps, key=lambda s: s.seq)
    for s in ordered:
        if s.status in STEP_OPEN:
            return s
    return ordered[-1] if ordered else None


def recalc_wo(wo: WorkOrder, steps: Sequence[WoRouteStep]) -> None:
    """§6.1 표. 명시 상태(CANCELLED/ON_HOLD/CLOSED)는 유지."""
    ordered = sorted(steps, key=lambda s: s.seq)
    cur = current_step(ordered)
    wo.current_step_seq = cur.seq if cur else None

    p30 = next((s for s in ordered if s.process_code == "P30"), None)
    if p30 is not None:
        if p30.status in {"DONE", "DONE_ESTIMATED", "PARTIAL"}:
            wo.qty_good = p30.qty_good or 0
            wo.qty_bad = p30.qty_bad or 0
        else:
            # S4 E6 cancel_wo_event 가 replay_steps 로 P30 을 DONE→WAITING 되돌릴 수 있다(다른
            # 어떤 경로도 이전엔 P30 을 역행시키지 않았다) — 그때 이 캐시 컬럼을 그대로 두면
            # 되돌려진 뒤에도 예전 양품/불량 수량이 남아 대시보드·실적집계가 틀어진다.
            wo.qty_good = 0
            wo.qty_bad = 0

    if wo.status in WO_FIXED:
        return
    if wo.issued_at is None:
        wo.status = "DRAFT"
        return
    by_code = {s.process_code: s for s in ordered}
    p60 = by_code.get("P60")
    p50 = by_code.get("P50")
    if p60 is not None and p60.status in {"DONE", "DONE_ESTIMATED"}:
        wo.status = "SHIPPED"
    elif p50 is not None and p50.status in {"DONE", "DONE_ESTIMATED"}:
        wo.status = "PACKED"
    elif any(s.status in PROGRESSED for s in ordered):
        wo.status = "IN_PROGRESS"
    else:
        wo.status = "ISSUED"


def remaining_hours(steps: Sequence[WoRouteStep]) -> Decimal:
    """잔여 표준 리드타임 합 (열린 단계의 std_lead_hours)."""
    return sum((s.std_lead_hours for s in steps if s.status in STEP_OPEN), Decimal(0))


def due_datetime(due: date) -> datetime:
    """due_date → 그날 18:00 KST (UTC aware)."""
    return datetime.combine(due, DUE_TIME_KST, tzinfo=TZ_SEOUL).astimezone(UTC)


def wo_delay_risk(
    wo: WorkOrder, steps: Sequence[WoRouteStep], due: date, now: datetime | None = None
) -> bool:
    """§6.5 (a) 현재 단계 대기시간 > std_lead_hours, 또는 (b) 잔여 리드타임 합 > 납기까지 남은
    시간. ISSUED/IN_PROGRESS 만 대상. ``due`` 는 sales_order.due_date.
    """
    if wo.status not in WO_ACTIVE:
        return False
    t = _now(now)
    ordered = sorted(steps, key=lambda s: s.seq)
    cur = next((s for s in ordered if s.status in STEP_OPEN), None)
    if cur is not None:
        prev = next((s for s in reversed(ordered) if s.seq < cur.seq), None)
        started = cur.started_at or (prev.done_at if prev is not None else None) or wo.issued_at
        if started is not None:
            waited_h = Decimal((t - started).total_seconds()) / Decimal(3600)
            if waited_h > cur.std_lead_hours:
                return True
    left = Decimal((due_datetime(due) - t).total_seconds()) / Decimal(3600)
    return remaining_hours(ordered) > left


def est_complete_at(
    pairs: Sequence[tuple[WorkOrder, Sequence[WoRouteStep]]], now: datetime | None = None
) -> datetime | None:
    """SalesOrderDetail.est_complete_at = now + max(활성 WO 잔여 리드타임). 활성 WO 없으면 None."""
    t = _now(now)
    hours = [remaining_hours(steps) for wo, steps in pairs if wo.status in WO_ACTIVE]
    if not hours:
        return None
    return t + timedelta(hours=float(max(hours)))


def so_progress_pct(pairs: Sequence[tuple[WorkOrder, Sequence[WoRouteStep]]]) -> Decimal:
    """§8: Σ(WO 완료 단계 수) / Σ(WO 총 단계 수) × 100, CANCELLED WO 제외."""
    total = 0
    done = 0
    for wo, steps in pairs:
        if wo.status == "CANCELLED":
            continue
        total += len(steps)
        done += sum(1 for s in steps if s.status in STEP_COMPLETE)
    if total == 0:
        return Decimal(0)
    return (Decimal(done) * 100 / Decimal(total)).quantize(Decimal("0.01"))


def so_status_from_wos(current: str, wos: Sequence[WorkOrder]) -> str:
    """OPEN(WO 없음) → IN_PROGRESS → PARTIAL_SHIPPED → SHIPPED. CANCELLED/CLOSED 는 유지."""
    if current in SO_FIXED:
        return current
    live = [w for w in wos if w.status != "CANCELLED"]
    if not live:
        return "OPEN"
    shipped = [w for w in live if w.status in WO_SHIPPED_LIKE]
    if len(shipped) == len(live):
        return "SHIPPED"
    if shipped:
        return "PARTIAL_SHIPPED"
    return "IN_PROGRESS"


async def load_wo_pairs(
    session: AsyncSession, so_id: int
) -> list[tuple[WorkOrder, list[WoRouteStep]]]:
    rows = (
        (
            await session.execute(
                select(WorkOrder)
                .options(selectinload(WorkOrder.route_steps))
                .where(WorkOrder.so_id == so_id)
                .order_by(WorkOrder.id)
            )
        )
        .scalars()
        .all()
    )
    return [(w, list(w.route_steps)) for w in rows]


async def recalc_so(session: AsyncSession, so: SalesOrder) -> None:
    """WO 상태 변경 커밋 전에 부른다 (§8 order 서비스 ``recompute_so()``)."""
    pairs = await load_wo_pairs(session, so.id)
    so.progress_pct = so_progress_pct(pairs)
    so.status = so_status_from_wos(so.status, [w for w, _ in pairs])

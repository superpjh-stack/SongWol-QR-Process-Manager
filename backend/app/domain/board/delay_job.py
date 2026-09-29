"""지연 감지 배치 (api-contract §6.5, APScheduler 10분 잡).

WO 단위로 두 조건을 계산한다(``domain/order/recalc.wo_delay_risk`` 재사용, 로직을 다시
구현하지 않는다):

(a) 현재 단계 대기시간 > 그 단계 std_lead_hours
(b) 잔여 단계 std_lead_hours 합 > (납기 18:00 KST − now)

하나라도 참이면 WO/SO ``delay_risk`` 캐시 컬럼을 true 로, notification(DELAY,
dedupe_key=DELAY:{wo_code}:{date}) 을 만든다(§7.1 UK 로 하루 1회, 매 실행마다 또 만들려
해도 충돌만 나고 조용히 무시된다). 수신자: role ∈ {MANAGER, SALES} 활성 사용자
(``notify.BROADCAST_ROLES``, 발송은 ``notify.dispatch_pending`` 이 맡는다).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models.ops import Notification
from app.db.models.order import SalesOrder, WorkOrder
from app.domain.board import notify
from app.domain.order import recalc
from app.domain.order.so_service import today_kst
from app.ws import broadcast as ws_broadcast

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class DelayRunResult:
    checked: int
    delayed: int
    notifications_created: int
    notifications_sent: int


def _dedupe_key(wo_code: str, today: str) -> str:
    return f"DELAY:{wo_code}:{today}"


async def _wo_pairs_for_active(
    session: AsyncSession,
) -> list[tuple[WorkOrder, SalesOrder]]:
    rows = (
        (
            await session.execute(
                select(WorkOrder)
                .options(selectinload(WorkOrder.route_steps))
                .where(WorkOrder.status.in_(tuple(recalc.WO_ACTIVE)))
            )
        )
        .scalars()
        .all()
    )
    so_ids = {w.so_id for w in rows}
    so_map = {
        s.id: s
        for s in (
            await session.execute(select(SalesOrder).where(SalesOrder.id.in_(so_ids or {0})))
        ).scalars()
    }
    return [(w, so_map[w.so_id]) for w in rows if w.so_id in so_map]


async def run_delay_detection(session: AsyncSession) -> DelayRunResult:
    now = datetime.now(UTC)
    today = today_kst().isoformat()
    pairs = await _wo_pairs_for_active(session)

    delayed_wo_codes: list[str] = []
    so_delay: dict[int, bool] = {}
    for wo, so in pairs:
        risk = recalc.wo_delay_risk(wo, list(wo.route_steps), so.due_date, now)
        wo.delay_risk = risk
        so_delay[so.id] = so_delay.get(so.id, False) or risk
        if risk:
            delayed_wo_codes.append(wo.code)

    # 활성 WO 가 있는 SO 는 여기서 갱신
    for so_id, risk in so_delay.items():
        so_row = await session.get(SalesOrder, so_id)
        if so_row is not None:
            so_row.delay_risk = risk

    # 더 이상 활성이 아닌데 캐시가 남아있는 WO/SO 는 false 로 되돌린다(완료·취소·보류 전이 시
    # recalc_wo/recalc_so 가 이 컬럼까지는 손대지 않으므로 여기서 청소한다).
    stale_wos = (
        (
            await session.execute(
                select(WorkOrder).where(
                    WorkOrder.delay_risk.is_(True),
                    WorkOrder.status.not_in(tuple(recalc.WO_ACTIVE)),
                )
            )
        )
        .scalars()
        .all()
    )
    for w in stale_wos:
        w.delay_risk = False

    active_so_ids = set(so_delay.keys())
    stale_sos = (
        (
            await session.execute(
                select(SalesOrder).where(
                    SalesOrder.delay_risk.is_(True), SalesOrder.id.not_in(active_so_ids or {0})
                )
            )
        )
        .scalars()
        .all()
    )
    for s in stale_sos:
        s.delay_risk = False

    created = 0
    new_dedupe_keys: list[str] = []
    for code in delayed_wo_codes:
        dedupe_key = _dedupe_key(code, today)
        made = await notify.create_notification(
            session,
            type_="DELAY",
            target_code=code,
            message=f"작업지시 {code} 지연 위험 — 확인이 필요합니다",
            dedupe_key=dedupe_key,
            channel="EMAIL",
        )
        if made:
            created += 1
            new_dedupe_keys.append(dedupe_key)

    await session.flush()
    sent = await notify.dispatch_pending(session)
    await session.commit()

    # DEF-QA2-S4-002 (중, 100% 재현): 이 잡은 DB 에 notification 행을 정확히 만들지만(REST
    # 폴링 ADM-29 는 그래서 정상), `ws/broadcast.py::broadcast_notification()` 을 한 번도
    # 부르지 않아 `/board` Ticker 는 알림을 영영 못 받았다(실 스케줄러 75초 대기로 재현
    # 확인). 새로 만든(dedupe 로 건너뛰지 않은) 알림만 커밋 **직후** 브로드캐스트한다 —
    # broadcast.py 모듈 docstring의 "커밋 직후" 관례를 그대로 따른다.
    if new_dedupe_keys:
        new_rows = (
            (
                await session.execute(
                    select(Notification).where(Notification.dedupe_key.in_(new_dedupe_keys))
                )
            )
            .scalars()
            .all()
        )
        for row in new_rows:
            await ws_broadcast.broadcast_notification(notify.notification_out(row, None))

    logger.info(
        "지연 감지 잡 완료: 대상 %d건, 지연 %d건, 알림 신규 %d건, 발송 %d건",
        len(pairs), len(delayed_wo_codes), created, sent,
    )
    return DelayRunResult(
        checked=len(pairs),
        delayed=len(delayed_wo_codes),
        notifications_created=created,
        notifications_sent=sent,
    )

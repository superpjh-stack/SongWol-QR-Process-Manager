"""지연 감지 잡 스케줄러 (api-contract §6.5, APScheduler 10분 — plan §5.1 "파일럿은 프로세스 내").

``app.main`` 의 lifespan 이 기동 시 ``start_scheduler()``, 종료 시 ``stop_scheduler()`` 를
부른다. 테스트는 ``SCHEDULER_ENABLED=false`` (conftest 가 세팅)로 꺼 둔다 — 테스트마다 DB
엔진을 왕복시키는데 백그라운드 잡이 겹치면 flaky 해진다.
"""

from __future__ import annotations

import logging
from datetime import datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.domain.board import delay_job

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None
JOB_ID = "delay_detection"


async def _run_delay_job() -> None:
    try:
        async with SessionLocal() as session:
            await delay_job.run_delay_detection(session)
    except Exception:
        logger.exception("지연 감지 잡 실행 실패 (다음 주기에 재시도)")


def start_scheduler() -> AsyncIOScheduler | None:
    global _scheduler
    settings = get_settings()
    if not settings.scheduler_enabled:
        logger.info("SCHEDULER_ENABLED=false — 지연 감지 잡을 돌리지 않습니다")
        return None
    if _scheduler is not None:
        return _scheduler
    sched = AsyncIOScheduler(timezone="Asia/Seoul")
    sched.add_job(
        _run_delay_job,
        "interval",
        minutes=settings.delay_job_interval_minutes,
        id=JOB_ID,
        next_run_time=datetime.now(),  # 기동 직후 1회 즉시 실행 (캐시 컬럼 초기값 채우기)
        max_instances=1,
        coalesce=True,
    )
    sched.start()
    _scheduler = sched
    logger.info("지연 감지 잡 스케줄러 시작 (%d분 주기)", settings.delay_job_interval_minutes)
    return sched


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None

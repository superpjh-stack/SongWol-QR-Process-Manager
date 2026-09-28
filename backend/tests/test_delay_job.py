"""S4: 지연 감지 배치 (api-contract §6.5) — 캐시 컬럼 갱신 · 알림 생성(dedupe) · 재시도.

순수 규칙(``recalc.wo_delay_risk`` 두 조건)은 이미 ``tests/test_wo.py`` 가 표 기반으로
전부 덮는다 — 이 파일은 잡 자체(``domain/board/delay_job.run_delay_detection``)의 오케스트
레이션: 캐시 컬럼을 실제로 쓰는지, 알림이 하루 1회만 만들어지는지, 비활성 WO/SO 캐시가
청소되는지를 DB 까지 왕복해 확인한다.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.db.models.ops import Notification
from app.db.models.order import SalesOrder, WorkOrder
from app.db.session import SessionLocal
from app.domain.board import delay_job
from app.domain.order.so_service import today_kst
from tests.helpers_order import API, confirm_design, issue_all, make_so, setup_master, upload_design

pytestmark = pytest.mark.asyncio


async def _issued_wo_due(
    client: AsyncClient, admin_headers: dict[str, str], due_date: str
) -> tuple[str, str]:
    m = await setup_master(client, admin_headers, routings=("SCREEN",))
    so = await make_so(
        client,
        admin_headers,
        m,
        lines=[{"item_id": m["item"]["id"], "print_method": "SCREEN", "qty": 100}],
        due_date=due_date,
    )
    line_id = so["lines"][0]["id"]
    await upload_design(client, admin_headers, so["id"], line_id)
    await confirm_design(client, admin_headers, so["id"], line_id)
    result = await issue_all(client, admin_headers, so["id"])
    wo = result["work_orders"][0]
    return so["code"], wo["code"]


async def test_delay_job_flags_past_due_wo_and_creates_notification(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    past_due = (date.today() - timedelta(days=1)).isoformat()
    so_code, wo_code = await _issued_wo_due(client, admin_headers, past_due)

    async with SessionLocal() as session:
        result = await delay_job.run_delay_detection(session)
    assert result.delayed >= 1
    assert result.notifications_created >= 1

    async with SessionLocal() as session:
        wo = (
            await session.execute(select(WorkOrder).where(WorkOrder.code == wo_code))
        ).scalar_one()
        so = (
            await session.execute(select(SalesOrder).where(SalesOrder.code == so_code))
        ).scalar_one()
        assert wo.delay_risk is True
        assert so.delay_risk is True
        today = today_kst().isoformat()
        notif = (
            await session.execute(
                select(Notification).where(Notification.dedupe_key == f"DELAY:{wo_code}:{today}")
            )
        ).scalar_one_or_none()
        assert notif is not None
        assert notif.type == "DELAY" and notif.target_code == wo_code
        # SMTP 미설정(테스트 기본값) — 발송 보류, 재시도 대상으로 NULL 유지 (조용한 성공 아님)
        assert notif.sent_at is None


async def test_delay_job_is_idempotent_dedupe_per_day(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    past_due = (date.today() - timedelta(days=2)).isoformat()
    _so_code, wo_code = await _issued_wo_due(client, admin_headers, past_due)

    async with SessionLocal() as session:
        first = await delay_job.run_delay_detection(session)
    async with SessionLocal() as session:
        second = await delay_job.run_delay_detection(session)

    assert first.notifications_created >= 1
    assert second.notifications_created == 0  # dedupe_key UK — 같은 날 재생성 없음

    async with SessionLocal() as session:
        today = today_kst().isoformat()
        rows = (
            await session.execute(
                select(Notification).where(Notification.dedupe_key == f"DELAY:{wo_code}:{today}")
            )
        ).scalars().all()
        assert len(rows) == 1


async def test_delay_job_clears_stale_cache_when_wo_no_longer_active(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    past_due = (date.today() - timedelta(days=1)).isoformat()
    _so_code, wo_code = await _issued_wo_due(client, admin_headers, past_due)
    async with SessionLocal() as session:
        await delay_job.run_delay_detection(session)
    async with SessionLocal() as session:
        wo = (
            await session.execute(select(WorkOrder).where(WorkOrder.code == wo_code))
        ).scalar_one()
        assert wo.delay_risk is True

    res = await client.post(
        f"{API}/wo/{wo_code}/cancel", headers=admin_headers, json={"reason": "재고 소진"}
    )
    assert res.status_code == 200, res.text

    async with SessionLocal() as session:
        await delay_job.run_delay_detection(session)
    async with SessionLocal() as session:
        wo = (
            await session.execute(select(WorkOrder).where(WorkOrder.code == wo_code))
        ).scalar_one()
        assert wo.delay_risk is False  # CANCELLED 는 더 이상 활성이 아니니 캐시를 청소한다


async def test_delay_job_not_yet_due_wo_is_not_flagged(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    far_future = (date.today() + timedelta(days=60)).isoformat()
    _so_code, wo_code = await _issued_wo_due(client, admin_headers, far_future)
    async with SessionLocal() as session:
        await delay_job.run_delay_detection(session)
    async with SessionLocal() as session:
        wo = (
            await session.execute(select(WorkOrder).where(WorkOrder.code == wo_code))
        ).scalar_one()
        assert wo.delay_risk is False


async def test_wo_and_so_delay_true_filter_uses_cache_column(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    """§6.5/RISK-S1-1: ``?delay=true`` 는 0010 캐시 컬럼을 SQL 로 거른다 — 잡이 돌기 전에는
    빈 목록, 돈 뒤에는 뜬다."""
    past_due = (date.today() - timedelta(days=1)).isoformat()
    so_code, wo_code = await _issued_wo_due(client, admin_headers, past_due)

    res = await client.get(f"{API}/wo", headers=admin_headers, params={"delay": "true"})
    assert wo_code not in {w["code"] for w in res.json()["items"]}

    async with SessionLocal() as session:
        await delay_job.run_delay_detection(session)

    res = await client.get(f"{API}/wo", headers=admin_headers, params={"delay": "true"})
    assert wo_code in {w["code"] for w in res.json()["items"]}
    res = await client.get(f"{API}/so", headers=admin_headers, params={"delay": "true"})
    assert so_code in {s["code"] for s in res.json()["items"]}

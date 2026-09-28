"""S4: 현황판·집계·알림·감사 로그 API (api-contract §7.8).

``GET /dashboard/summary`` · ``GET /reports/output`` · ``GET/POST /notifications*`` ·
``GET /audit-logs``.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from httpx import AsyncClient

from app.db.session import SessionLocal
from app.domain.board import notify
from tests.conftest import headers_for, uniq
from tests.helpers_order import API, confirm_design, issue_all, make_so, setup_master, upload_design
from tests.test_scan_api import (
    _issued_wo,
    _setup_p30_station_and_equipment,
    _worker_card,
    scan_body,
)

pytestmark = pytest.mark.asyncio


# ======================================================================
# GET /dashboard/summary
# ======================================================================
async def test_dashboard_summary_shape_and_permissions(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    res = await client.get(f"{API}/dashboard/summary")
    assert res.status_code == 401

    res = await client.get(f"{API}/dashboard/summary", headers=admin_headers)
    assert res.status_code == 200, res.text
    body = res.json()
    for key in (
        "today_due", "delay_risk", "process_queue", "today_shipments",
        "output_per_hour_today", "pending_approvals", "offline_backlog", "generated_at",
    ):
        assert key in body
    assert set(body["today_shipments"]) == {"planned", "done", "overdue"}

    worker_headers = await headers_for(client, uniq("u").lower(), "WORKER")
    res = await client.get(f"{API}/dashboard/summary", headers=worker_headers)
    assert res.status_code == 200  # 전 역할 R (§4)


async def test_dashboard_summary_reflects_pending_approvals(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    station_id, api_key, eq_code = await _setup_p30_station_and_equipment(client, admin_headers)
    worker = await _worker_card()
    _m, wo = await _issued_wo(client, admin_headers)
    body = scan_body(
        station_id=station_id,
        worker_card=worker,
        code=wo["code"],
        action="DONE",
        equipment_code=eq_code,
        qty_good=485,
        qty_bad=5,
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": api_key}, json=body)
    assert res.status_code == 200 and res.json()["requires_approval"] is True

    res = await client.get(f"{API}/dashboard/summary", headers=admin_headers)
    assert res.json()["pending_approvals"] >= 1


# ======================================================================
# GET /reports/output
# ======================================================================
async def test_reports_output_json_and_xlsx(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    from_ = (date.today() - timedelta(days=7)).isoformat()
    to = (date.today() + timedelta(days=1)).isoformat()
    res = await client.get(
        f"{API}/reports/output",
        headers=admin_headers,
        params={"from": from_, "to": to, "group": "day"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["group"] == "day" and body["from"] == from_ and body["to"] == to
    assert "totals" in body and set(body["totals"]) == {"qty_good", "qty_bad", "output_per_hour"}

    res_bad = await client.get(
        f"{API}/reports/output",
        headers=admin_headers,
        params={"from": from_, "group": "century"},
    )
    assert res_bad.status_code == 422

    res_xlsx = await client.get(
        f"{API}/reports/output",
        headers=admin_headers,
        params={"from": from_, "to": to, "format": "xlsx"},
    )
    assert res_xlsx.status_code == 200
    assert res_xlsx.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument"
    )


async def test_reports_output_reflects_p30_done(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    station_id, api_key, eq_code = await _setup_p30_station_and_equipment(client, admin_headers)
    worker = await _worker_card()
    manager_headers = await headers_for(client, uniq("mgr").lower(), "MANAGER")
    _m, wo = await _issued_wo(client, admin_headers)
    body = scan_body(
        station_id=station_id,
        worker_card=worker,
        code=wo["code"],
        action="DONE",
        equipment_code=eq_code,
        qty_good=485,
        qty_bad=5,
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": api_key}, json=body)
    event_uuid = res.json()["event_uuid"]
    await client.post(
        f"{API}/scan/{event_uuid}/approve", headers=manager_headers, json={"decision": "APPROVE"}
    )

    today = date.today().isoformat()
    res = await client.get(
        f"{API}/reports/output",
        headers=admin_headers,
        params={"from": today, "to": today, "group": "day", "process_code": "P30"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["totals"]["qty_good"] >= 485


# ======================================================================
# 알림
# ======================================================================
async def test_notifications_list_and_ack(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    async with SessionLocal() as session:
        created = await notify.create_notification(
            session,
            type_="DELAY",
            target_code=uniq("WO-TEST-"),
            message="테스트 지연 알림",
            dedupe_key=uniq("DEDUPE-"),
        )
        await session.commit()
    assert created is True

    res = await client.get(
        f"{API}/notifications", headers=admin_headers, params={"unacked": "true"}
    )
    assert res.status_code == 200, res.text
    items = res.json()["items"]
    assert items and items[0]["ack_by"] is None

    notif_id = items[0]["id"]
    res = await client.post(f"{API}/notifications/{notif_id}/ack", headers=admin_headers)
    assert res.status_code == 200, res.text
    assert res.json()["ack_by"]["login_id"] == "t_admin"

    res2 = await client.post(f"{API}/notifications/{notif_id}/ack", headers=admin_headers)
    assert res2.status_code == 409

    res = await client.get(
        f"{API}/notifications", headers=admin_headers, params={"unacked": "true"}
    )
    assert all(i["id"] != notif_id for i in res.json()["items"])


async def test_notifications_worker_forbidden(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    worker_headers = await headers_for(client, uniq("u").lower(), "WORKER")
    res = await client.get(f"{API}/notifications", headers=worker_headers)
    assert res.status_code == 403


async def test_notify_dedupe_key_unique_returns_false_second_time(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    key = uniq("DEDUPE-")
    async with SessionLocal() as session:
        first = await notify.create_notification(
            session, type_="DEFECT", target_code="WO-X", message="m1", dedupe_key=key
        )
        await session.commit()
    async with SessionLocal() as session:
        second = await notify.create_notification(
            session, type_="DEFECT", target_code="WO-X", message="m2 다른 문구", dedupe_key=key
        )
        await session.commit()
    assert first is True
    assert second is False


# ======================================================================
# 감사 로그
# ======================================================================
async def test_audit_logs_requires_admin_or_manager(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    m = await setup_master(client, admin_headers, routings=("SCREEN",))
    so = await make_so(client, admin_headers, m)
    line_id = so["lines"][0]["id"]
    await upload_design(client, admin_headers, so["id"], line_id)
    await confirm_design(client, admin_headers, so["id"], line_id)
    await issue_all(client, admin_headers, so["id"])

    res = await client.get(f"{API}/audit-logs", headers=admin_headers)
    assert res.status_code == 200, res.text
    assert res.json()["total"] >= 1

    worker_headers = await headers_for(client, uniq("u").lower(), "WORKER")
    res2 = await client.get(f"{API}/audit-logs", headers=worker_headers)
    assert res2.status_code == 403

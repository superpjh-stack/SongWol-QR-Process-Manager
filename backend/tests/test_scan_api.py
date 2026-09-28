"""S2 스캔 API 통합 테스트 (api-contract §5, §7.6). ``/scan`` · ``/scan/batch`` ·
``/scan/{event_uuid}/approve`` · ``/scan/pending`` · ``/stations/{id}/queue`` ·
``/stations/{id}/equipment``.

인증/권한 검사와, 실제 WO 발행 → 스캔 DONE(E1 승인 포함) → ``recalc`` 로 WO 상태 반영까지
확인하는 end-to-end 흐름 1건을 포함한다.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import AsyncClient

from app.core.checkcode import make_check
from tests.conftest import ensure_station, ensure_user, headers_for, uniq
from tests.helpers_order import API, issue_all, make_so, setup_master

pytestmark = pytest.mark.asyncio


def scan_body(
    *, station_id: str, worker_card: str, code: str, action: str, **kw: Any
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "event_uuid": str(uuid.uuid4()),
        "scanned_at": datetime.now(UTC).isoformat(),
        "station_id": station_id,
        "worker_card": worker_card,
        "code": code,
        "check": make_check(code),
        "action": action,
    }
    body.update(kw)
    return body


async def _issued_wo(
    client: AsyncClient, admin_headers: dict[str, str]
) -> tuple[dict[str, Any], dict[str, Any]]:
    """도안 확정 없이 발행 가능한 NONE 가공방식 WO 는 P30 이 없으므로, SCREEN 으로 발행하고
    도안은 확정한다."""
    m = await setup_master(client, admin_headers, routings=("SCREEN",))
    so = await make_so(
        client,
        admin_headers,
        m,
        lines=[
            {"item_id": m["item"]["id"], "print_method": "SCREEN", "qty": 500, "unit_price": 1000}
        ],
    )
    line_id = so["lines"][0]["id"]
    from tests.helpers_order import confirm_design, upload_design

    await upload_design(client, admin_headers, so["id"], line_id)
    await confirm_design(client, admin_headers, so["id"], line_id)
    result = await issue_all(client, admin_headers, so["id"])
    wo = result["work_orders"][0]
    return m, wo


async def _setup_p30_station_and_equipment(
    client: AsyncClient, admin_headers: dict[str, str]
) -> tuple[str, str, str]:
    station_id, api_key = await ensure_station(uniq("T-K-P30-"), type_="KIOSK", process_code="P30")
    eq_code = uniq("PRT")
    res = await client.post(
        f"{API}/equipment",
        headers=admin_headers,
        json={
            "code": eq_code,
            "name": "나염기 테스트",
            "process_code": "P30",
            "equip_type": "PRINT",
        },
    )
    assert res.status_code == 201, res.text
    return station_id, api_key, eq_code


async def _worker_card(role: str = "WORKER") -> str:
    u = await ensure_user(uniq("w").lower(), role, card=True)
    return str(u.card_code)


# ======================================================================
# 인증 · 권한
# ======================================================================
async def test_scan_requires_station_key(client: AsyncClient) -> None:
    res = await client.post(
        f"{API}/scan",
        json=scan_body(station_id="X", worker_card="US-1", code="WO-261001-0001", action="DONE"),
    )
    assert res.status_code == 401
    assert res.json()["code"] == "BAD_STATION_KEY"


async def test_scan_wrong_station_key_rejected(
    admin_headers: dict[str, str], client: AsyncClient
) -> None:
    station_id, api_key, _eq = await _setup_p30_station_and_equipment(client, admin_headers)
    other_station, _ = await ensure_station(uniq("T-K-P30-"), type_="KIOSK", process_code="P30")
    worker = await _worker_card()
    body = scan_body(
        station_id=other_station, worker_card=worker, code="WO-261001-0001", action="DONE"
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": api_key}, json=body)
    # station_id 가 인증된 단말 키와 다르면 요청 자체가 거부된다 (401/403 오류, ScanResponse 아님)
    assert res.status_code == 403
    assert res.json()["code"] == "BAD_STATION_KEY"


async def test_scan_missing_worker_card_is_422(
    admin_headers: dict[str, str], client: AsyncClient
) -> None:
    station_id, api_key, _eq = await _setup_p30_station_and_equipment(client, admin_headers)
    body = scan_body(station_id=station_id, worker_card="", code="WO-261001-0001", action="DONE")
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": api_key}, json=body)
    assert res.status_code == 422, res.text


async def test_scan_unknown_worker_card_404(
    admin_headers: dict[str, str], client: AsyncClient
) -> None:
    station_id, api_key, _eq = await _setup_p30_station_and_equipment(client, admin_headers)
    body = scan_body(
        station_id=station_id, worker_card="US-99999", code="WO-261001-0001", action="DONE"
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": api_key}, json=body)
    assert res.status_code == 404
    assert res.json()["code"] == "USER_CARD_NOT_FOUND"


# ======================================================================
# LOGIN 반려 · 범위 밖 액션 · 형식 오류
# ======================================================================
async def test_scan_login_action_rejected(
    admin_headers: dict[str, str], client: AsyncClient
) -> None:
    station_id, api_key, _eq = await _setup_p30_station_and_equipment(client, admin_headers)
    worker = await _worker_card()
    body = scan_body(station_id=station_id, worker_card=worker, code="US-1", action="LOGIN")
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": api_key}, json=body)
    assert res.status_code == 200
    data = res.json()
    assert data["result"] == "REJECT"
    assert data["code"] == "USE_AUTH_WORKER"


async def test_scan_out_of_scope_action_rejected(
    admin_headers: dict[str, str], client: AsyncClient
) -> None:
    station_id, api_key, _eq = await _setup_p30_station_and_equipment(client, admin_headers)
    worker = await _worker_card()
    body = scan_body(
        station_id=station_id, worker_card=worker, code="WO-261001-0001", action="RECEIVE"
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": api_key}, json=body)
    assert res.status_code == 200
    data = res.json()
    assert data["result"] == "REJECT"
    assert data["code"] == "ACTION_NOT_YET_SUPPORTED"


async def test_scan_bad_checkcode_rejected(
    admin_headers: dict[str, str], client: AsyncClient
) -> None:
    station_id, api_key, _eq = await _setup_p30_station_and_equipment(client, admin_headers)
    worker = await _worker_card()
    body = scan_body(
        station_id=station_id,
        worker_card=worker,
        code="WO-261001-0001",
        action="DONE",
        check="ZZZZ",
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": api_key}, json=body)
    assert res.status_code == 200
    data = res.json()
    assert data["result"] == "REJECT"
    assert data["code"] == "BAD_CHECKCODE"


async def test_scan_manual_input_bypasses_checkcode_but_needs_existence(
    admin_headers: dict[str, str], client: AsyncClient
) -> None:
    station_id, api_key, _eq = await _setup_p30_station_and_equipment(client, admin_headers)
    worker = await _worker_card()
    body = scan_body(
        station_id=station_id,
        worker_card=worker,
        code="WO-261001-9999",
        action="DONE",
        input_via="MANUAL",
    )
    body.pop("check")
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": api_key}, json=body)
    assert res.status_code == 200
    data = res.json()
    assert data["result"] == "REJECT"
    assert data["code"] == "WO_NOT_FOUND"


async def test_scan_wo_not_found(admin_headers: dict[str, str], client: AsyncClient) -> None:
    station_id, api_key, _eq = await _setup_p30_station_and_equipment(client, admin_headers)
    worker = await _worker_card()
    code = "WO-261001-9998"
    body = scan_body(station_id=station_id, worker_card=worker, code=code, action="DONE")
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": api_key}, json=body)
    data = res.json()
    assert data["result"] == "REJECT"
    assert data["code"] == "WO_NOT_FOUND"


# ======================================================================
# 멱등 (event_uuid 재전송)
# ======================================================================
async def test_scan_duplicate_event_uuid_replays_stored_response(
    admin_headers: dict[str, str], client: AsyncClient
) -> None:
    station_id, api_key, _eq = await _setup_p30_station_and_equipment(client, admin_headers)
    worker = await _worker_card()
    body = scan_body(
        station_id=station_id, worker_card=worker, code="WO-261001-9997", action="DONE"
    )
    res1 = await client.post(f"{API}/scan", headers={"X-Station-Key": api_key}, json=body)
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["duplicate"] is False

    res2 = await client.post(f"{API}/scan", headers={"X-Station-Key": api_key}, json=body)
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["duplicate"] is True
    assert data2["message"] == data1["message"]
    assert data2["result"] == data1["result"]
    assert data2["code"] == data1["code"]


# ======================================================================
# 배치 (§5.3, §13.5 ⑦)
# ======================================================================
async def test_scan_batch_wraps_item_failures_as_200(
    admin_headers: dict[str, str], client: AsyncClient
) -> None:
    station_id, api_key, _eq = await _setup_p30_station_and_equipment(client, admin_headers)
    worker = await _worker_card()
    good = scan_body(station_id=station_id, worker_card=worker, code="US-1", action="LOGIN")
    malformed = {"event_uuid": str(uuid.uuid4())}  # station_id·code·action 등 필수 필드 누락
    res = await client.post(
        f"{API}/scan/batch", headers={"X-Station-Key": api_key}, json={"events": [good, malformed]}
    )
    assert res.status_code == 200, res.text
    results = res.json()["results"]
    assert len(results) == 2
    by_uuid = {r["event_uuid"]: r["response"] for r in results}
    assert by_uuid[good["event_uuid"]]["code"] == "USE_AUTH_WORKER"
    assert by_uuid[malformed["event_uuid"]]["result"] == "REJECT"
    assert by_uuid[malformed["event_uuid"]]["code"] == "VALIDATION_ERROR"


# ======================================================================
# 단말 (equipment · queue · pending)
# ======================================================================
async def test_stations_equipment_filters_by_process(
    admin_headers: dict[str, str], client: AsyncClient
) -> None:
    station_id, api_key, eq_code = await _setup_p30_station_and_equipment(client, admin_headers)
    res = await client.get(
        f"{API}/stations/{station_id}/equipment", headers={"X-Station-Key": api_key}
    )
    assert res.status_code == 200, res.text
    codes = {e["code"] for e in res.json()}
    assert eq_code in codes


async def test_stations_equipment_forbidden_for_other_station(
    admin_headers: dict[str, str], client: AsyncClient
) -> None:
    station_id, api_key, _eq = await _setup_p30_station_and_equipment(client, admin_headers)
    other_id, other_key = await ensure_station(uniq("T-K-P30-"), type_="KIOSK", process_code="P30")
    res = await client.get(
        f"{API}/stations/{station_id}/equipment", headers={"X-Station-Key": other_key}
    )
    assert res.status_code == 403


async def test_scan_pending_and_queue_endpoints_reachable(
    admin_headers: dict[str, str], client: AsyncClient
) -> None:
    station_id, api_key, _eq = await _setup_p30_station_and_equipment(client, admin_headers)
    res = await client.get(f"{API}/scan/pending", headers={"X-Station-Key": api_key})
    assert res.status_code == 200
    assert isinstance(res.json(), list)

    res = await client.get(f"{API}/stations/{station_id}/queue", headers={"X-Station-Key": api_key})
    assert res.status_code == 200
    body = res.json()
    assert body["process_code"] == "P30"
    assert "items" in body and "pending_approvals" in body


async def test_stations_queue_forbidden_for_worker_role(
    admin_headers: dict[str, str], client: AsyncClient
) -> None:
    station_id, _api_key, _eq = await _setup_p30_station_and_equipment(client, admin_headers)
    worker_headers = await headers_for(client, uniq("u").lower(), "WORKER")
    res = await client.get(f"{API}/stations/{station_id}/queue", headers=worker_headers)
    assert res.status_code == 403


# ======================================================================
# End-to-end: 발행 → 스캔 DONE(E1) → 승인 → recalc 로 WO 상태 확인
# ======================================================================
async def test_e2e_issue_scan_e1_approve_updates_wo_status(
    admin_headers: dict[str, str], client: AsyncClient
) -> None:
    station_id, api_key, eq_code = await _setup_p30_station_and_equipment(client, admin_headers)
    worker = await _worker_card()
    manager_headers = await headers_for(client, uniq("mgr").lower(), "MANAGER")

    _m, wo = await _issued_wo(client, admin_headers)
    wo_code = wo["code"]
    assert wo["status"] == "ISSUED"

    # P20(입고) 이 아직 WAITING 인 상태에서 P30 완료 스캔 → E1 보류
    body = scan_body(
        station_id=station_id,
        worker_card=worker,
        code=wo_code,
        action="DONE",
        equipment_code=eq_code,
        qty_good=485,
        qty_bad=5,
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": api_key}, json=body)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["result"] == "WARN"
    assert data["requires_approval"] is True
    event_uuid = data["event_uuid"]

    # 미승인 상태에서는 WO 가 아직 ISSUED
    res = await client.get(f"{API}/wo/{wo_code}", headers=admin_headers)
    assert res.json()["status"] == "ISSUED"

    # 반장(MANAGER, JWT) 승인
    res = await client.post(
        f"{API}/scan/{event_uuid}/approve", headers=manager_headers, json={"decision": "APPROVE"}
    )
    assert res.status_code == 200, res.text
    approved = res.json()
    assert approved["result"] in ("OK", "WARN")
    assert approved["requires_approval"] is False

    # recalc 결과 확인: P20 DONE_ESTIMATED, P30 DONE → WO IN_PROGRESS
    res = await client.get(f"{API}/wo/{wo_code}", headers=admin_headers)
    detail = res.json()
    assert detail["status"] == "IN_PROGRESS"
    steps_by_code = {s["process_code"]: s for s in detail["steps"]}
    assert steps_by_code["P20"]["status"] == "DONE_ESTIMATED"
    assert steps_by_code["P20"]["is_estimated"] is True
    assert steps_by_code["P30"]["status"] == "DONE"
    assert steps_by_code["P30"]["qty_good"] == 485
    assert steps_by_code["P30"]["qty_bad"] == 5

    # 승인 뒤 같은 공정 재스캔은 60 초 중복 규칙에 걸린다
    dup_body = scan_body(
        station_id=station_id,
        worker_card=worker,
        code=wo_code,
        action="DONE",
        equipment_code=eq_code,
        qty_good=485,
        qty_bad=5,
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": api_key}, json=dup_body)
    assert res.status_code == 200
    assert res.json()["result"] == "WARN"
    assert res.json()["message"] == "이미 처리됨"


async def test_approve_deny_returns_reject(
    admin_headers: dict[str, str], client: AsyncClient
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

    res = await client.post(
        f"{API}/scan/{event_uuid}/approve", headers=manager_headers, json={"decision": "DENY"}
    )
    assert res.status_code == 200
    assert res.json() == {
        "result": "REJECT",
        "message": "승인 거부",
        "wo": None,
        "next_process": None,
        "remaining_qty": None,
        "requires_approval": False,
        "approval_token": None,
        "warnings": [],
        "step": None,
        "event_uuid": event_uuid,
        "duplicate": False,
        "code": None,
        "label_job": None,
        "worker": None,
        "box": None,
        "receipt": None,
        "shipment": None,
    }


async def test_approve_non_pending_event_is_409(
    admin_headers: dict[str, str], client: AsyncClient
) -> None:
    station_id, api_key, _eq = await _setup_p30_station_and_equipment(client, admin_headers)
    worker = await _worker_card()
    manager_headers = await headers_for(client, uniq("mgr").lower(), "MANAGER")
    body = scan_body(station_id=station_id, worker_card=worker, code="US-1", action="LOGIN")
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": api_key}, json=body)
    event_uuid = res.json()["event_uuid"]
    res = await client.post(
        f"{API}/scan/{event_uuid}/approve", headers=manager_headers, json={"decision": "APPROVE"}
    )
    assert res.status_code == 409
    assert res.json()["code"] == "STATE_CONFLICT"


async def test_approve_requires_manager_role(
    admin_headers: dict[str, str], client: AsyncClient
) -> None:
    station_id, api_key, eq_code = await _setup_p30_station_and_equipment(client, admin_headers)
    worker = await _worker_card()
    worker_headers = await headers_for(client, uniq("u").lower(), "WORKER")
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
    res = await client.post(
        f"{API}/scan/{event_uuid}/approve", headers=worker_headers, json={"decision": "APPROVE"}
    )
    assert res.status_code == 403
    assert res.json()["code"] == "APPROVER_ROLE"

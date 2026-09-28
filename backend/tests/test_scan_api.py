"""S2/S3 스캔 API 통합 테스트 (api-contract §5, §7.6). ``/scan`` · ``/scan/batch`` ·
``/scan/{event_uuid}/approve`` · ``/scan/pending`` · ``/stations/{id}/queue`` ·
``/stations/{id}/equipment``.

인증/권한 검사와, 실제 WO 발행 → 스캔 DONE(E1 승인 포함) → ``recalc`` 로 WO 상태 반영까지
확인하는 end-to-end 흐름을 포함한다. S3: RECEIVE·PACK·SHIP·MAP 스캔 액션과, 발행 → RECEIVE →
DONE → PACK → SHIP 전체 파이프라인(WO SHIPPED · SO SHIPPED · 재고 반영)을 확인하는 end-to-end
흐름 1건을 더 포함한다.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import AsyncClient

from app.core.checkcode import make_check
from tests.conftest import ensure_station, ensure_user, headers_for, uniq
from tests.helpers_order import API, confirm_design, issue_all, make_so, setup_master, upload_design

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
    await upload_design(client, admin_headers, so["id"], line_id)
    await confirm_design(client, admin_headers, so["id"], line_id)
    result = await issue_all(client, admin_headers, so["id"])
    wo = result["work_orders"][0]
    return m, wo


async def _issued_wo_with_so(
    client: AsyncClient, admin_headers: dict[str, str]
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """``_issued_wo`` 와 같지만 ``so`` 도 돌려준다(SO 상태·재고 확인용, S3 end-to-end)."""
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
    await upload_design(client, admin_headers, so["id"], line_id)
    await confirm_design(client, admin_headers, so["id"], line_id)
    result = await issue_all(client, admin_headers, so["id"])
    wo = result["work_orders"][0]
    return m, so, wo


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
    """S3 부터 RECEIVE/PACK/SHIP/MAP 은 실제로 구현됐다 — 여전히 범위 밖인 액션(CANCEL·REPRINT,
    S4 예정, engine.OUT_OF_SCOPE_ACTIONS)으로 검사한다."""
    station_id, api_key, _eq = await _setup_p30_station_and_equipment(client, admin_headers)
    worker = await _worker_card()
    body = scan_body(
        station_id=station_id, worker_card=worker, code="WO-261001-0001", action="CANCEL"
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


async def test_e3_route_insert_approve_shifts_two_steps_without_duplicate_code(
    admin_headers: dict[str, str], client: AsyncClient
) -> None:
    """E3(§5.2 3단계·§11-5): P30 이 없는 NONE 라우팅(P20→P50→P60)에서 P30 스캔 →
    승인 시 P30 을 seq 2 에 끼워 넣고 P50·P60 을 한 칸씩 뒤로 민다. 삽입 지점 뒤에
    단계가 2개 이상이면 ``_persist_inserted_step`` 이 SQLAlchemy flush 순서를 신뢰해
    UK(wo_id, seq) 충돌(409 DUPLICATE_CODE)로 실패하던 회귀(QA① S2)."""
    station_id, api_key, eq_code = await _setup_p30_station_and_equipment(client, admin_headers)
    worker = await _worker_card()
    manager_headers = await headers_for(client, uniq("mgr").lower(), "MANAGER")

    m = await setup_master(client, admin_headers, routings=("NONE",))
    so = await make_so(
        client,
        admin_headers,
        m,
        lines=[{"item_id": m["item"]["id"], "print_method": "NONE", "qty": 30, "unit_price": 500}],
    )
    result = await issue_all(client, admin_headers, so["id"])
    wo = result["work_orders"][0]
    wo_code = wo["code"]
    steps_by_code = {s["process_code"]: s for s in wo["steps"]}
    assert set(steps_by_code) == {"P20", "P50", "P60"}

    body = scan_body(
        station_id=station_id,
        worker_card=worker,
        code=wo_code,
        action="DONE",
        equipment_code=eq_code,
        qty_good=30,
        qty_bad=0,
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": api_key}, json=body)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["result"] == "WARN"
    assert data["requires_approval"] is True
    event_uuid = data["event_uuid"]

    # 1차 승인: E3 삽입 자체는 성공해야 한다 (예전에는 여기서 409 DUPLICATE_CODE 였다).
    # 삽입 직후 새 P30 의 직전 단계(P20) 도 아직 WAITING 이라 E1 로 재보류된다.
    res = await client.post(
        f"{API}/scan/{event_uuid}/approve", headers=manager_headers, json={"decision": "APPROVE"}
    )
    assert res.status_code == 200, res.text
    first = res.json()
    assert first["result"] == "WARN"
    assert first["requires_approval"] is True

    res = await client.get(f"{API}/wo/{wo_code}", headers=admin_headers)
    detail = res.json()
    steps_by_code = {s["process_code"]: s for s in detail["steps"]}
    assert [s["process_code"] for s in sorted(detail["steps"], key=lambda s: s["seq"])] == [
        "P20",
        "P30",
        "P50",
        "P60",
    ]
    assert steps_by_code["P30"]["status"] == "WAITING"

    # 2차 승인(E1): P20 이 DONE_ESTIMATED 로, 원 스캔(P30 DONE)이 반영된다.
    res = await client.post(
        f"{API}/scan/{event_uuid}/approve", headers=manager_headers, json={"decision": "APPROVE"}
    )
    assert res.status_code == 200, res.text
    second = res.json()
    assert second["result"] == "OK"
    assert second["requires_approval"] is False
    assert second["step"]["process_code"] == "P30"
    assert second["step"]["status"] == "DONE"

    res = await client.get(f"{API}/wo/{wo_code}", headers=admin_headers)
    detail = res.json()
    assert detail["status"] == "IN_PROGRESS"
    steps_by_code = {s["process_code"]: s for s in detail["steps"]}
    assert steps_by_code["P20"]["status"] == "DONE_ESTIMATED"
    assert steps_by_code["P30"]["status"] == "DONE"
    assert steps_by_code["P30"]["qty_good"] == 30
    assert steps_by_code["P50"]["status"] == "WAITING"
    assert steps_by_code["P60"]["status"] == "WAITING"


# ======================================================================
# S3: RECEIVE (api-contract §5.2 5-RECEIVE · §6.3)
# ======================================================================
async def test_scan_receive_partial_then_full_and_fail_quarantines(
    admin_headers: dict[str, str], client: AsyncClient
) -> None:
    p20_station, p20_key = await ensure_station(
        uniq("T-K-P20-"), type_="KIOSK", process_code="P20"
    )
    worker = await _worker_card()
    _m, wo = await _issued_wo(client, admin_headers)
    wo_code = wo["code"]

    body = scan_body(
        station_id=p20_station,
        worker_card=worker,
        code=wo_code,
        action="RECEIVE",
        qty_good=100,
        extra={"inspection": "PASS"},
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": p20_key}, json=body)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["result"] == "WARN" and "부족" in data["message"]
    assert data["receipt"]["wo_receipt_status"] == "PARTIAL"

    res = await client.get(f"{API}/wo/{wo_code}", headers=admin_headers)
    assert res.json()["receipt_status"] == "PARTIAL"

    body = scan_body(
        station_id=p20_station,
        worker_card=worker,
        code=wo_code,
        action="RECEIVE",
        qty_good=390,
        extra={"inspection": "PASS"},
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": p20_key}, json=body)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["result"] == "OK"
    assert data["receipt"]["wo_receipt_status"] == "FULL"

    detail = (await client.get(f"{API}/wo/{wo_code}", headers=admin_headers)).json()
    assert detail["receipt_status"] == "FULL" and detail["qty_received"] == 490
    steps_by_code = {s["process_code"]: s for s in detail["steps"]}
    assert steps_by_code["P20"]["status"] == "DONE"
    assert steps_by_code["P30"]["qty_in"] == 490

    # 검수 불합격 → LOT 격리, 누계에서 제외(다른 WO)
    _m2, wo2 = await _issued_wo(client, admin_headers)
    body = scan_body(
        station_id=p20_station,
        worker_card=worker,
        code=wo2["code"],
        action="RECEIVE",
        qty_good=50,
        extra={"inspection": "FAIL"},
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": p20_key}, json=body)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["result"] == "WARN" and "격리" in data["message"]
    assert data["receipt"]["lot"]["status"] == "QUARANTINE"
    detail2 = (await client.get(f"{API}/wo/{wo2['code']}", headers=admin_headers)).json()
    assert detail2["qty_received"] == 0


async def test_scan_receive_fail_with_quarantine_memo(
    admin_headers: dict[str, str], client: AsyncClient
) -> None:
    """S3 수정 웨이브(DEF-QA2-S3-002): FAIL RECEIVE 가 `extra.quarantine_memo` 를 받으면 LOT
    자동 격리와 **같은 요청**에서 메모가 저장된다 — 별도로 `POST /lots/{code}/quarantine` 을
    부를 필요가 없다(그 경로는 이미 QUARANTINE 이라 예전엔 항상 409 였다)."""
    p20_station, p20_key = await ensure_station(
        uniq("T-K-P20-"), type_="KIOSK", process_code="P20"
    )
    worker = await _worker_card()
    _m, wo = await _issued_wo(client, admin_headers)

    body = scan_body(
        station_id=p20_station,
        worker_card=worker,
        code=wo["code"],
        action="RECEIVE",
        qty_good=50,
        extra={"inspection": "FAIL", "quarantine_memo": "박스 훼손·오염 발견"},
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": p20_key}, json=body)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["receipt"]["lot"]["status"] == "QUARANTINE"
    assert data["receipt"]["lot"]["quarantine_memo"] == "박스 훼손·오염 발견"

    lot_code = data["receipt"]["lot"]["code"]
    res = await client.get(f"{API}/lots/{lot_code}", headers=admin_headers)
    assert res.status_code == 200
    assert res.json()["quarantine_memo"] == "박스 훼손·오염 발견"


# ======================================================================
# S3: PACK/SHIP/MAP 공통 파이프라인 헬퍼
# ======================================================================
async def _wo_ready_for_pack(client: AsyncClient, admin_headers: dict[str, str]) -> tuple[str, str]:
    """발행 → RECEIVE(P20 FULL) → DONE(P30) 까지 스캔으로 밀어 둔다. (wo_code, worker_card)."""
    p30_station, p30_key, eq_code = await _setup_p30_station_and_equipment(client, admin_headers)
    worker = await _worker_card()
    _m, wo = await _issued_wo(client, admin_headers)
    wo_code = wo["code"]

    p20_station, p20_key = await ensure_station(
        uniq("T-K-P20-"), type_="KIOSK", process_code="P20"
    )
    body = scan_body(
        station_id=p20_station,
        worker_card=worker,
        code=wo_code,
        action="RECEIVE",
        qty_good=500,
        extra={"inspection": "PASS"},
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": p20_key}, json=body)
    assert res.status_code == 200 and res.json()["result"] == "OK", res.text

    body = scan_body(
        station_id=p30_station,
        worker_card=worker,
        code=wo_code,
        action="DONE",
        equipment_code=eq_code,
        qty_good=500,
        qty_bad=0,
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": p30_key}, json=body)
    assert res.status_code == 200 and res.json()["result"] == "OK", res.text
    return wo_code, worker


async def _wo_packed(client: AsyncClient, admin_headers: dict[str, str]) -> tuple[str, str, str]:
    """``_wo_ready_for_pack`` 뒤 단일 박스로 PACK 까지. (wo_code, worker_card, box_code)."""
    wo_code, worker = await _wo_ready_for_pack(client, admin_headers)
    p50_station, p50_key = await ensure_station(
        uniq("T-K-P50-"), type_="KIOSK", process_code="P50"
    )
    body = scan_body(
        station_id=p50_station, worker_card=worker, code=wo_code, action="PACK", qty_box=500
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": p50_key}, json=body)
    assert res.status_code == 200, res.text
    return wo_code, worker, res.json()["box"]["code"]


# ======================================================================
# S3: PACK (api-contract §5.2 5-PACK · §13.7)
# ======================================================================
async def test_scan_pack_no_printer_warns_and_reaches_wo_packed(
    admin_headers: dict[str, str], client: AsyncClient
) -> None:
    """프린터 미설정(§13.7 프린터 선택 순서): 박스는 항상 커밋되지만 result=WARN,
    label_job.zpl_sent=false, label_job.error=NO_PRINTER, warnings 에 안내 문구."""
    wo_code, worker = await _wo_ready_for_pack(client, admin_headers)
    p50_station, p50_key = await ensure_station(
        uniq("T-K-P50-"), type_="KIOSK", process_code="P50"
    )
    body = scan_body(
        station_id=p50_station,
        worker_card=worker,
        code=wo_code,
        action="PACK",
        qty_box=500,
        client_seq=7,
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": p50_key}, json=body)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["result"] == "WARN"
    assert data["warnings"] and "프린터" in data["warnings"][0]
    assert data["label_job"]["zpl_sent"] is False
    assert data["label_job"]["error"] == "NO_PRINTER"
    assert data["box"]["qty"] == 500 and data["box"]["box_no"] == 1

    detail = (await client.get(f"{API}/wo/{wo_code}", headers=admin_headers)).json()
    assert detail["status"] == "PACKED"


# ======================================================================
# S3: SHIP (api-contract §5.2 5-SHIP · §13.6 다박스)
# ======================================================================
async def test_scan_ship_single_box_confirms_wo_and_so(
    admin_headers: dict[str, str], client: AsyncClient
) -> None:
    wo_code, worker, box_code = await _wo_packed(client, admin_headers)
    p60_station, p60_key = await ensure_station(
        uniq("T-K-P60-"), type_="KIOSK", process_code="P60"
    )
    body = scan_body(
        station_id=p60_station,
        worker_card=worker,
        code=box_code,
        action="SHIP",
        extra={"tracking_no": uniq("TRK")},
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": p60_key}, json=body)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["result"] == "OK"
    assert data["shipment"]["status"] == "SHIPPED" and data["shipment"]["qty_total"] == 500
    assert data["remaining_qty"] == 0  # ㉑: SHIP 응답의 remaining_qty 는 SO 잔량

    detail = (await client.get(f"{API}/wo/{wo_code}", headers=admin_headers)).json()
    assert detail["status"] == "SHIPPED" and detail["qty_shipped"] == 500


async def test_scan_ship_wo_wildcard_picks_all_unshipped_boxes(
    admin_headers: dict[str, str], client: AsyncClient
) -> None:
    """§11-15: code=WO 이면 그 WO 의 미발송 박스 전부를 싣는다."""
    wo_code, worker = await _wo_ready_for_pack(client, admin_headers)
    p50_station, p50_key = await ensure_station(
        uniq("T-K-P50-"), type_="KIOSK", process_code="P50"
    )
    for qty_box in (300, 200):
        body = scan_body(
            station_id=p50_station,
            worker_card=worker,
            code=wo_code,
            action="PACK",
            qty_box=qty_box,
        )
        res = await client.post(f"{API}/scan", headers={"X-Station-Key": p50_key}, json=body)
        assert res.status_code == 200, res.text
    assert (await client.get(f"{API}/wo/{wo_code}", headers=admin_headers)).json()[
        "status"
    ] == "PACKED"

    p60_station, p60_key = await ensure_station(
        uniq("T-K-P60-"), type_="KIOSK", process_code="P60"
    )
    body = scan_body(
        station_id=p60_station,
        worker_card=worker,
        code=wo_code,
        action="SHIP",
        extra={"tracking_no": uniq("TRK")},
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": p60_key}, json=body)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["result"] == "OK"
    assert data["shipment"]["qty_total"] == 500
    assert len(data["shipment"]["boxes"]) == 2


async def test_scan_ship_cross_so_mismatch_rejected(
    admin_headers: dict[str, str], client: AsyncClient
) -> None:
    wo1_code, worker, box1 = await _wo_packed(client, admin_headers)
    _wo2_code, _worker2, box2 = await _wo_packed(client, admin_headers)
    p60_station, p60_key = await ensure_station(
        uniq("T-K-P60-"), type_="KIOSK", process_code="P60"
    )
    body = scan_body(
        station_id=p60_station,
        worker_card=worker,
        code=box1,
        action="SHIP",
        extra={"tracking_no": uniq("TRK"), "box_codes": [box2]},
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": p60_key}, json=body)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["result"] == "REJECT" and data["code"] == "BOX_SO_MISMATCH"


async def _wo_ready_for_pack_with_so(
    client: AsyncClient, admin_headers: dict[str, str]
) -> tuple[str, str, dict[str, Any], dict[str, Any]]:
    """``_wo_ready_for_pack`` 와 같지만 ``_m``(item 코드 등)·``so`` 도 돌려준다(재고·SO 확인용)."""
    p30_station, p30_key, eq_code = await _setup_p30_station_and_equipment(client, admin_headers)
    worker = await _worker_card()
    m, so, wo = await _issued_wo_with_so(client, admin_headers)
    wo_code = wo["code"]

    p20_station, p20_key = await ensure_station(
        uniq("T-K-P20-"), type_="KIOSK", process_code="P20"
    )
    body = scan_body(
        station_id=p20_station,
        worker_card=worker,
        code=wo_code,
        action="RECEIVE",
        qty_good=500,
        extra={"inspection": "PASS"},
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": p20_key}, json=body)
    assert res.status_code == 200 and res.json()["result"] == "OK", res.text

    body = scan_body(
        station_id=p30_station,
        worker_card=worker,
        code=wo_code,
        action="DONE",
        equipment_code=eq_code,
        qty_good=500,
        qty_bad=0,
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": p30_key}, json=body)
    assert res.status_code == 200 and res.json()["result"] == "OK", res.text
    return wo_code, worker, m, so


async def test_scan_ship_batch_merges_same_so_tracking_no_two_boxes(
    admin_headers: dict[str, str], client: AsyncClient
) -> None:
    """DEF-QA1-S3-001 = DEF-QA2-S3-004 회귀 테스트 — QA 재현 시나리오 그대로: 박스 2개(같은
    SO·같은 tracking_no)를 `/scan/batch` 한 번에 SHIP 이벤트 2건으로 보낸다(PDA 실사용 경로,
    박스 1개당 SHIP 이벤트 1건). 예전 코드는 `apply_ship` 이 `status=="READY"` 만 매치해서 매
    이벤트마다 새 shipment 를 만들었다(같은 송장인데 shipment 2건으로 쪼개짐) — 이 테스트는
    정확히 **1건**의 shipment 로 병합되고, 재고·WO 반영이 두 박스분 정확히 한 번씩(이중
    계상 없이) 됐는지를 확인한다."""
    wo_code, worker, m, so = await _wo_ready_for_pack_with_so(client, admin_headers)
    p50_station, p50_key = await ensure_station(
        uniq("T-K-P50-"), type_="KIOSK", process_code="P50"
    )
    box_codes = []
    for qty_box in (300, 200):
        body = scan_body(
            station_id=p50_station,
            worker_card=worker,
            code=wo_code,
            action="PACK",
            qty_box=qty_box,
        )
        res = await client.post(f"{API}/scan", headers={"X-Station-Key": p50_key}, json=body)
        assert res.status_code == 200, res.text
        box_codes.append(res.json()["box"]["code"])

    p60_station, p60_key = await ensure_station(
        uniq("T-K-P60-"), type_="KIOSK", process_code="P60"
    )
    tracking_no = uniq("TRK")
    events = [
        scan_body(
            station_id=p60_station,
            worker_card=worker,
            code=box_code,
            action="SHIP",
            extra={"tracking_no": tracking_no},
        )
        for box_code in box_codes
    ]
    res = await client.post(
        f"{API}/scan/batch", headers={"X-Station-Key": p60_key}, json={"events": events}
    )
    assert res.status_code == 200, res.text
    results = res.json()["results"]
    assert len(results) == 2
    for r in results:
        assert r["response"]["result"] == "OK", r
    shipment_ids = {r["response"]["shipment"]["id"] for r in results}
    assert len(shipment_ids) == 1, "두 SHIP 이벤트가 같은 shipment 로 병합돼야 한다"

    shipment_id = shipment_ids.pop()
    detail = (
        await client.get(f"{API}/shipments/{shipment_id}", headers=admin_headers)
    ).json()
    assert detail["box_count"] == 2
    assert detail["qty_total"] == 500  # 300+200, 이중 계상 없이 정확히 한 번씩

    listing = await client.get(
        f"{API}/shipments", headers=admin_headers, params={"so_code": so["code"]}
    )
    assert listing.json()["total"] == 1  # shipment 행이 2건으로 쪼개지지 않았다

    wo_detail = (await client.get(f"{API}/wo/{wo_code}", headers=admin_headers)).json()
    assert wo_detail["status"] == "SHIPPED" and wo_detail["qty_shipped"] == 500

    so_detail = (await client.get(f"{API}/so/{so['id']}", headers=admin_headers)).json()
    assert so_detail["status"] == "SHIPPED"

    stock = (
        await client.get(f"{API}/stock", headers=admin_headers, params={"q": m["item"]["code"]})
    ).json()["items"][0]
    assert stock["qty_on_hand"] == 0  # RECEIVE(+500) · SHIP(-500) 정확히 한 번씩


async def test_scan_ship_adds_box_to_already_shipped_shipment_no_double_count(
    admin_headers: dict[str, str], client: AsyncClient
) -> None:
    """QA① 이 "단순히 매치 범위를 `status IN (READY, SHIPPED)` 로 넓히면 이미 반영된 박스까지
    재고·P60 누계를 이중 반영한다"고 직접 확인했던 시나리오의 회귀 테스트다. 먼저 박스 2개를
    같은 tracking_no 로 SHIP 해 shipment 를 SHIPPED 로 확정한 뒤, **별도의 이후 스캔**으로 세
    번째 박스를 같은 SO·같은 tracking_no 로 SHIP 한다 — 이미 SHIPPED 인 shipment 에 합류하는
    경우다. 이때 먼저 반영된 두 박스가 재고·WO 누계에 다시 반영되면 안 된다(박스 단위
    `shipment_box.reconciled_at` 델타 추적으로 방지)."""
    wo_code, worker, m, so = await _wo_ready_for_pack_with_so(client, admin_headers)
    p50_station, p50_key = await ensure_station(
        uniq("T-K-P50-"), type_="KIOSK", process_code="P50"
    )
    box_codes = []
    for qty_box in (200, 200, 100):
        body = scan_body(
            station_id=p50_station,
            worker_card=worker,
            code=wo_code,
            action="PACK",
            qty_box=qty_box,
        )
        res = await client.post(f"{API}/scan", headers={"X-Station-Key": p50_key}, json=body)
        assert res.status_code == 200, res.text
        box_codes.append(res.json()["box"]["code"])

    p60_station, p60_key = await ensure_station(
        uniq("T-K-P60-"), type_="KIOSK", process_code="P60"
    )
    tracking_no = uniq("TRK")

    # 박스 1·2 를 먼저 같은 tracking_no 로 SHIP → shipment SHIPPED 로 확정(400)
    for box_code in box_codes[:2]:
        body = scan_body(
            station_id=p60_station,
            worker_card=worker,
            code=box_code,
            action="SHIP",
            extra={"tracking_no": tracking_no},
        )
        res = await client.post(f"{API}/scan", headers={"X-Station-Key": p60_key}, json=body)
        assert res.status_code == 200, res.text
        assert res.json()["shipment"]["status"] == "SHIPPED"

    detail_after_two = (
        await client.get(f"{API}/wo/{wo_code}", headers=admin_headers)
    ).json()
    assert detail_after_two["qty_shipped"] == 400
    shipment_id_after_two = None

    # 박스 3 을 나중에(별도 요청) 같은 tracking_no 로 SHIP → 이미 SHIPPED 인 shipment 에 합류
    body = scan_body(
        station_id=p60_station,
        worker_card=worker,
        code=box_codes[2],
        action="SHIP",
        extra={"tracking_no": tracking_no},
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": p60_key}, json=body)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["result"] == "OK"
    shipment_id_after_two = data["shipment"]["id"]
    assert data["shipment"]["box_count"] == 3
    assert data["shipment"]["qty_total"] == 500  # 200+200+100, 이중 계상 없이

    listing = await client.get(
        f"{API}/shipments", headers=admin_headers, params={"so_code": so["code"]}
    )
    assert listing.json()["total"] == 1
    assert listing.json()["items"][0]["id"] == shipment_id_after_two

    wo_detail = (await client.get(f"{API}/wo/{wo_code}", headers=admin_headers)).json()
    # 400(먼저 반영) + 100(나중 합류분) = 500, 먼저 반영된 400 이 다시 더해지면 안 된다
    assert wo_detail["status"] == "SHIPPED" and wo_detail["qty_shipped"] == 500

    stock = (
        await client.get(f"{API}/stock", headers=admin_headers, params={"q": m["item"]["code"]})
    ).json()["items"][0]
    assert stock["qty_on_hand"] == 0  # RECEIVE(+500) · SHIP 누계(-500) 정확히, 이중 차감 없이


# ======================================================================
# S3: MAP (api-contract §5.2 5-MAP)
# ======================================================================
async def test_scan_map_new_and_remap(admin_headers: dict[str, str], client: AsyncClient) -> None:
    station_id, api_key = await ensure_station(
        uniq("T-K-P20-"), type_="KIOSK", process_code="P20"
    )
    worker = await _worker_card()
    _m1, wo1 = await _issued_wo(client, admin_headers)
    _m2, wo2 = await _issued_wo(client, admin_headers)
    vb = uniq("VB")

    body = scan_body(
        station_id=station_id,
        worker_card=worker,
        code=vb,
        action="MAP",
        extra={"wo_code": wo1["code"]},
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": api_key}, json=body)
    assert res.status_code == 200, res.text
    assert res.json()["result"] == "OK"

    lookup = await client.get(f"{API}/vendor-barcodes/{vb}", headers=admin_headers)
    assert lookup.json()["wo"]["code"] == wo1["code"]

    body = scan_body(
        station_id=station_id,
        worker_card=worker,
        code=vb,
        action="MAP",
        extra={"wo_code": wo2["code"]},
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": api_key}, json=body)
    assert res.status_code == 200, res.text
    assert res.json()["result"] == "OK"

    lookup = await client.get(f"{API}/vendor-barcodes/{vb}", headers=admin_headers)
    assert lookup.json()["wo"]["code"] == wo2["code"]


# ======================================================================
# S3: end-to-end — 발행 → RECEIVE → DONE(P30) → PACK → SHIP
# ======================================================================
async def test_e2e_receive_pack_ship_confirms_wo_so_and_stock(
    admin_headers: dict[str, str], client: AsyncClient
) -> None:
    _m, so, wo = await _issued_wo_with_so(client, admin_headers)
    wo_code = wo["code"]

    p20_station, p20_key = await ensure_station(
        uniq("T-K-P20-"), type_="KIOSK", process_code="P20"
    )
    p30_station, p30_key, eq_code = await _setup_p30_station_and_equipment(client, admin_headers)
    p50_station, p50_key = await ensure_station(
        uniq("T-K-P50-"), type_="KIOSK", process_code="P50"
    )
    p60_station, p60_key = await ensure_station(
        uniq("T-K-P60-"), type_="KIOSK", process_code="P60"
    )
    worker = await _worker_card()

    # RECEIVE
    body = scan_body(
        station_id=p20_station,
        worker_card=worker,
        code=wo_code,
        action="RECEIVE",
        qty_good=500,
        extra={"inspection": "PASS"},
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": p20_key}, json=body)
    assert res.status_code == 200 and res.json()["result"] == "OK", res.text

    stock = (
        await client.get(f"{API}/stock", headers=admin_headers, params={"q": _m["item"]["code"]})
    ).json()["items"][0]
    assert stock["qty_on_hand"] == 500

    # DONE (P30, 허용오차 이내)
    body = scan_body(
        station_id=p30_station,
        worker_card=worker,
        code=wo_code,
        action="DONE",
        equipment_code=eq_code,
        qty_good=500,
        qty_bad=0,
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": p30_key}, json=body)
    assert res.status_code == 200 and res.json()["result"] == "OK", res.text

    # PACK
    body = scan_body(
        station_id=p50_station, worker_card=worker, code=wo_code, action="PACK", qty_box=500
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": p50_key}, json=body)
    assert res.status_code == 200, res.text
    box_code = res.json()["box"]["code"]
    assert (await client.get(f"{API}/wo/{wo_code}", headers=admin_headers)).json()[
        "status"
    ] == "PACKED"

    # SHIP
    body = scan_body(
        station_id=p60_station,
        worker_card=worker,
        code=box_code,
        action="SHIP",
        extra={"tracking_no": uniq("TRK")},
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": p60_key}, json=body)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["result"] == "OK"
    assert data["shipment"]["status"] == "SHIPPED"
    assert data["remaining_qty"] == 0

    wo_detail = (await client.get(f"{API}/wo/{wo_code}", headers=admin_headers)).json()
    assert wo_detail["status"] == "SHIPPED" and wo_detail["qty_shipped"] == 500

    so_detail = (await client.get(f"{API}/so/{so['id']}", headers=admin_headers)).json()
    assert so_detail["status"] == "SHIPPED"

    stock = (
        await client.get(f"{API}/stock", headers=admin_headers, params={"q": _m["item"]["code"]})
    ).json()["items"][0]
    assert stock["qty_on_hand"] == 0

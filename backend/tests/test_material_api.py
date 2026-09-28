"""S3 자재 API 통합 테스트 (api-contract §7.4). ``/receipts`` · ``/vendor-barcodes`` ·
``/lots`` · ``/stock`` · ``/stock/txns``. RECEIVE 는 ``domain/scan/service.py`` 를
``domain/material/service.py`` 가 공유한다 — 여기서는 REST 경로만 확인한다(스캔 경로는
``test_scan_api.py``).
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient

from tests.conftest import ensure_station, headers_for, uniq
from tests.helpers_order import API, confirm_design, issue_all, make_so, setup_master, upload_design

pytestmark = pytest.mark.asyncio


async def _issued_wo(client: AsyncClient, admin_headers: dict[str, str]) -> dict[str, object]:
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
    return {"m": m, "so": so, "wo": wo}


async def test_receipt_create_and_idempotent_and_list(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    ctx = await _issued_wo(client, admin_headers)
    wo = ctx["wo"]

    body = {
        "wo_code": wo["code"],
        "qty": 500,
        "box_count": 5,
        "inspection": "PASS",
        "vendor": "테스트업체",
    }
    res = await client.post(f"{API}/receipts", headers=admin_headers, json=body)
    assert res.status_code == 201, res.text
    receipt = res.json()
    assert receipt["wo_code"] == wo["code"]
    assert receipt["qty"] == 500
    assert receipt["wo_receipt_status"] == "FULL"
    assert receipt["lot"]["status"] == "OK"

    # WO 는 P20 DONE, receipt_status FULL, P30 qty_in 승계
    detail = (await client.get(f"{API}/wo/{wo['code']}", headers=admin_headers)).json()
    assert detail["receipt_status"] == "FULL"
    steps_by_code = {s["process_code"]: s for s in detail["steps"]}
    assert steps_by_code["P20"]["status"] == "DONE"
    assert steps_by_code["P30"]["qty_in"] == 500

    # STATION 은 event_uuid 필수
    station_id, api_key = await ensure_station(uniq("T-P20-"), type_="KIOSK", process_code="P20")
    res = await client.post(
        f"{API}/receipts",
        headers={"X-Station-Key": api_key},
        json={"wo_code": wo["code"], "qty": 1, "inspection": "PASS"},
    )
    assert res.status_code == 422 and res.json()["code"] == "EVENT_UUID_REQUIRED"

    # event_uuid 멱등: 같은 event_uuid 재전송 → 같은 응답(중복 입고 생성 없음)
    eu = str(uuid.uuid4())
    dup_body = {"wo_code": wo["code"], "qty": 10, "inspection": "PASS", "event_uuid": eu}
    r1 = await client.post(f"{API}/receipts", headers=admin_headers, json=dup_body)
    r2 = await client.post(f"{API}/receipts", headers=admin_headers, json=dup_body)
    assert r1.status_code == 201 and r2.status_code == 201
    assert r1.json()["id"] == r2.json()["id"]

    res = await client.get(f"{API}/receipts", headers=admin_headers, params={"wo_code": wo["code"]})
    assert res.status_code == 200
    assert res.json()["total"] >= 1

    res = await client.get(
        f"{API}/receipts", headers=admin_headers, params={"wo_code": wo["code"], "format": "xlsx"}
    )
    assert res.status_code == 200
    assert res.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


async def test_receipt_partial_and_fail_quarantine(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    ctx = await _issued_wo(client, admin_headers)
    wo = ctx["wo"]

    # 부족 입고 → WARN 이 아니라 REST 는 200/201 로 감싸되 wo_receipt_status=PARTIAL
    res = await client.post(
        f"{API}/receipts",
        headers=admin_headers,
        json={"wo_code": wo["code"], "qty": 100, "inspection": "PASS"},
    )
    assert res.status_code == 201
    assert res.json()["wo_receipt_status"] == "PARTIAL"
    assert res.json()["remaining_qty"] == 400

    # 검수 불합격 → LOT QUARANTINE, 누계에서 제외
    res = await client.post(
        f"{API}/receipts",
        headers=admin_headers,
        json={"wo_code": wo["code"], "qty": 50, "inspection": "FAIL"},
    )
    assert res.status_code == 201
    fail_receipt = res.json()
    assert fail_receipt["lot"]["status"] == "QUARANTINE"
    assert fail_receipt["wo_receipt_status"] == "PARTIAL"  # 여전히 100 만 누계

    lot_code = fail_receipt["lot"]["code"]
    res = await client.get(f"{API}/lots/{lot_code}", headers=admin_headers)
    assert res.status_code == 200 and res.json()["status"] == "QUARANTINE"

    res = await client.post(
        f"{API}/lots/{lot_code}/quarantine", headers=admin_headers, json={"memo": "x"}
    )
    assert res.status_code == 409  # 이미 격리됨

    res = await client.post(f"{API}/lots/{lot_code}/release", headers=admin_headers)
    assert res.status_code == 200 and res.json()["status"] == "OK"

    res = await client.post(f"{API}/lots/{lot_code}/release", headers=admin_headers)
    assert res.status_code == 409  # 이미 해제됨


async def test_vendor_barcode_map_lookup_deactivate(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    ctx = await _issued_wo(client, admin_headers)
    wo = ctx["wo"]
    vb = uniq("VB")

    res = await client.post(
        f"{API}/vendor-barcodes/map",
        headers=admin_headers,
        json={"vendor_barcode": vb, "wo_code": wo["code"]},
    )
    assert res.status_code == 201, res.text
    mapping = res.json()
    assert mapping["wo_code"] == wo["code"] and mapping["active"] is True

    res = await client.get(f"{API}/vendor-barcodes/{vb}", headers=admin_headers)
    assert res.status_code == 200
    body = res.json()
    assert body["mapping"]["vendor_barcode"] == vb
    assert body["wo"]["code"] == wo["code"]

    res = await client.get(
        f"{API}/vendor-barcodes", headers=admin_headers, params={"wo_code": wo["code"]}
    )
    assert res.status_code == 200 and res.json()["total"] == 1

    res = await client.post(
        f"{API}/vendor-barcodes/{mapping['id']}/deactivate", headers=admin_headers
    )
    assert res.status_code == 200 and res.json()["active"] is False

    res = await client.get(f"{API}/vendor-barcodes/{vb}", headers=admin_headers)
    assert res.json()["mapping"] is None  # 비활성 매핑은 조회되지 않는다


async def test_stock_adjust_and_list_and_txns(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    ctx = await _issued_wo(client, admin_headers)
    m = ctx["m"]
    item_id = m["item"]["id"]

    manager = await headers_for(client, uniq("mgr_stock").lower(), "MANAGER")
    res = await client.post(
        f"{API}/stock/adjust",
        headers=manager,
        json={"item_id": item_id, "qty_delta": 30, "reason": "기초 재고"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["qty"] == 30

    res = await client.post(
        f"{API}/stock/adjust",
        headers=manager,
        json={"item_id": item_id, "qty_delta": 0, "reason": "x"},
    )
    assert res.status_code == 422  # qty_delta != 0

    res = await client.get(f"{API}/stock", headers=admin_headers, params={"q": m["item"]["code"]})
    assert res.status_code == 200 and res.json()["total"] == 1
    assert res.json()["items"][0]["qty_on_hand"] == 30

    res = await client.get(f"{API}/stock", headers=admin_headers, params={"format": "xlsx"})
    assert res.status_code == 200
    assert res.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )

    res = await client.get(
        f"{API}/stock/txns",
        headers=admin_headers,
        params={"item_id": item_id, "txn_type": "ADJUST"},
    )
    assert res.status_code == 200 and res.json()["total"] == 1

    # 권한: SALES 는 조정 불가
    sales = await headers_for(client, uniq("sales_stock").lower(), "SALES")
    res = await client.post(
        f"{API}/stock/adjust",
        headers=sales,
        json={"item_id": item_id, "qty_delta": 1, "reason": "x"},
    )
    assert res.status_code == 403

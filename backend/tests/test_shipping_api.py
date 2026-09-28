"""S3 출하 API 통합 테스트 (api-contract §7.5). ``/boxes`` · ``/shipments`` ·
``/shipments/daily-report``. PACK·SHIP 은 ``domain/scan/service.py`` 를
``domain/shipping/service.py`` 가 공유한다 — 여기서는 REST 경로만 확인한다(스캔 경로는
``test_scan_api.py``).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import AsyncClient

from tests.conftest import headers_for, uniq
from tests.helpers_order import (
    API,
    confirm_design,
    issue_all,
    make_so,
    setup_master,
    upload_design,
)

pytestmark = pytest.mark.asyncio


async def _packed_wo(
    client: AsyncClient, admin_headers: dict[str, str], *, qty: int = 200
) -> dict[str, Any]:
    """RECEIVE(P20 FULL) 까지만 REST 로 밀어 두고, PACK 은 개별 테스트가 원하는 대로 만든다."""
    m = await setup_master(client, admin_headers, routings=("SCREEN",))
    so = await make_so(
        client,
        admin_headers,
        m,
        lines=[
            {"item_id": m["item"]["id"], "print_method": "SCREEN", "qty": qty, "unit_price": 1000}
        ],
    )
    line_id = so["lines"][0]["id"]
    await upload_design(client, admin_headers, so["id"], line_id)
    await confirm_design(client, admin_headers, so["id"], line_id)
    wo = (await issue_all(client, admin_headers, so["id"]))["work_orders"][0]
    res = await client.post(
        f"{API}/receipts",
        headers=admin_headers,
        json={"wo_code": wo["code"], "qty": qty, "inspection": "PASS"},
    )
    assert res.status_code == 201, res.text
    return {"m": m, "so": so, "wo": wo}


async def _done_p30(
    client: AsyncClient, admin_headers: dict[str, str], wo_code: str, qty: int
) -> None:
    """P30 DONE 을 관리자 웹 승인 없이 만들기 위해, 스캔이 아니라 ORM 으로 직접 완료 처리한다
    (여기서는 PACK/SHIP REST 만 검증하면 되고, 스캔 경유 DONE 흐름은 test_scan_api.py 몫)."""
    from sqlalchemy import select

    from app.db.models.order import SalesOrder, WorkOrder, WoRouteStep
    from app.db.session import SessionLocal
    from app.domain.order import recalc

    async with SessionLocal() as s:
        wo = (await s.execute(select(WorkOrder).where(WorkOrder.code == wo_code))).scalar_one()
        steps = list(
            (
                await s.execute(select(WoRouteStep).where(WoRouteStep.wo_id == wo.id))
            )
            .scalars()
            .all()
        )
        p30 = next(x for x in steps if x.process_code == "P30")
        p30.status = "DONE"
        p30.qty_good = qty
        p30.qty_bad = 0
        p30.done_at = datetime.now(UTC)
        p50 = next(x for x in steps if x.process_code == "P50")
        p50.qty_in = qty
        wo.qty_good = qty
        recalc.recalc_wo(wo, steps)
        await s.flush()
        so_row = await s.get(SalesOrder, wo.so_id)
        assert so_row is not None
        await recalc.recalc_so(s, so_row)
        await s.commit()


async def test_box_create_detail_list_and_event_uuid_idempotent(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    ctx = await _packed_wo(client, admin_headers, qty=200)
    wo = ctx["wo"]
    await _done_p30(client, admin_headers, wo["code"], 200)

    # event_uuid 멱등: 같은 요청을 두 번 보내도 박스가 한 번만 생긴다
    eu = str(uuid.uuid4())
    body = {"wo_code": wo["code"], "qty": 120, "event_uuid": eu}
    r1 = await client.post(f"{API}/boxes", headers=admin_headers, json=body)
    r2 = await client.post(f"{API}/boxes", headers=admin_headers, json=body)
    assert r1.status_code == 201 and r2.status_code == 201
    box = r1.json()
    assert r2.json()["id"] == box["id"]
    assert box["wo_code"] == wo["code"] and box["qty"] == 120 and box["box_no"] == 1
    assert box["wo_status"] == "IN_PROGRESS"  # 200 중 120 만 포장 → 아직 미완

    res = await client.get(f"{API}/boxes/{box['code']}", headers=admin_headers)
    assert res.status_code == 200
    detail = res.json()
    assert detail["wo"]["code"] == wo["code"] and detail["worker"] is not None
    assert detail["shipment"] is None

    res = await client.get(f"{API}/boxes", headers=admin_headers, params={"wo_code": wo["code"]})
    assert res.status_code == 200 and res.json()["total"] == 1

    params = {"wo_code": wo["code"], "unshipped": "true"}
    res = await client.get(f"{API}/boxes", headers=admin_headers, params=params)
    assert res.status_code == 200 and res.json()["total"] == 1

    # 두 번째 박스로 나머지 완료 → WO PACKED
    res = await client.post(
        f"{API}/boxes", headers=admin_headers, json={"wo_code": wo["code"], "qty": 80}
    )
    assert res.status_code == 201
    assert res.json()["box_no"] == 2 and res.json()["wo_status"] == "PACKED"

    # 이미 PACKED 된 WO 에는 더 이상 포장할 수 없다 (엔진 §4.3-2 상태 검사)
    res = await client.post(
        f"{API}/boxes", headers=admin_headers, json={"wo_code": wo["code"], "qty": 1}
    )
    assert res.status_code == 409


async def test_shipment_create_merge_daily_report(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    """§6.4: 같은 SO·같은 tracking_no 의 READY shipment 는 합류한다 — 그러려면 먼저 만든
    shipment 가 아직 SHIPPED 로 확정되지 않아야 한다(``confirm: false``)."""
    ctx = await _packed_wo(client, admin_headers, qty=100)
    wo = ctx["wo"]
    so = ctx["so"]
    await _done_p30(client, admin_headers, wo["code"], 100)

    res1 = await client.post(
        f"{API}/boxes", headers=admin_headers, json={"wo_code": wo["code"], "qty": 60}
    )
    b1 = res1.json()
    res2 = await client.post(
        f"{API}/boxes", headers=admin_headers, json={"wo_code": wo["code"], "qty": 40}
    )
    b2 = res2.json()

    tracking_no = uniq("TRK")
    res = await client.post(
        f"{API}/shipments",
        headers=admin_headers,
        json={
            "box_codes": [b1["code"]],
            "tracking_no": tracking_no,
            "carrier": "CJ",
            "confirm": False,
        },
    )
    assert res.status_code == 201, res.text
    shipment = res.json()
    assert shipment["status"] == "READY" and shipment["qty_total"] == 60

    # 같은 SO·같은 tracking_no 로 합류하고, 이번엔 확정
    res = await client.post(
        f"{API}/shipments",
        headers=admin_headers,
        json={"box_codes": [b2["code"]], "tracking_no": tracking_no, "confirm": True},
    )
    assert res.status_code == 201, res.text
    merged = res.json()
    assert merged["id"] == shipment["id"]
    assert merged["status"] == "SHIPPED"
    assert merged["qty_total"] == 100
    assert merged["box_count"] == 2

    # WO SHIPPED, SO SHIPPED, 재고 감소
    detail = (await client.get(f"{API}/wo/{wo['code']}", headers=admin_headers)).json()
    assert detail["status"] == "SHIPPED" and detail["qty_shipped"] == 100
    so_detail = (await client.get(f"{API}/so/{so['id']}", headers=admin_headers)).json()
    assert so_detail["status"] == "SHIPPED"
    stock_res = await client.get(
        f"{API}/stock", headers=admin_headers, params={"q": ctx["m"]["item"]["code"]}
    )
    stock = stock_res.json()["items"][0]
    assert stock["qty_on_hand"] == 0  # RECEIVE(+100) · SHIP(-100)

    res = await client.get(
        f"{API}/shipments", headers=admin_headers, params={"so_code": so["code"]}
    )
    assert res.status_code == 200 and res.json()["total"] == 1

    res = await client.get(f"{API}/shipments/{shipment['id']}", headers=admin_headers)
    assert res.status_code == 200 and res.json()["box_count"] == 2

    date_str = merged["shipped_at"][:10]
    params = {"date": date_str, "format": "json"}
    res = await client.get(f"{API}/shipments/daily-report", headers=admin_headers, params=params)
    assert res.status_code == 200, res.text
    report = res.json()
    assert report["totals"]["shipments"] >= 1 and report["totals"]["boxes"] >= 2
    assert any(r["so_code"] == so["code"] and r["qty"] == 100 for r in report["rows"])

    res = await client.get(
        f"{API}/shipments/daily-report", headers=admin_headers, params={"date": date_str}
    )
    assert res.status_code == 200
    assert res.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


async def test_shipment_cross_so_mismatch_and_permissions(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    ctx1 = await _packed_wo(client, admin_headers, qty=50)
    ctx2 = await _packed_wo(client, admin_headers, qty=50)
    await _done_p30(client, admin_headers, ctx1["wo"]["code"], 50)
    await _done_p30(client, admin_headers, ctx2["wo"]["code"], 50)
    res1 = await client.post(
        f"{API}/boxes", headers=admin_headers, json={"wo_code": ctx1["wo"]["code"], "qty": 50}
    )
    b1 = res1.json()
    res2 = await client.post(
        f"{API}/boxes", headers=admin_headers, json={"wo_code": ctx2["wo"]["code"], "qty": 50}
    )
    b2 = res2.json()

    res = await client.post(
        f"{API}/shipments",
        headers=admin_headers,
        json={
            "box_codes": [b1["code"], b2["code"]],
            "tracking_no": uniq("TRK"),
            "confirm": True,
        },
    )
    assert res.status_code == 409 and res.json()["code"] == "BOX_SO_MISMATCH"

    sales = await headers_for(client, uniq("sales_ship").lower(), "SALES")
    res = await client.post(
        f"{API}/shipments",
        headers=sales,
        json={"box_codes": [b1["code"]], "tracking_no": uniq("TRK"), "confirm": True},
    )
    assert res.status_code == 403

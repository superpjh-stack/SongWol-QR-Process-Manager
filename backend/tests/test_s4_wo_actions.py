"""S4: WO 액션 — E3 재작업(rework) · E5 재발행(reprint) · E6 취소(cancel) · WO 검색.

기존 S2/S3 스캔 인프라(``tests/test_scan_api.py`` 의 헬퍼)를 그대로 재사용해 P30 DONE(불량
포함)까지 실제로 스캔해 둔 뒤, 그 위에서 새 액션을 검증한다.
"""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient

from tests.conftest import ensure_station, headers_for, uniq
from tests.helpers_order import API
from tests.test_scan_api import (
    _issued_wo,
    _setup_p30_station_and_equipment,
    _worker_card,
    scan_body,
)

pytestmark = pytest.mark.asyncio


async def _wo_p30_done_with_defect(
    client: AsyncClient, admin_headers: dict[str, str], *, qty_good: int = 480, qty_bad: int = 20
) -> tuple[dict[str, Any], str, str]:
    """P30 DONE 까지 스캔 — 불량 ``qty_bad`` 포함. P20(입고) 을 아직 거치지 않아 E1 로 보류되므로
    반장(MANAGER) 승인까지 거친다(``test_e2e_issue_scan_e1_approve_updates_wo_status`` 와 같은
    패턴). 승인 뒤에도 "반영된" 이벤트는 원본 DONE 이벤트 그대로다(approve() 가 원본
    ``scan_event`` 의 ``approval_status`` 만 APPROVED 로 바꾸고 별도 APPROVE 이벤트를
    덧붙인다 — engine.py 모듈 docstring, §5.5).

    (wo_summary_dict, wo_code, event_uuid_of_done_scan) 반환.
    """
    station_id, api_key, eq_code = await _setup_p30_station_and_equipment(client, admin_headers)
    worker = await _worker_card()
    manager_headers = await headers_for(client, uniq("mgr").lower(), "MANAGER")
    m, wo = await _issued_wo(client, admin_headers)
    body = scan_body(
        station_id=station_id,
        worker_card=worker,
        code=wo["code"],
        action="DONE",
        equipment_code=eq_code,
        qty_good=qty_good,
        qty_bad=qty_bad,
    )
    res = await client.post(f"{API}/scan", headers={"X-Station-Key": api_key}, json=body)
    assert res.status_code == 200 and res.json()["requires_approval"] is True, res.text
    event_uuid = res.json()["event_uuid"]
    res2 = await client.post(
        f"{API}/scan/{event_uuid}/approve", headers=manager_headers, json={"decision": "APPROVE"}
    )
    assert res2.status_code == 200 and res2.json()["result"] in ("OK", "WARN"), res2.text
    return wo, wo["code"], event_uuid


# ======================================================================
# E3 재작업 (B4-03)
# ======================================================================
async def test_rework_creates_child_wo_from_p30_and_stock_txn(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    _wo, wo_code, _ev = await _wo_p30_done_with_defect(client, admin_headers)
    detail = (await client.get(f"{API}/wo/{wo_code}", headers=admin_headers)).json()
    assert detail["status"] == "IN_PROGRESS" and detail["qty_bad"] == 20

    res = await client.post(
        f"{API}/wo/{wo_code}/rework",
        headers=admin_headers,
        json={"qty": 15, "reason": "인쇄 번짐", "reinsert_p30": True},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["lot"] is None  # 설계 결정: 재작업은 새 입고 LOT 을 만들지 않는다
    child = body["child"]
    assert child["code"] == f"{wo_code}-A"
    assert child["parent_wo_code"] == wo_code and child["split_suffix"] == "A"
    assert child["qty_ordered"] == 15 and child["status"] == "ISSUED"
    assert [s["process_code"] for s in child["steps"]] == ["P30", "P50", "P60"]
    assert child["steps"][0]["qty_in"] == 15

    # 부모의 qty_ordered 는 줄지 않는다(불량은 이미 생산된 수량이지 미생산 잔량이 아니다)
    parent = (await client.get(f"{API}/wo/{wo_code}", headers=admin_headers)).json()
    assert parent["qty_ordered"] == 500
    assert any(c["code"] == child["code"] for c in parent["children"])

    # stock_txn(REWORK, +15) 기록 확인
    from sqlalchemy import select

    from app.db.models.material import StockTxn
    from app.db.session import SessionLocal

    async with SessionLocal() as s:
        rows = (
            (await s.execute(select(StockTxn).where(StockTxn.txn_type == "REWORK"))).scalars().all()
        )
    assert any(t.qty == 15 for t in rows)


async def test_rework_reinsert_false_starts_at_p50(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    _wo, wo_code, _ev = await _wo_p30_done_with_defect(
        client, admin_headers, qty_good=490, qty_bad=10
    )
    res = await client.post(
        f"{API}/wo/{wo_code}/rework",
        headers=admin_headers,
        json={"qty": 5, "reason": "재인쇄 불가 — 원단 손상", "reinsert_p30": False},
    )
    assert res.status_code == 200, res.text
    child = res.json()["child"]
    assert [s["process_code"] for s in child["steps"]] == ["P50", "P60"]
    assert child["steps"][0]["qty_in"] == 5


async def test_rework_qty_exceeds_bad_is_409(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    _wo, wo_code, _ev = await _wo_p30_done_with_defect(
        client, admin_headers, qty_good=480, qty_bad=20
    )
    res = await client.post(
        f"{API}/wo/{wo_code}/rework",
        headers=admin_headers,
        json={"qty": 21, "reason": "사유", "reinsert_p30": True},
    )
    assert res.status_code == 409 and res.json()["code"] == "STATE_CONFLICT"


async def test_rework_requires_manager_role(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    _wo, wo_code, _ev = await _wo_p30_done_with_defect(client, admin_headers)
    worker_headers = await headers_for(client, uniq("u").lower(), "WORKER")
    res = await client.post(
        f"{API}/wo/{wo_code}/rework",
        headers=worker_headers,
        json={"qty": 5, "reason": "x"},
    )
    assert res.status_code == 403


async def test_rework_wrong_status_is_409(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    m, wo = await _issued_wo(client, admin_headers)
    res = await client.post(
        f"{API}/wo/{wo['code']}/rework",
        headers=admin_headers,
        json={"qty": 5, "reason": "x"},
    )
    assert res.status_code == 409 and res.json()["code"] == "STATE_CONFLICT"


# ======================================================================
# E5 재발행 (D47 · §15.4) — WORK_ORDER_PDF 전용
# ======================================================================
async def test_reprint_work_order_pdf_bumps_issue_no(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    _m, wo = await _issued_wo(client, admin_headers)
    wo_code = wo["code"]
    before = await client.get(
        f"{API}/labels/issues", headers=admin_headers, params={"target_code": wo_code}
    )
    before_count = len([i for i in before.json() if i["label_type"] == "WORK_ORDER_PDF"])

    res = await client.post(f"{API}/wo/{wo_code}/reprint", headers=admin_headers, json={})
    assert res.status_code == 200, res.text
    job = res.json()
    assert job["label_type"] == "WORK_ORDER_PDF"
    assert job["zpl_sent"] is False and job["error"] is None
    assert job["pdf_url"] == f"/api/v1/labels/work-order/{wo_code}.pdf"
    assert job["issue_no"] >= 1

    res2 = await client.post(f"{API}/wo/{wo_code}/reprint", headers=admin_headers, json={})
    assert res2.status_code == 200
    assert res2.json()["issue_no"] == job["issue_no"] + 1

    after = await client.get(
        f"{API}/labels/issues", headers=admin_headers, params={"target_code": wo_code}
    )
    after_count = len([i for i in after.json() if i["label_type"] == "WORK_ORDER_PDF"])
    assert after_count == before_count + 2


async def test_reprint_allows_station(client: AsyncClient, admin_headers: dict[str, str]) -> None:
    _m, wo = await _issued_wo(client, admin_headers)
    station_id, api_key = await ensure_station(uniq("T-K-P70-"), type_="KIOSK", process_code="P30")
    res = await client.post(
        f"{API}/wo/{wo['code']}/reprint", headers={"X-Station-Key": api_key}, json={}
    )
    assert res.status_code == 200, res.text


# ======================================================================
# WO 검색 (KSK-70)
# ======================================================================
async def test_wo_search_by_customer_so_item(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    _m, wo = await _issued_wo(client, admin_headers)
    # 1자 검색어는 빈 목록(서버 방어)
    res = await client.get(f"{API}/wo/search", headers=admin_headers, params={"q": "x"})
    assert res.status_code == 200 and res.json() == []
    res = await client.get(f"{API}/wo/search", headers=admin_headers, params={"q": wo["so_code"]})
    assert res.status_code == 200
    codes = {w["code"] for w in res.json()}
    assert wo["code"] in codes
    res = await client.get(
        f"{API}/wo/search", headers=admin_headers, params={"q": wo["customer_name"]}
    )
    assert wo["code"] in {w["code"] for w in res.json()}


# ======================================================================
# E6 취소 (admin #28, §5.6)
# ======================================================================
async def test_cancel_last_done_event_reverts_step_and_recalcs(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    wo, wo_code, event_uuid = await _wo_p30_done_with_defect(client, admin_headers)
    detail = (await client.get(f"{API}/wo/{wo_code}", headers=admin_headers)).json()
    assert detail["status"] == "IN_PROGRESS"
    p30 = next(s for s in detail["steps"] if s["process_code"] == "P30")
    assert p30["status"] == "DONE" and p30["qty_good"] == 480 and p30["qty_bad"] == 20

    res = await client.post(
        f"{API}/wo/{wo_code}/events/{event_uuid}/cancel",
        headers=admin_headers,
        json={"reason": "잘못된 스캔"},
    )
    assert res.status_code == 200, res.text
    after = res.json()
    p30_after = next(s for s in after["steps"] if s["process_code"] == "P30")
    assert p30_after["status"] == "WAITING"
    assert p30_after["qty_good"] is None and p30_after["qty_bad"] is None
    # P20 은 E1 승인으로 DONE_ESTIMATED 된 채 남는다(취소 대상이 아니다) — recalc_wo 는 그래서
    # IN_PROGRESS 를 유지한다(진행된 단계가 하나도 없어야 ISSUED).
    p20_after = next(s for s in after["steps"] if s["process_code"] == "P20")
    assert p20_after["status"] == "DONE_ESTIMATED"
    assert after["status"] == "IN_PROGRESS"

    # 원본 이벤트는 삭제되지 않는다 — 이벤트 목록에 그대로 남는다(append-only)
    events = (
        await client.get(f"{API}/wo/{wo_code}/events", headers=admin_headers)
    ).json()["items"]
    assert any(e["event_uuid"] == event_uuid for e in events)
    assert any(e["action"] == "CANCEL" for e in events)


async def test_cancel_last_done_event_without_approval_succeeds(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    """DEF-QA2-S4-001 회귀: 정상 RECEIVE→DONE(E1 승인을 거치지 않는, 절대다수의 실제 경로)에서
    ``approval_status`` 는 NULL 로 남는다. ``_last_reflected_event`` 가 ``approval_status !=
    "PENDING"`` 처럼 SQL 3치 논리에 취약한 비교를 쓰면 NULL 행이 WHERE 에서 전부 걸러져 이
    가장 흔한 경로의 취소가 "마지막 반영 이벤트만" 409 로 언제나 거부된다(승인을 거친 경우만
    ``_wo_p30_done_with_defect`` 처럼 approval_status='APPROVED' 가 돼 우연히 통과했었다 —
    기존 E6 테스트가 전부 그 헬퍼만 써서 이 결함을 못 잡았다). NULL-safe 비교(``is_distinct_from``)
    로 수정 후 이 테스트가 통과해야 한다.
    """
    station_id, api_key, eq_code = await _setup_p30_station_and_equipment(client, admin_headers)
    worker = await _worker_card()
    p20_station, p20_key = await ensure_station(uniq("T-K-P20-"), type_="KIOSK", process_code="P20")
    _m, wo = await _issued_wo(client, admin_headers)
    wo_code = wo["code"]

    recv_body = scan_body(
        station_id=p20_station,
        worker_card=worker,
        code=wo_code,
        action="RECEIVE",
        qty_good=500,
        extra={"inspection": "PASS"},
    )
    res0 = await client.post(f"{API}/scan", headers={"X-Station-Key": p20_key}, json=recv_body)
    assert res0.status_code == 200 and res0.json()["result"] == "OK", res0.text

    done_body = scan_body(
        station_id=station_id,
        worker_card=worker,
        code=wo_code,
        action="DONE",
        equipment_code=eq_code,
        qty_good=500,
        qty_bad=0,
    )
    res1 = await client.post(f"{API}/scan", headers={"X-Station-Key": api_key}, json=done_body)
    assert res1.status_code == 200 and res1.json()["result"] == "OK", res1.text
    event_uuid = res1.json()["event_uuid"]

    detail = (await client.get(f"{API}/wo/{wo_code}", headers=admin_headers)).json()
    p30 = next(s for s in detail["steps"] if s["process_code"] == "P30")
    assert p30["status"] == "DONE" and p30["qty_good"] == 500

    res = await client.post(
        f"{API}/wo/{wo_code}/events/{event_uuid}/cancel",
        headers=admin_headers,
        json={"reason": "잘못된 스캔 (승인 불필요 경로)"},
    )
    assert res.status_code == 200, res.text
    p30_after = next(s for s in res.json()["steps"] if s["process_code"] == "P30")
    assert p30_after["status"] == "WAITING"
    assert p30_after["qty_good"] is None and p30_after["qty_bad"] is None


async def test_cancel_non_last_event_is_409(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    """P30 을 두 번에 나눠 완료(PARTIAL → DONE)한 뒤, 첫 번째(이제는 "마지막"이 아닌) 이벤트를
    취소하려 하면 409 — B4-06 "해당 WO 의 마지막 반영 이벤트만"."""
    station_id, api_key, eq_code = await _setup_p30_station_and_equipment(client, admin_headers)
    worker = await _worker_card()
    _m, wo = await _issued_wo(client, admin_headers)
    wo_code = wo["code"]

    # 먼저 P20 입고를 완료해 둔다(E1 "직전 공정 미완료" 보류를 피한다 — 이 테스트의 관심사는
    # E1 이 아니라 "마지막 이벤트만 취소" 규칙이다).
    p20_station, p20_key = await ensure_station(uniq("T-K-P20-"), type_="KIOSK", process_code="P20")
    recv_body = scan_body(
        station_id=p20_station,
        worker_card=worker,
        code=wo_code,
        action="RECEIVE",
        qty_good=500,
        extra={"inspection": "PASS"},
    )
    res0 = await client.post(f"{API}/scan", headers={"X-Station-Key": p20_key}, json=recv_body)
    assert res0.status_code == 200 and res0.json()["result"] == "OK", res0.text

    # 1차: 200/500 — 허용오차 밖이라 사유가 있어야 PARTIAL(반영됨, 승인 불필요)로 처리된다
    body1 = scan_body(
        station_id=station_id,
        worker_card=worker,
        code=wo_code,
        action="DONE",
        equipment_code=eq_code,
        qty_good=200,
        qty_bad=0,
        extra={"variance_reason": "1차 부분 완료"},
    )
    res1 = await client.post(f"{API}/scan", headers={"X-Station-Key": api_key}, json=body1)
    assert res1.status_code == 200 and res1.json()["result"] == "WARN", res1.text
    first_event_uuid = res1.json()["event_uuid"]

    # 2차: 나머지 300 → 누계 500 = qty_in, 허용오차 안 → DONE(OK). PARTIAL 단계라 60초 중복
    # 규칙에서 제외된다(§13.5 ⑮) — 같은 단말로 바로 이어 보내도 된다.
    body2 = scan_body(
        station_id=station_id,
        worker_card=worker,
        code=wo_code,
        action="DONE",
        equipment_code=eq_code,
        qty_good=300,
        qty_bad=0,
    )
    res2 = await client.post(f"{API}/scan", headers={"X-Station-Key": api_key}, json=body2)
    assert res2.status_code == 200 and res2.json()["result"] == "OK", res2.text

    res = await client.post(
        f"{API}/wo/{wo_code}/events/{first_event_uuid}/cancel",
        headers=admin_headers,
        json={"reason": "잘못된 스캔"},
    )
    assert res.status_code == 409 and res.json()["code"] == "STATE_CONFLICT"


async def test_cancel_twice_is_409(client: AsyncClient, admin_headers: dict[str, str]) -> None:
    wo, wo_code, event_uuid = await _wo_p30_done_with_defect(client, admin_headers)
    res = await client.post(
        f"{API}/wo/{wo_code}/events/{event_uuid}/cancel",
        headers=admin_headers,
        json={"reason": "잘못된 스캔"},
    )
    assert res.status_code == 200, res.text
    res2 = await client.post(
        f"{API}/wo/{wo_code}/events/{event_uuid}/cancel",
        headers=admin_headers,
        json={"reason": "다시"},
    )
    assert res2.status_code == 409 and res2.json()["code"] == "STATE_CONFLICT"


async def test_cancel_requires_manager_or_admin_jwt(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    wo, wo_code, event_uuid = await _wo_p30_done_with_defect(client, admin_headers)
    worker_headers = await headers_for(client, uniq("u").lower(), "WORKER")
    res = await client.post(
        f"{API}/wo/{wo_code}/events/{event_uuid}/cancel",
        headers=worker_headers,
        json={"reason": "x"},
    )
    assert res.status_code == 403


async def test_cancel_unknown_event_is_404(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    import uuid as uuid_mod

    _wo, wo_code, _ev = await _wo_p30_done_with_defect(client, admin_headers)
    res = await client.post(
        f"{API}/wo/{wo_code}/events/{uuid_mod.uuid4()}/cancel",
        headers=admin_headers,
        json={"reason": "x"},
    )
    assert res.status_code == 404 and res.json()["code"] == "EVENT_NOT_FOUND"

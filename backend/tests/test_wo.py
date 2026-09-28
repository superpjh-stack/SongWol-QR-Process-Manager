"""S1-3 WO 제안·발행·조회·전이.

라우팅 없음 404 · PRINT_EMB → P30 1단계 · NONE → P30 생략 · 분리 draft · 미확정 409 · 채번·스냅샷·
qty_in·started_at · SO IN_PROGRESS·confirmed_at · 라벨 훅 · 목록 필터 · 상세 · 이벤트 ·
hold/resume/cancel/close 전이와 409 · recalc 순수 함수.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.order import WorkOrder, WoRouteStep
from app.domain.order import ports, recalc
from tests.conftest import ensure_item_group, headers_for, uniq
from tests.helpers_order import (
    API,
    confirm_design,
    issue_all,
    make_item,
    make_routing,
    make_so,
    setup_master,
    upload_design,
)


@pytest.mark.asyncio
async def test_propose_routing_missing_then_drafts(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    m = await setup_master(client, admin_headers, routings=())
    item = m["item"]
    so = await make_so(
        client,
        admin_headers,
        m,
        lines=[
            {"item_id": item["id"], "print_method": "SCREEN", "qty": 200},
            {"item_id": item["id"], "print_method": "PRINT_EMB", "qty": 100},
            {"item_id": item["id"], "print_method": "NONE", "qty": 50},
        ],
    )
    res = await client.post(f"{API}/so/{so['id']}/propose-wo", headers=admin_headers)
    assert res.status_code == 404 and res.json()["code"] == "ROUTING_NOT_FOUND", res.text
    detail = res.json()["detail"]
    assert {d["print_method"] for d in detail} == {"SCREEN", "PRINT_EMB", "NONE"}
    assert all(d["item_group"] == m["group"] and "so_line_id" in d for d in detail)

    for pm in ("SCREEN", "PRINT_EMB", "NONE"):
        await make_routing(client, admin_headers, m["group"], pm)
    res = await client.post(f"{API}/so/{so['id']}/propose-wo", headers=admin_headers)
    assert res.status_code == 200, res.text
    drafts = res.json()["items"]
    assert len(drafts) == 3
    by_pm = {d["print_method"]: d for d in drafts}
    # 인쇄+자수도 P30 한 단계 (spec §2.2 결정 · plan S1-3)
    assert [s["process_code"] for s in by_pm["PRINT_EMB"]["steps"]] == ["P20", "P30", "P50", "P60"]
    # 무가공은 P30 생략 (spec §4.2)
    assert [s["process_code"] for s in by_pm["NONE"]["steps"]] == ["P20", "P50", "P60"]
    # tolerance: routing_step 값(P30 2.5) 또는 item 값(3.0)
    p30 = next(s for s in by_pm["SCREEN"]["steps"] if s["process_code"] == "P30")
    p20 = next(s for s in by_pm["SCREEN"]["steps"] if s["process_code"] == "P20")
    assert p30["tolerance_pct"] == 2.5 and p20["tolerance_pct"] == 3.0
    assert by_pm["SCREEN"]["qty"] == 200 and by_pm["SCREEN"]["routing_id"] > 0
    # 저장 없음
    assert (await client.get(f"{API}/so/{so['id']}", headers=admin_headers)).json()["wo_count"] == 0


@pytest.mark.asyncio
async def test_issue_wo_snapshot_and_rules(
    client: AsyncClient, admin_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    m = await setup_master(client, admin_headers, routings=("SCREEN", "NONE"))
    item = m["item"]
    so = await make_so(
        client,
        admin_headers,
        m,
        lines=[
            {"item_id": item["id"], "print_method": "SCREEN", "qty": 500},
            {"item_id": item["id"], "print_method": "NONE", "qty": 80},
        ],
    )
    l_screen, l_none = so["lines"]
    res = await client.post(f"{API}/so/{so['id']}/propose-wo", headers=admin_headers)
    drafts = res.json()["items"]

    # 시안 미확정 → 409 DESIGN_NOT_CONFIRMED (NONE 라인은 면제라 detail 에 없음)
    res = await client.post(
        f"{API}/so/{so['id']}/issue-wo", headers=admin_headers, json={"drafts": drafts}
    )
    assert res.status_code == 409 and res.json()["code"] == "DESIGN_NOT_CONFIRMED", res.text
    assert [d["line_id"] for d in res.json()["detail"]] == [l_screen["id"]]
    assert (await client.get(f"{API}/so/{so['id']}", headers=admin_headers)).json()["wo_count"] == 0

    assert (await upload_design(client, admin_headers, so["id"], l_screen["id"])).status_code == 201
    assert (
        await confirm_design(client, admin_headers, so["id"], l_screen["id"])
    ).status_code == 200

    # 분리: SCREEN 500 → 300 + 200. 합이 다르면 422
    d_screen = next(d for d in drafts if d["so_line_id"] == l_screen["id"])
    d_none = next(d for d in drafts if d["so_line_id"] == l_none["id"])
    bad = [{**d_screen, "qty": 300}, {**d_screen, "qty": 150}, d_none]
    res = await client.post(
        f"{API}/so/{so['id']}/issue-wo", headers=admin_headers, json={"drafts": bad}
    )
    assert res.status_code == 422 and res.json()["code"] == "VALIDATION_ERROR"
    # 단계 조작(P30 제거) → 422
    tampered = [
        {**d_screen, "steps": [s for s in d_screen["steps"] if s["process_code"] != "P30"]},
        d_none,
    ]
    res = await client.post(
        f"{API}/so/{so['id']}/issue-wo", headers=admin_headers, json={"drafts": tampered}
    )
    assert res.status_code == 422
    # 다른 라우팅 id → 422 · 다른 라인 id → 422
    res = await client.post(
        f"{API}/so/{so['id']}/issue-wo",
        headers=admin_headers,
        json={"drafts": [{**d_screen, "routing_id": 999999}, d_none]},
    )
    assert res.status_code == 422
    res = await client.post(
        f"{API}/so/{so['id']}/issue-wo",
        headers=admin_headers,
        json={"drafts": [{**d_screen, "so_line_id": 999999}]},
    )
    assert res.status_code == 422

    # 라벨 훅: 개발B 연결 전 no-op. 여기서는 호출 여부만 기록
    called: list[str] = []

    async def fake_issuer(session: AsyncSession, wo: WorkOrder, issued_by: int | None) -> None:
        called.append(wo.code)

    saved = ports._label_issuer
    ports.set_label_issuer(fake_issuer)
    try:
        good = [{**d_screen, "qty": 300}, {**d_screen, "qty": 200}, d_none]
        res = await client.post(
            f"{API}/so/{so['id']}/issue-wo", headers=admin_headers, json={"drafts": good}
        )
        assert res.status_code == 200, res.text
    finally:
        ports.set_label_issuer(saved)
    body = res.json()
    wos = body["work_orders"]
    assert len(wos) == 3 and body["pdf_url"] == f"/api/v1/labels/so/{so['code']}.pdf"
    assert sorted(called) == sorted(w["code"] for w in wos)
    today = datetime.now(UTC).astimezone(recalc.TZ_SEOUL).strftime("%y%m%d")
    for w in wos:
        assert w["code"].startswith(f"WO-{today}-") and w["split_suffix"] is None
        assert w["status"] == "ISSUED" and w["issued_at"] is not None
        assert w["so_code"] == so["code"] and w["customer_name"] == m["customer"]["name"]
        assert w["current_step_seq"] == 1 and w["current_process_code"] == "P20"
        assert w["steps"][0]["qty_in"] == w["qty_ordered"]  # shopfloor ⑧
        assert w["steps"][0]["started_at"] == w["issued_at"]  # D6-12
        assert all(s["qty_in"] is None for s in w["steps"][1:])
        assert all(s["status"] == "WAITING" for s in w["steps"])
        assert w["receipt_status"] == "NONE" and w["delay_risk"] is False
    screen_wos = [w for w in wos if w["print_method"] == "SCREEN"]
    none_wo = next(w for w in wos if w["print_method"] == "NONE")
    assert sorted(w["qty_ordered"] for w in screen_wos) == [200, 300]
    assert all(w["design_version"] == 1 and w["design_thumbnail_url"] for w in screen_wos)
    assert none_wo["design_version"] is None and none_wo["qty_ordered"] == 80
    assert [s["process_code"] for s in none_wo["steps"]] == ["P20", "P50", "P60"]
    p30 = next(s for s in screen_wos[0]["steps"] if s["process_code"] == "P30")
    assert (
        p30["tolerance_pct"] == 2.5
        and p30["std_lead_hours"] == 24
        and p30["process_name"] == "인쇄"
    )
    assert len({w["code"] for w in wos}) == 3

    # SO: IN_PROGRESS · confirmed_at · wo_count · 진행률 0
    d = (await client.get(f"{API}/so/{so['code']}", headers=admin_headers)).json()
    assert d["status"] == "IN_PROGRESS" and d["confirmed_at"] is not None
    assert d["wo_count"] == 3 and d["progress_pct"] == 0 and d["current_processes"] == ["P20"]
    assert d["est_complete_at"] is not None
    assert len(d["work_orders"]) == 3
    confirmed_at = d["confirmed_at"]

    # 이미 발행된 라인 재발행 → 409 WO_ALREADY_ISSUED · 재제안은 빈 목록
    res = await client.post(
        f"{API}/so/{so['id']}/issue-wo", headers=admin_headers, json={"drafts": [d_none]}
    )
    assert res.status_code == 409 and res.json()["code"] == "WO_ALREADY_ISSUED"
    res = await client.post(f"{API}/so/{so['id']}/propose-wo", headers=admin_headers)
    assert res.status_code == 200 and res.json()["items"] == []

    # 라인 추가 후 재제안·발행 → 추가 라인만, confirmed_at 유지 (admin #26)
    lines_now = d["lines"]
    res = await client.patch(
        f"{API}/so/{so['id']}",
        headers=admin_headers,
        json={
            "lines": [
                *[
                    {
                        "id": ln["id"],
                        "item_id": item["id"],
                        "print_method": ln["print_method"],
                        "qty": ln["qty"],
                    }
                    for ln in lines_now
                ],
                {"item_id": item["id"], "print_method": "NONE", "qty": 10},
            ]
        },
    )
    assert res.status_code == 200, res.text
    res = await client.post(f"{API}/so/{so['id']}/propose-wo", headers=admin_headers)
    assert len(res.json()["items"]) == 1 and res.json()["items"][0]["qty"] == 10
    issued2 = await issue_all(client, admin_headers, so["id"])
    assert len(issued2["work_orders"]) == 1
    d = (await client.get(f"{API}/so/{so['id']}", headers=admin_headers)).json()
    assert d["wo_count"] == 4 and d["confirmed_at"] == confirmed_at

    # WORKER 는 발행 불가
    worker = await headers_for(client, "t_worker_wo", "WORKER")
    res = await client.post(f"{API}/so/{so['id']}/propose-wo", headers=worker)
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_wo_list_detail_events_and_transitions(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    m = await setup_master(client, admin_headers, routings=("SCREEN",))
    so = await make_so(client, admin_headers, m)
    line = so["lines"][0]
    assert (await upload_design(client, admin_headers, so["id"], line["id"])).status_code == 201
    assert (await confirm_design(client, admin_headers, so["id"], line["id"])).status_code == 200
    wo = (await issue_all(client, admin_headers, so["id"]))["work_orders"][0]

    # 목록: so_code · status · process_code · q · 정렬
    res = await client.get(f"{API}/wo", headers=admin_headers, params={"so_code": so["code"]})
    assert res.status_code == 200 and res.json()["total"] == 1
    row = res.json()["items"][0]
    assert row["code"] == wo["code"] and row["item"]["name"] == m["item"]["name"]
    assert row["current_process_code"] == "P20" and row["due_date"] == "2026-10-10"
    res = await client.get(
        f"{API}/wo", headers=admin_headers, params={"so_code": so["code"], "process_code": "p30"}
    )
    assert res.json()["total"] == 0
    res = await client.get(
        f"{API}/wo", headers=admin_headers, params={"so_code": so["code"], "process_code": "P20"}
    )
    assert res.json()["total"] == 1
    res = await client.get(
        f"{API}/wo", headers=admin_headers, params={"so_code": so["code"], "status": "issued"}
    )
    assert res.json()["total"] == 1
    res = await client.get(f"{API}/wo", headers=admin_headers, params={"q": m["customer"]["name"]})
    assert res.json()["total"] == 1
    res = await client.get(f"{API}/wo", headers=admin_headers, params={"sort": "qty_ordered"})
    assert res.status_code == 422 and res.json()["code"] == "BAD_SORT"
    res = await client.get(f"{API}/wo", headers=admin_headers, params={"sort": "-issued_at,code"})
    assert res.status_code == 200
    res = await client.get(
        f"{API}/wo", headers=admin_headers, params={"so_code": so["code"], "delay": "true"}
    )
    assert res.json()["total"] == 0

    # 상세 (id · 코드) — 단계 · works · 이벤트 · boxes · receipts · children
    for key in (wo["id"], wo["code"], wo["code"].lower()):
        res = await client.get(f"{API}/wo/{key}", headers=admin_headers)
        assert res.status_code == 200, res.text
    d = res.json()
    assert [s["process_code"] for s in d["steps"]] == ["P20", "P30", "P50", "P60"]
    assert d["steps"][0]["works"] == [] and d["steps"][0]["equipment"] is None
    assert d["recent_events"] == [] and d["boxes"] == [] and d["receipts"] == []
    assert d["children"] == [] and d["hold_reason"] is None and d["closed_at"] is None
    assert d["parent_wo_code"] is None
    res = await client.get(f"{API}/wo/WO-000101-0001", headers=admin_headers)
    assert res.status_code == 404 and res.json()["code"] == "WO_NOT_FOUND"
    res = await client.get(f"{API}/wo/{wo['id']}/events", headers=admin_headers)
    assert res.status_code == 200 and res.json()["total"] == 0 and res.json()["items"] == []

    # 전이: close(ISSUED) 409 · resume(ISSUED) 409 · hold → ON_HOLD · hold 409 · resume → ISSUED
    res = await client.post(f"{API}/wo/{wo['id']}/close", headers=admin_headers)
    assert res.status_code == 409 and res.json()["code"] == "STATE_CONFLICT"
    res = await client.post(f"{API}/wo/{wo['id']}/resume", headers=admin_headers)
    assert res.status_code == 409
    res = await client.post(f"{API}/wo/{wo['id']}/hold", headers=admin_headers, json={"reason": ""})
    assert res.status_code == 422
    res = await client.post(
        f"{API}/wo/{wo['code']}/hold", headers=admin_headers, json={"reason": "도안 재확인"}
    )
    assert res.status_code == 200 and res.json()["status"] == "ON_HOLD"
    assert res.json()["hold_reason"] == "도안 재확인"
    res = await client.post(
        f"{API}/wo/{wo['id']}/hold", headers=admin_headers, json={"reason": "x"}
    )
    assert res.status_code == 409
    # SO 상태는 IN_PROGRESS 유지, 진행률 0
    d = (await client.get(f"{API}/so/{so['id']}", headers=admin_headers)).json()
    assert d["status"] == "IN_PROGRESS" and d["work_orders"][0]["status"] == "ON_HOLD"
    res = await client.post(f"{API}/wo/{wo['id']}/resume", headers=admin_headers)
    assert res.status_code == 200 and res.json()["status"] == "ISSUED"
    assert res.json()["hold_reason"] is None
    # 권한: SALES 는 hold 불가, MANAGER 가능
    sales = await headers_for(client, "t_sales_wo", "SALES")
    res = await client.post(f"{API}/wo/{wo['id']}/hold", headers=sales, json={"reason": "x"})
    assert res.status_code == 403
    manager = await headers_for(client, "t_manager_wo", "MANAGER")
    # cancel → CANCELLED · SO 는 OPEN 으로 (비취소 WO 없음) · 이후 전이 전부 409
    res = await client.post(
        f"{API}/wo/{wo['id']}/cancel", headers=manager, json={"reason": "불량 원단"}
    )
    assert res.status_code == 200 and res.json()["status"] == "CANCELLED"
    d = (await client.get(f"{API}/so/{so['id']}", headers=admin_headers)).json()
    assert d["status"] == "OPEN" and d["wo_count"] == 1 and d["progress_pct"] == 0
    for action in ("hold", "cancel"):
        res = await client.post(
            f"{API}/wo/{wo['id']}/{action}", headers=admin_headers, json={"reason": "x"}
        )
        assert res.status_code == 409, action
    for action in ("resume", "close"):
        res = await client.post(f"{API}/wo/{wo['id']}/{action}", headers=admin_headers)
        assert res.status_code == 409, action
    # 취소된 라인은 다시 제안·발행 가능 (비취소 WO 없음)
    res = await client.post(f"{API}/so/{so['id']}/propose-wo", headers=admin_headers)
    assert res.status_code == 200 and len(res.json()["items"]) == 1


def _step(seq: int, code: str, status: str, hours: float = 8, **kw: object) -> WoRouteStep:
    return WoRouteStep(
        seq=seq,
        process_code=code,
        status=status,
        std_lead_hours=Decimal(hours),
        tolerance_pct=Decimal(3),
        **kw,
    )


def test_recalc_wo_and_so_pure() -> None:
    """§6.1 표 · §8 progress_pct · §6.5 지연 판정 — DB 없이."""

    now = datetime(2026, 10, 5, 9, 0, tzinfo=UTC)
    wo = WorkOrder(status="ISSUED", issued_at=now - timedelta(hours=1), qty_good=0, qty_bad=0)
    steps = [
        _step(1, "P20", "WAITING"),
        _step(2, "P30", "WAITING", 24),
        _step(3, "P50", "WAITING"),
        _step(4, "P60", "WAITING", 4),
    ]
    recalc.recalc_wo(wo, steps)
    assert wo.status == "ISSUED" and wo.current_step_seq == 1
    steps[0].status = "DONE"
    steps[0].done_at = now
    recalc.recalc_wo(wo, steps)
    assert wo.status == "IN_PROGRESS" and wo.current_step_seq == 2
    steps[1].status = "PARTIAL"
    steps[1].qty_good, steps[1].qty_bad = 400, 5
    recalc.recalc_wo(wo, steps)
    assert wo.status == "IN_PROGRESS" and wo.current_step_seq == 2 and wo.qty_good == 400
    steps[1].status = "DONE"
    steps[2].status = "DONE"
    recalc.recalc_wo(wo, steps)
    assert wo.status == "PACKED" and wo.current_step_seq == 4
    steps[3].status = "DONE_ESTIMATED"
    recalc.recalc_wo(wo, steps)
    assert wo.status == "SHIPPED" and wo.current_step_seq == 4  # 마지막 seq
    # 명시 상태 유지
    wo.status = "ON_HOLD"
    recalc.recalc_wo(wo, steps)
    assert wo.status == "ON_HOLD"
    wo.status = "CANCELLED"
    recalc.recalc_wo(wo, steps)
    assert wo.status == "CANCELLED"
    # 미발행 → DRAFT
    draft = WorkOrder(status="ISSUED", issued_at=None)
    recalc.recalc_wo(draft, steps)
    assert draft.status == "DRAFT"

    # progress: (4 완료) / (4 + 4) — CANCELLED WO 제외
    other = WorkOrder(status="ISSUED", issued_at=now)
    other_steps = [
        _step(1, "P20", "WAITING"),
        _step(2, "P30", "WAITING"),
        _step(3, "P50", "WAITING"),
        _step(4, "P60", "WAITING"),
    ]
    cancelled = WorkOrder(status="CANCELLED", issued_at=now)
    wo.status = "SHIPPED"
    pct = recalc.so_progress_pct([(wo, steps), (other, other_steps), (cancelled, other_steps)])
    assert pct == Decimal("50.00")
    assert recalc.so_status_from_wos("IN_PROGRESS", [wo, other, cancelled]) == "PARTIAL_SHIPPED"
    assert recalc.so_status_from_wos("IN_PROGRESS", [wo, cancelled]) == "SHIPPED"
    assert recalc.so_status_from_wos("IN_PROGRESS", [cancelled]) == "OPEN"
    assert recalc.so_status_from_wos("CANCELLED", [other]) == "CANCELLED"
    assert recalc.so_status_from_wos("IN_PROGRESS", [other]) == "IN_PROGRESS"

    # 지연 (a): 현재 단계 대기 9h > 8h
    late = WorkOrder(status="ISSUED", issued_at=now - timedelta(hours=9))
    waiting = [_step(1, "P20", "WAITING"), _step(2, "P30", "WAITING", 24)]
    assert recalc.wo_delay_risk(late, waiting, date(2026, 12, 31), now) is True
    ok = WorkOrder(status="ISSUED", issued_at=now - timedelta(hours=1))
    assert recalc.wo_delay_risk(ok, waiting, date(2026, 12, 31), now) is False
    # 지연 (b): 잔여 32h > 납기(오늘 18:00 KST = 09:00 UTC)까지 0h
    assert recalc.wo_delay_risk(ok, waiting, date(2026, 10, 5), now) is True
    # 비활성 상태는 False
    held = WorkOrder(status="ON_HOLD", issued_at=now - timedelta(hours=99))
    assert recalc.wo_delay_risk(held, waiting, date(2026, 10, 5), now) is False
    # est_complete_at = now + 32h
    est = recalc.est_complete_at([(ok, waiting), (held, waiting)], now)
    assert est == now + timedelta(hours=32)
    assert recalc.est_complete_at([(held, waiting)], now) is None


@pytest.mark.asyncio
async def test_issue_wo_requires_active_so_and_lines(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    """빈 drafts 422 · 라우팅 tolerance 없는 단계는 item 값 · 다른 품목군 품목은 별 라우팅."""
    group2 = await ensure_item_group(uniq("TG"), "다른 품목군")
    m = await setup_master(client, admin_headers, routings=("NONE",))
    item2 = await make_item(client, admin_headers, group2, tolerance=5.0)
    await make_routing(client, admin_headers, group2, "NONE")
    so = await make_so(
        client,
        admin_headers,
        m,
        lines=[{"item_id": item2["id"], "print_method": "NONE", "qty": 30}],
    )
    res = await client.post(
        f"{API}/so/{so['id']}/issue-wo", headers=admin_headers, json={"drafts": []}
    )
    assert res.status_code == 422
    issued = await issue_all(client, admin_headers, so["id"])
    w = issued["work_orders"][0]
    assert w["item"]["id"] == item2["id"] and w["steps"][0]["tolerance_pct"] == 5.0
    assert [s["process_code"] for s in w["steps"]] == ["P20", "P50", "P60"]


# ======================================================================
# S1 QA 수정 웨이브 (DEF-QA2-S1-001 · 004 · 005, DEF-QA1-S1-002 · 005, F33, D46)
# ======================================================================
@pytest.mark.asyncio
async def test_issue_wo_concurrent_is_serialized(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    """D43: 같은 SO 동시 issue-wo 3건 → 200 1건 · 409 WO_ALREADY_ISSUED 2건, 라인당 WO 1건."""
    import asyncio

    m = await setup_master(client, admin_headers, routings=("NONE",))
    so = await make_so(
        client,
        admin_headers,
        m,
        lines=[{"item_id": m["item"]["id"], "print_method": "NONE", "qty": 90}],
    )
    drafts = (await client.post(f"{API}/so/{so['id']}/propose-wo", headers=admin_headers)).json()[
        "items"
    ]
    results = await asyncio.gather(
        *[
            client.post(
                f"{API}/so/{so['id']}/issue-wo", headers=admin_headers, json={"drafts": drafts}
            )
            for _ in range(3)
        ]
    )
    codes = sorted(r.status_code for r in results)
    assert codes == [200, 409, 409], [(r.status_code, r.text[:80]) for r in results]
    assert all(r.json()["code"] == "WO_ALREADY_ISSUED" for r in results if r.status_code == 409)
    res = await client.get(f"{API}/wo", headers=admin_headers, params={"so_code": so["code"]})
    assert res.json()["total"] == 1
    assert (await client.get(f"{API}/so/{so['id']}", headers=admin_headers)).json()["wo_count"] == 1


@pytest.mark.asyncio
async def test_wo_audit_cancel_reason_and_issued_by(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    """work_order 감사(발행 INSERT · hold/cancel UPDATE, user_id) · cancel_reason 이 hold_reason 을
    덮지 않음(F33) · 라벨 훅에 issued_by 전달(DEF-QA1-S1-002) · D46 confirmed_at 유지."""
    from sqlalchemy import select

    from app.db.models.ops import AuditLog
    from app.db.models.order import WorkOrder as WorkOrderRow
    from app.db.session import SessionLocal

    m = await setup_master(client, admin_headers, routings=("NONE",))
    so = await make_so(
        client,
        admin_headers,
        m,
        lines=[{"item_id": m["item"]["id"], "print_method": "NONE", "qty": 70}],
    )
    seen: list[tuple[str, int | None]] = []

    async def capture(session: AsyncSession, wo: WorkOrder, issued_by: int | None) -> None:
        seen.append((wo.code, issued_by))

    saved = ports._label_issuer
    ports.set_label_issuer(capture)
    try:
        wo = (await issue_all(client, admin_headers, so["id"]))["work_orders"][0]
    finally:
        ports.set_label_issuer(saved)
    me = (await client.get(f"{API}/auth/me", headers=admin_headers)).json()
    assert seen == [(wo["code"], me["id"])]
    confirmed_at = (await client.get(f"{API}/so/{so['id']}", headers=admin_headers)).json()[
        "confirmed_at"
    ]
    assert confirmed_at is not None

    res = await client.post(
        f"{API}/wo/{wo['id']}/hold", headers=admin_headers, json={"reason": "자재 대기"}
    )
    assert res.status_code == 200
    res = await client.post(
        f"{API}/wo/{wo['id']}/cancel", headers=admin_headers, json={"reason": "고객 취소"}
    )
    assert res.status_code == 200 and res.json()["status"] == "CANCELLED"
    assert res.json()["hold_reason"] == "자재 대기"  # 보류 이력 유지
    async with SessionLocal() as s:
        row = await s.get(WorkOrderRow, wo["id"])
        assert row is not None
        assert row.cancel_reason == "고객 취소" and row.hold_reason == "자재 대기"
        assert row.cancelled_at is not None and row.cancelled_by == me["id"]
        logs = (
            (
                await s.execute(
                    select(AuditLog)
                    .where(AuditLog.table_name == "work_order", AuditLog.row_id == wo["id"])
                    .order_by(AuditLog.id)
                )
            )
            .scalars()
            .all()
        )
    actions = [(lg.action, (lg.after or {}).get("status")) for lg in logs]
    assert actions[0] == ("INSERT", "ISSUED")
    assert ("UPDATE", "ON_HOLD") in actions and ("UPDATE", "CANCELLED") in actions
    assert all(lg.user_id == me["id"] and lg.request_id for lg in logs)
    cancel_log = next(lg for lg in logs if (lg.after or {}).get("status") == "CANCELLED")
    assert cancel_log.before is not None and cancel_log.before["status"] == "ON_HOLD"
    assert cancel_log.after is not None and cancel_log.after["cancel_reason"] == "고객 취소"
    # D46: 전 WO 취소 후에도 confirmed_at 유지, 상태는 OPEN
    d = (await client.get(f"{API}/so/{so['id']}", headers=admin_headers)).json()
    assert d["status"] == "OPEN" and d["confirmed_at"] == confirmed_at


@pytest.mark.asyncio
async def test_unhandled_exception_is_contract_500(admin_headers: dict[str, str]) -> None:
    """D52: 라벨 훅 예외 → 500 INTERNAL_ERROR 계약 형식 + X-Request-Id, 발행은 롤백."""
    from httpx import ASGITransport

    from app.main import app

    async def boom(session: AsyncSession, wo: WorkOrder, issued_by: int | None) -> None:
        raise RuntimeError("printer driver exploded")

    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test"
    ) as c:
        m = await setup_master(c, admin_headers, routings=("NONE",))
        so = await make_so(
            c,
            admin_headers,
            m,
            lines=[{"item_id": m["item"]["id"], "print_method": "NONE", "qty": 5}],
        )
        drafts = (await c.post(f"{API}/so/{so['id']}/propose-wo", headers=admin_headers)).json()[
            "items"
        ]
        saved = ports._label_issuer
        ports.set_label_issuer(boom)
        try:
            res = await c.post(
                f"{API}/so/{so['id']}/issue-wo",
                headers={**admin_headers, "X-Request-Id": "qa-500-trace"},
                json={"drafts": drafts},
            )
        finally:
            ports.set_label_issuer(saved)
        assert res.status_code == 500, res.text
        assert res.json() == {"code": "INTERNAL_ERROR", "message": "서버 오류", "detail": []}
        assert res.headers.get("x-request-id") == "qa-500-trace"
        d = (await c.get(f"{API}/so/{so['id']}", headers=admin_headers)).json()
        assert d["wo_count"] == 0 and d["status"] == "OPEN" and d["confirmed_at"] is None


@pytest.mark.asyncio
async def test_wo_split_jwt_and_station(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    """B4-04 · §13.4 shopfloor ⑱ [S3]: 하위 WO 분할 — JWT(ADMIN/MANAGER) 와
    STATION(approver_card+pin) 둘 다 허용한다."""
    from tests.conftest import ensure_station, ensure_user

    m = await setup_master(client, admin_headers, routings=("SCREEN",))
    so = await make_so(
        client,
        admin_headers,
        m,
        lines=[
            {"item_id": m["item"]["id"], "print_method": "SCREEN", "qty": 500, "unit_price": 1000}
        ],
    )
    line = so["lines"][0]
    await upload_design(client, admin_headers, so["id"], line["id"])
    await confirm_design(client, admin_headers, so["id"], line["id"])
    wo = (await issue_all(client, admin_headers, so["id"]))["work_orders"][0]

    # 권한: SALES 는 분할 불가
    sales = await headers_for(client, uniq("sales_split").lower(), "SALES")
    res = await client.post(
        f"{API}/wo/{wo['id']}/split", headers=sales, json={"qty": 100, "reason": "부족"}
    )
    assert res.status_code == 403

    # qty >= qty_ordered → 422
    res = await client.post(
        f"{API}/wo/{wo['id']}/split", headers=admin_headers, json={"qty": 500, "reason": "부족"}
    )
    assert res.status_code == 422

    # JWT(MANAGER) 분할 성공: 하위 WO `-A`, 라우팅 복사, parent.qty_ordered 감소
    manager = await headers_for(client, uniq("mgr_split").lower(), "MANAGER")
    res = await client.post(
        f"{API}/wo/{wo['id']}/split",
        headers=manager,
        json={"qty": 120, "reason": "부족분 선처리"},
    )
    assert res.status_code == 200, res.text
    data = res.json()
    parent, child = data["parent"], data["child"]
    assert parent["code"] == wo["code"] and parent["qty_ordered"] == 380
    assert child["code"] == f"{wo['code']}-A" and child["qty_ordered"] == 120
    assert child["split_suffix"] == "A" and child["parent_wo_code"] == wo["code"]
    assert child["status"] == "ISSUED"
    assert [s["process_code"] for s in child["steps"]] == ["P20", "P30", "P50", "P60"]
    assert child["steps"][0]["qty_in"] == 120

    # WO 상세에 children 반영
    detail = (await client.get(f"{API}/wo/{wo['id']}", headers=admin_headers)).json()
    assert [c["code"] for c in detail["children"]] == [child["code"]]

    # STATION 경로: approver_card+pin 필요, MANAGER/ADMIN 만
    station_id, api_key = await ensure_station(uniq("T-SPLIT-"), type_="KIOSK", process_code="P20")
    res = await client.post(
        f"{API}/wo/{wo['id']}/split",
        headers={"X-Station-Key": api_key},
        json={"qty": 50, "reason": "추가 분할"},
    )
    assert res.status_code == 422

    worker = await ensure_user(uniq("w_split").lower(), "WORKER", pin="1234", card=True)
    res = await client.post(
        f"{API}/wo/{wo['id']}/split",
        headers={"X-Station-Key": api_key},
        json={
            "qty": 50,
            "reason": "추가 분할",
            "approver_card": worker.card_code,
            "pin": "1234",
        },
    )
    assert res.status_code == 403 and res.json()["code"] == "APPROVER_ROLE"

    approver = await ensure_user(uniq("mgr_card").lower(), "MANAGER", pin="5678", card=True)
    res = await client.post(
        f"{API}/wo/{wo['id']}/split",
        headers={"X-Station-Key": api_key},
        json={
            "qty": 50,
            "reason": "추가 분할",
            "approver_card": approver.card_code,
            "pin": "5678",
        },
    )
    assert res.status_code == 200, res.text
    data2 = res.json()
    assert data2["child"]["split_suffix"] == "B"
    assert data2["parent"]["qty_ordered"] == 330

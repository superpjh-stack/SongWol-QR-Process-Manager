"""S1-1/S1-2/S1-7 수주·도안: 등록·조회·필터·정렬 · 배송지 스냅샷 · 권한 · 도안 v1→v2·확정·형식·크기
· 변경(미착수 반영 / 착수 409) · 취소 응답 · 감사 로그."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.config import get_settings
from tests.conftest import ensure_station, headers_for, uniq
from tests.helpers_order import (
    API,
    confirm_design,
    issue_all,
    make_so,
    setup_master,
    upload_design,
)


@pytest.mark.asyncio
async def test_so_create_get_list_filters(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    m = await setup_master(client, admin_headers)
    so = await make_so(client, admin_headers, m)
    assert so["code"].startswith("SO-") and so["status"] == "OPEN"
    assert so["ship_to"]["address1"] == "부산 사상구 1" and so["ship_to"]["receiver"] == "수령인"
    assert so["line_count"] == 1 and so["wo_count"] == 0 and so["progress_pct"] == 0
    assert so["lines"][0]["line_no"] == 1 and so["lines"][0]["item"]["spec"] == "40×80"
    assert so["lines"][0]["design"] is None and so["lines"][0]["design_confirmed"] is False
    assert so["lines"][0]["unit_price"] == 1200 and so["created_by"]["login_id"] == "t_admin"
    assert so["confirmed_at"] is None

    # ship_to 직접 입력
    so2 = await make_so(
        client,
        admin_headers,
        m,
        address_id=None,
        ship_to={
            "address1": "서울 강남구 2",
            "receiver": None,
            "phone": None,
            "postal_code": None,
            "address2": None,
        },
        due_date="2026-10-05",
    )
    assert so2["ship_to"]["address1"] == "서울 강남구 2"
    # 둘 다 없으면 422
    res = await client.post(
        f"{API}/so",
        headers=admin_headers,
        json={
            "customer_id": m["customer"]["id"],
            "order_date": "2026-10-01",
            "due_date": "2026-10-10",
            "lines": [{"item_id": m["item"]["id"], "print_method": "SCREEN", "qty": 1}],
        },
    )
    assert res.status_code == 422 and res.json()["code"] == "VALIDATION_ERROR"
    # 없는 품목 404 · 없는 가공방식 404 · qty 0 → 422
    res = await client.post(
        f"{API}/so",
        headers=admin_headers,
        json={
            "customer_id": m["customer"]["id"],
            "order_date": "2026-10-01",
            "due_date": "2026-10-10",
            "address_id": m["customer"]["address"]["id"],
            "lines": [{"item_id": 999999999, "print_method": "SCREEN", "qty": 1}],
        },
    )
    assert res.status_code == 404 and res.json()["code"] == "ITEM_NOT_FOUND"
    res = await client.post(
        f"{API}/so",
        headers=admin_headers,
        json={
            "customer_id": m["customer"]["id"],
            "order_date": "2026-10-01",
            "due_date": "2026-10-10",
            "address_id": m["customer"]["address"]["id"],
            "lines": [{"item_id": m["item"]["id"], "print_method": "laser", "qty": 1}],
        },
    )
    assert res.status_code == 404 and res.json()["code"] == "PRINT_METHOD_NOT_FOUND"
    res = await client.post(
        f"{API}/so",
        headers=admin_headers,
        json={
            "customer_id": m["customer"]["id"],
            "order_date": "2026-10-01",
            "due_date": "2026-10-10",
            "address_id": m["customer"]["address"]["id"],
            "lines": [{"item_id": m["item"]["id"], "print_method": "SCREEN", "qty": 0}],
        },
    )
    assert res.status_code == 422

    # 상세: id · 코드(소문자도) 둘 다
    for key in (so["id"], so["code"], so["code"].lower()):
        res = await client.get(f"{API}/so/{key}", headers=admin_headers)
        assert res.status_code == 200, res.text
        assert res.json()["code"] == so["code"]
    d = res.json()
    assert d["work_orders"] == [] and d["current_processes"] == [] and d["est_complete_at"] is None
    assert d["delay_risk"] is False
    res = await client.get(f"{API}/so/SO-000101-9999", headers=admin_headers)
    assert res.status_code == 404 and res.json()["code"] == "SO_NOT_FOUND"

    # 목록: customer_id · 정렬 기본 due_date 오름차순 · sort=-code · BAD_SORT · q · status · 기간
    cid = m["customer"]["id"]
    res = await client.get(f"{API}/so", headers=admin_headers, params={"customer_id": cid})
    page = res.json()
    assert page["total"] == 2 and [s["code"] for s in page["items"]] == [so2["code"], so["code"]]
    res = await client.get(
        f"{API}/so", headers=admin_headers, params={"customer_id": cid, "sort": "-code"}
    )
    assert [s["code"] for s in res.json()["items"]] == [so2["code"], so["code"]]
    res = await client.get(f"{API}/so", headers=admin_headers, params={"sort": "memo"})
    assert res.status_code == 422 and res.json()["code"] == "BAD_SORT"
    res = await client.get(f"{API}/so", headers=admin_headers, params={"q": m["customer"]["name"]})
    assert res.json()["total"] == 2
    res = await client.get(
        f"{API}/so", headers=admin_headers, params={"customer_id": cid, "status": "cancelled"}
    )
    assert res.json()["total"] == 0
    res = await client.get(
        f"{API}/so",
        headers=admin_headers,
        params={"customer_id": cid, "from": "2026-10-02", "to": "2026-10-31"},
    )
    assert res.json()["total"] == 0
    res = await client.get(
        f"{API}/so", headers=admin_headers, params={"customer_id": cid, "delay": "true"}
    )
    assert res.json()["total"] == 0

    # 권한: VIEWER R 가능 · W 불가, STATION R 가능
    viewer = await headers_for(client, "t_viewer_so", "VIEWER")
    res = await client.get(f"{API}/so/{so['id']}", headers=viewer)
    assert res.status_code == 200
    res = await client.post(f"{API}/so", headers=viewer, json={})
    assert res.status_code == 403
    _, key = await ensure_station("T-K-SO-1")
    res = await client.get(f"{API}/so/{so['id']}", headers={"X-Station-Key": key})
    assert res.status_code == 200
    res = await client.get(f"{API}/so/{so['id']}")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_design_upload_versions_confirm_and_limits(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    m = await setup_master(client, admin_headers)
    so = await make_so(client, admin_headers, m)
    line_id = so["lines"][0]["id"]

    res = await upload_design(client, admin_headers, so["id"], line_id)
    assert res.status_code == 201, res.text
    v1 = res.json()
    assert v1["version"] == 1 and v1["is_current"] is True and v1["confirmed_at"] is None
    assert v1["file_url"] == f"/api/v1/designs/{v1['id']}/file"
    assert v1["thumbnail_url"] == f"/api/v1/designs/{v1['id']}/thumbnail"
    # 파일·썸네일 다운로드 (JWT 필수)
    res = await client.get(v1["file_url"], headers=admin_headers)
    assert res.status_code == 200 and res.content[:4] == b"\x89PNG"
    res = await client.get(v1["thumbnail_url"], headers=admin_headers)
    assert res.status_code == 200 and res.headers["content-type"].startswith("image/png")
    res = await client.get(v1["file_url"])
    assert res.status_code == 401
    res = await client.get(f"{API}/designs/999999999/file", headers=admin_headers)
    assert res.status_code == 404 and res.json()["code"] == "DESIGN_NOT_FOUND"

    # 확정 → confirmed_at · line.design_confirmed
    res = await confirm_design(client, admin_headers, so["id"], line_id)
    assert res.status_code == 200 and res.json()["confirmed_at"] is not None
    d = (await client.get(f"{API}/so/{so['id']}", headers=admin_headers)).json()
    assert d["lines"][0]["design_confirmed"] is True and d["lines"][0]["design"]["version"] == 1
    res = await confirm_design(client, admin_headers, so["id"], line_id)
    assert res.status_code == 409 and res.json()["code"] == "STATE_CONFLICT"

    # v2 (pdf → 썸네일 없음) · 이전 버전 is_current 해제 · 확정 해제
    res = await upload_design(
        client, admin_headers, so["id"], line_id, filename="시안.PDF", content=b"%PDF-1.4 x"
    )
    assert res.status_code == 201, res.text
    v2 = res.json()
    assert v2["version"] == 2 and v2["is_current"] is True and v2["thumbnail_url"] is None
    d = (await client.get(f"{API}/so/{so['id']}", headers=admin_headers)).json()
    assert d["lines"][0]["design"]["id"] == v2["id"] and d["lines"][0]["design_confirmed"] is False
    from app.db.models.order import Design
    from app.db.session import SessionLocal

    async with SessionLocal() as s:
        old = await s.get(Design, v1["id"])
        assert old is not None and old.is_current is False
        new = await s.get(Design, v2["id"])
        assert new is not None and new.confirmed_by is None
    res = await client.get(f"{API}/designs/{v2['id']}/thumbnail", headers=admin_headers)
    assert res.status_code == 404

    # 형식 · 크기 · 빈 파일 · 없는 라인
    res = await upload_design(client, admin_headers, so["id"], line_id, filename="x.exe")
    assert res.status_code == 422 and res.json()["code"] == "BAD_FILE_TYPE"
    res = await upload_design(
        client, admin_headers, so["id"], line_id, filename="x.png", content=b""
    )
    assert res.status_code == 422
    settings = get_settings()
    saved = settings.design_max_bytes
    settings.design_max_bytes = 100
    try:
        res = await upload_design(
            client, admin_headers, so["id"], line_id, filename="big.png", content=b"0" * 200
        )
        assert res.status_code == 413 and res.json()["code"] == "FILE_TOO_LARGE"
    finally:
        settings.design_max_bytes = saved
    res = await upload_design(client, admin_headers, so["id"], 999999999)
    assert res.status_code == 404 and res.json()["code"] == "SO_LINE_NOT_FOUND"
    # 확정할 도안이 없는 라인 → 409
    so_b = await make_so(client, admin_headers, m)
    res = await confirm_design(client, admin_headers, so_b["id"], so_b["lines"][0]["id"])
    assert res.status_code == 409 and res.json()["code"] == "STATE_CONFLICT"
    # 감사 로그: design INSERT · sales_order_line UPDATE
    from app.db.models.ops import AuditLog

    async with SessionLocal() as s:
        rows = (
            (
                await s.execute(
                    select(AuditLog).where(
                        AuditLog.table_name == "design", AuditLog.row_id == v1["id"]
                    )
                )
            )
            .scalars()
            .all()
        )
        assert any(r.action == "INSERT" and r.user_id is not None for r in rows)


@pytest.mark.asyncio
async def test_so_patch_lines_and_cancel(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    m = await setup_master(client, admin_headers, routings=("SCREEN", "NONE"))
    item = m["item"]
    so = await make_so(
        client,
        admin_headers,
        m,
        lines=[
            {"item_id": item["id"], "print_method": "SCREEN", "qty": 300},
            {"item_id": item["id"], "print_method": "NONE", "qty": 100},
        ],
    )
    l1, l2 = so["lines"]
    # 헤더 변경 + 라인 수량 변경 + 라인 추가 + 라인 삭제(WO 없음)
    res = await client.patch(
        f"{API}/so/{so['id']}",
        headers=admin_headers,
        json={
            "due_date": "2026-10-12",
            "memo": None,
            "lines": [
                {"id": l1["id"], "item_id": item["id"], "print_method": "SCREEN", "qty": 350},
                {"item_id": item["id"], "print_method": "NONE", "qty": 40},
            ],
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["due_date"] == "2026-10-12" and body["memo"] is None
    assert [(ln["line_no"], ln["qty"]) for ln in body["lines"]] == [(1, 350), (3, 40)]
    # 없는 라인 id → 422
    res = await client.patch(
        f"{API}/so/{so['id']}",
        headers=admin_headers,
        json={"lines": [{"id": l2["id"], "item_id": item["id"], "print_method": "NONE", "qty": 1}]},
    )
    assert res.status_code == 422

    # 발행 후: NONE 라인은 도안 없이, SCREEN 라인은 도안 확정 후 발행
    res = await upload_design(client, admin_headers, so["id"], l1["id"])
    assert res.status_code == 201
    assert (await confirm_design(client, admin_headers, so["id"], l1["id"])).status_code == 200
    issued = await issue_all(client, admin_headers, so["id"])
    wo_codes = {w["so_code"] for w in issued["work_orders"]}
    assert wo_codes == {so["code"]} and len(issued["work_orders"]) == 2
    wo1 = next(w for w in issued["work_orders"] if w["print_method"] == "SCREEN")
    # 미착수(ISSUED) WO 1건 → 수량 변경이 WO 에 반영 (A2-05)
    lines_now = (await client.get(f"{API}/so/{so['id']}", headers=admin_headers)).json()["lines"]
    res = await client.patch(
        f"{API}/so/{so['id']}",
        headers=admin_headers,
        json={
            "lines": [
                {
                    "id": ln["id"],
                    "item_id": item["id"],
                    "print_method": ln["print_method"],
                    "qty": 360 if ln["id"] == l1["id"] else ln["qty"],
                }
                for ln in lines_now
            ]
        },
    )
    assert res.status_code == 200, res.text
    w = (await client.get(f"{API}/wo/{wo1['code']}", headers=admin_headers)).json()
    assert w["qty_ordered"] == 360 and w["steps"][0]["qty_in"] == 360
    # 품목·가공방식 변경은 발행 후 불가 · 라인 삭제도 불가 → 409
    res = await client.patch(
        f"{API}/so/{so['id']}",
        headers=admin_headers,
        json={
            "lines": [
                {
                    "id": ln["id"],
                    "item_id": item["id"],
                    "print_method": "NONE" if ln["id"] == l1["id"] else ln["print_method"],
                    "qty": ln["qty"],
                }
                for ln in lines_now
            ]
        },
    )
    assert res.status_code == 409 and res.json()["code"] == "STATE_CONFLICT"
    res = await client.patch(
        f"{API}/so/{so['id']}",
        headers=admin_headers,
        json={
            "lines": [{"id": l1["id"], "item_id": item["id"], "print_method": "SCREEN", "qty": 360}]
        },
    )
    assert res.status_code == 409
    # 착수한 WO(hold 로 ON_HOLD) 가 있는 라인 수량 변경 → 409
    res = await client.post(
        f"{API}/wo/{wo1['id']}/hold", headers=admin_headers, json={"reason": "자재 대기"}
    )
    assert res.status_code == 200 and res.json()["status"] == "ON_HOLD"
    res = await client.patch(
        f"{API}/so/{so['id']}",
        headers=admin_headers,
        json={
            "lines": [
                {
                    "id": ln["id"],
                    "item_id": item["id"],
                    "print_method": ln["print_method"],
                    "qty": 370 if ln["id"] == l1["id"] else ln["qty"],
                }
                for ln in lines_now
            ]
        },
    )
    assert res.status_code == 409 and wo1["code"] in res.json()["message"]

    # 취소: 미착수(ISSUED NONE WO) → CANCELLED, 착수(ON_HOLD) → pending
    res = await client.post(
        f"{API}/so/{so['id']}/cancel", headers=admin_headers, json={"reason": "고객 요청"}
    )
    assert res.status_code == 200, res.text
    c = res.json()
    assert c["so"]["status"] == "CANCELLED"
    assert [w["code"] for w in c["pending_wo"]] == [wo1["code"]]
    assert len(c["cancelled_wo"]) == 1 and c["cancelled_wo"][0] != wo1["code"]
    from app.db.models.order import SalesOrder
    from app.db.session import SessionLocal

    async with SessionLocal() as s:
        row = await s.get(SalesOrder, so["id"])
        assert row is not None and row.cancel_reason == "고객 요청"
        assert row.cancelled_at is not None and row.cancelled_by is not None
    res = await client.post(
        f"{API}/so/{so['id']}/cancel", headers=admin_headers, json={"reason": "다시"}
    )
    assert res.status_code == 409
    res = await client.patch(f"{API}/so/{so['id']}", headers=admin_headers, json={"memo": "x"})
    assert res.status_code == 409 and res.json()["code"] == "STATE_CONFLICT"
    res = await client.post(f"{API}/so/{so['id']}/propose-wo", headers=admin_headers)
    assert res.status_code == 409
    # SALES 도 취소 가능, WORKER 는 불가
    sales = await headers_for(client, "t_sales_so", "SALES")
    so3 = await make_so(client, sales, m)
    worker = await headers_for(client, "t_worker_so", "WORKER")
    res = await client.post(f"{API}/so/{so3['id']}/cancel", headers=worker, json={"reason": "x"})
    assert res.status_code == 403
    res = await client.post(f"{API}/so/{so3['id']}/cancel", headers=sales, json={"reason": "x"})
    assert res.status_code == 200 and res.json()["cancelled_wo"] == []


@pytest.mark.asyncio
async def test_audit_log_sales_order(client: AsyncClient, admin_headers: dict[str, str]) -> None:
    m = await setup_master(client, admin_headers)
    so = await make_so(client, admin_headers, m, memo=uniq("memo-"))
    from app.db.models.ops import AuditLog
    from app.db.session import SessionLocal

    async with SessionLocal() as s:
        rows = (
            (
                await s.execute(
                    select(AuditLog).where(
                        AuditLog.table_name == "sales_order", AuditLog.row_id == so["id"]
                    )
                )
            )
            .scalars()
            .all()
        )
        ins = [r for r in rows if r.action == "INSERT"]
        assert len(ins) == 1 and ins[0].before is None
        assert ins[0].after is not None and ins[0].after["code"] == so["code"]
        assert ins[0].user_id is not None and ins[0].request_id
        line_rows = (
            (
                await s.execute(
                    select(AuditLog).where(
                        AuditLog.table_name == "sales_order_line",
                        AuditLog.row_id == so["lines"][0]["id"],
                    )
                )
            )
            .scalars()
            .all()
        )
        assert any(r.action == "INSERT" for r in line_rows)

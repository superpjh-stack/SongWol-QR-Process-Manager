"""S1-8 QR 착지 ``GET /api/v1/q/{code}?c=``: 형식·체크코드 오류 400 · SO/WO/US 해석 · 비로그인 제외
필드(#30) · allowed_actions(#31) · LT 404 · 만료 토큰 401."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.core.checkcode import make_check
from tests.conftest import ensure_user, headers_for
from tests.helpers_order import API, confirm_design, issue_all, make_so, setup_master, upload_design


@pytest.mark.asyncio
async def test_q_checkcode_and_format(client: AsyncClient) -> None:
    code = "SO-261001-0001"
    res = await client.get(f"{API}/q/{code}")
    assert res.status_code == 400 and res.json()["code"] == "BAD_CHECKCODE"
    res = await client.get(f"{API}/q/{code}", params={"c": "ZZZZ"})
    assert res.status_code == 400 and res.json()["code"] == "BAD_CHECKCODE"
    res = await client.get(f"{API}/q/{code}", params={"c": make_check(code)[:3]})
    assert res.status_code == 400 and res.json()["code"] == "BAD_CHECKCODE"
    res = await client.get(f"{API}/q/8801234567890", params={"c": "AAAA"})
    assert res.status_code == 400 and res.json()["code"] == "BAD_CODE_FORMAT"
    # 체크코드는 맞지만 없는 수주 → 404
    res = await client.get(f"{API}/q/{code}", params={"c": make_check(code)})
    assert res.status_code == 404 and res.json()["code"] == "SO_NOT_FOUND"
    # LT 는 S3 → 404 LOT_NOT_FOUND
    lt = "LT-261001-0001"
    res = await client.get(f"{API}/q/{lt}", params={"c": make_check(lt)})
    assert res.status_code == 404 and res.json()["code"] == "LOT_NOT_FOUND"
    # 소문자 코드·소문자 체크코드 허용
    res = await client.get(f"{API}/q/{code.lower()}", params={"c": make_check(code).lower()})
    assert res.status_code == 404 and res.json()["code"] == "SO_NOT_FOUND"


@pytest.mark.asyncio
async def test_q_so_wo_us_landing(client: AsyncClient, admin_headers: dict[str, str]) -> None:
    m = await setup_master(client, admin_headers)
    so = await make_so(client, admin_headers, m)
    line = so["lines"][0]
    assert (await upload_design(client, admin_headers, so["id"], line["id"])).status_code == 201
    assert (await confirm_design(client, admin_headers, so["id"], line["id"])).status_code == 200
    wo = (await issue_all(client, admin_headers, so["id"]))["work_orders"][0]

    # SO 비로그인: 요약만, 연락처·memo·unit_price 없음, allowed_actions []
    res = await client.get(f"{API}/q/{so['code']}", params={"c": make_check(so["code"])})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["type"] == "SO" and body["code"] == so["code"] and body["allowed_actions"] == []
    s = body["summary"]
    assert s["code"] == so["code"] and s["customer"]["name"] == m["customer"]["name"]
    assert s["status"] == "IN_PROGRESS" and s["wo_count"] == 1 and s["line_count"] == 1
    for forbidden in ("memo", "lines", "ship_to", "phone", "contact_name", "unit_price"):
        assert forbidden not in s
    assert "phone" not in s["customer"]
    # SO 로그인 → VIEW_DETAIL
    res = await client.get(
        f"{API}/q/{so['code']}", params={"c": make_check(so["code"])}, headers=admin_headers
    )
    assert res.json()["allowed_actions"] == ["VIEW_DETAIL"]

    # WO 비로그인: design_thumbnail_url 제외(#30)
    res = await client.get(f"{API}/q/{wo['code']}", params={"c": make_check(wo["code"])})
    assert res.status_code == 200
    body = res.json()
    assert body["type"] == "WO" and body["allowed_actions"] == []
    w = body["summary"]
    assert w["code"] == wo["code"] and w["design_thumbnail_url"] is None
    assert w["design_version"] == 1 and w["current_process_code"] == "P20"
    assert w["qty_ordered"] == 500 and w["status"] == "ISSUED"
    # WO 로그인(ADMIN): 썸네일 포함 · VIEW_DETAIL/REPRINT/HOLD/SPLIT
    res = await client.get(
        f"{API}/q/{wo['code']}", params={"c": make_check(wo["code"])}, headers=admin_headers
    )
    body = res.json()
    assert body["summary"]["design_thumbnail_url"] == wo["design_thumbnail_url"]
    assert body["allowed_actions"] == ["VIEW_DETAIL", "REPRINT", "HOLD", "SPLIT"]
    # SALES: VIEW_DETAIL/REPRINT · VIEWER: VIEW_DETAIL 만
    sales = await headers_for(client, "t_sales_q", "SALES")
    res = await client.get(
        f"{API}/q/{wo['code']}", params={"c": make_check(wo["code"])}, headers=sales
    )
    assert res.json()["allowed_actions"] == ["VIEW_DETAIL", "REPRINT"]
    viewer = await headers_for(client, "t_viewer_q", "VIEWER")
    res = await client.get(
        f"{API}/q/{wo['code']}", params={"c": make_check(wo["code"])}, headers=viewer
    )
    assert res.json()["allowed_actions"] == ["VIEW_DETAIL"]
    # ON_HOLD → HOLD/SPLIT 빠짐, REPRINT 유지
    res = await client.post(
        f"{API}/wo/{wo['id']}/hold", headers=admin_headers, json={"reason": "x"}
    )
    assert res.status_code == 200
    res = await client.get(
        f"{API}/q/{wo['code']}", params={"c": make_check(wo["code"])}, headers=admin_headers
    )
    assert res.json()["allowed_actions"] == ["VIEW_DETAIL", "REPRINT"]

    # US: 비로그인은 name·role·card_code 만, 로그인(ADMIN)은 UserSummary + VIEW_DETAIL
    worker = await ensure_user("t_worker_q", "WORKER", card=True)
    card = worker.card_code
    res = await client.get(f"{API}/q/{card}", params={"c": make_check(card)})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["type"] == "US" and body["allowed_actions"] == []
    assert body["summary"] == {"name": "t_worker_q", "role": "WORKER", "card_code": card}
    res = await client.get(f"{API}/q/{card}", params={"c": make_check(card)}, headers=admin_headers)
    assert res.json()["summary"]["login_id"] == "t_worker_q"
    assert res.json()["allowed_actions"] == ["VIEW_DETAIL"]
    res = await client.get(f"{API}/q/{card}", params={"c": make_check(card)}, headers=viewer)
    assert res.json()["allowed_actions"] == []
    res = await client.get(f"{API}/q/US-9999", params={"c": make_check("US-9999")})
    assert res.status_code == 404 and res.json()["code"] == "USER_CARD_NOT_FOUND"

    # 잘못된 토큰은 401 (화면이 비로그인 표시로 전환)
    res = await client.get(
        f"{API}/q/{so['code']}",
        params={"c": make_check(so["code"])},
        headers={"Authorization": "Bearer not-a-jwt"},
    )
    assert res.status_code == 401

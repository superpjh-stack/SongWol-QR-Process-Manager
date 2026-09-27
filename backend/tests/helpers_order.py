"""S1 수주·WO 테스트 공통: 거래처·품목·라우팅·수주 생성, 도안 파일."""

from __future__ import annotations

import io
from typing import Any, cast

from httpx import AsyncClient

from tests.conftest import ensure_item_group, uniq

API = "/api/v1"


async def make_customer(client: AsyncClient, headers: dict[str, str]) -> dict[str, Any]:
    code = uniq("C")
    res = await client.post(
        f"{API}/customers",
        headers=headers,
        json={
            "code": code,
            "name": f"거래처 {code}",
            "phone": "02-000-0000",
            "contact_name": "담당",
        },
    )
    assert res.status_code == 201, res.text
    cust = cast(dict[str, Any], res.json())
    res = await client.post(
        f"{API}/customers/{cust['id']}/addresses",
        headers=headers,
        json={
            "label": "본사",
            "receiver": "수령인",
            "phone": "010-1111-2222",
            "address1": "부산 사상구 1",
            "is_default": True,
        },
    )
    assert res.status_code == 201, res.text
    cust["address"] = res.json()
    return cust


async def make_item(
    client: AsyncClient, headers: dict[str, str], item_group: str, tolerance: float = 3.0
) -> dict[str, Any]:
    code = uniq("I")
    res = await client.post(
        f"{API}/items",
        headers=headers,
        json={
            "code": code,
            "name": f"타월 {code}",
            "item_group": item_group,
            "spec": "40×80",
            "color": "화이트",
            "qty_tolerance_pct": tolerance,
        },
    )
    assert res.status_code == 201, res.text
    return cast(dict[str, Any], res.json())


FULL_STEPS = [
    {"seq": 1, "process_code": "P20", "std_lead_hours": 8, "tolerance_pct": None},
    {"seq": 2, "process_code": "P30", "std_lead_hours": 24, "tolerance_pct": 2.5},
    {"seq": 3, "process_code": "P50", "std_lead_hours": 8, "tolerance_pct": None},
    {"seq": 4, "process_code": "P60", "std_lead_hours": 4, "tolerance_pct": None},
]
NONE_STEPS = [
    {"seq": 1, "process_code": "P20", "std_lead_hours": 8, "tolerance_pct": None},
    {"seq": 2, "process_code": "P50", "std_lead_hours": 4, "tolerance_pct": None},
    {"seq": 3, "process_code": "P60", "std_lead_hours": 4, "tolerance_pct": None},
]


async def make_routing(
    client: AsyncClient,
    headers: dict[str, str],
    item_group: str,
    print_method: str,
    steps: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    body = {
        "item_group": item_group,
        "print_method": print_method,
        "steps": steps
        if steps is not None
        else (NONE_STEPS if print_method == "NONE" else FULL_STEPS),
    }
    res = await client.post(f"{API}/routings", headers=headers, json=body)
    assert res.status_code == 201, res.text
    return cast(dict[str, Any], res.json())


async def setup_master(
    client: AsyncClient, headers: dict[str, str], *, routings: tuple[str, ...] = ("SCREEN",)
) -> dict[str, Any]:
    """거래처(+기본 배송지) · 품목군 · 품목 · 라우팅 세트."""
    group = await ensure_item_group(uniq("TG"), "테스트 품목군")
    cust = await make_customer(client, headers)
    item = await make_item(client, headers, group)
    rts = {pm: await make_routing(client, headers, group, pm) for pm in routings}
    return {"group": group, "customer": cust, "item": item, "routings": rts}


async def make_so(
    client: AsyncClient,
    headers: dict[str, str],
    m: dict[str, Any],
    lines: list[dict[str, Any]] | None = None,
    **extra: Any,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "customer_id": m["customer"]["id"],
        "order_date": "2026-10-01",
        "due_date": "2026-10-10",
        "address_id": m["customer"]["address"]["id"],
        "memo": "테스트 수주",
        "lines": lines
        or [{"item_id": m["item"]["id"], "print_method": "SCREEN", "qty": 500, "unit_price": 1200}],
    }
    body.update(extra)
    res = await client.post(f"{API}/so", headers=headers, json=body)
    assert res.status_code == 201, res.text
    return cast(dict[str, Any], res.json())


def png_bytes(size: tuple[int, int] = (64, 48)) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", size, (200, 30, 30)).save(buf, format="PNG")
    return buf.getvalue()


async def upload_design(
    client: AsyncClient,
    headers: dict[str, str],
    so_id: int,
    line_id: int,
    *,
    filename: str = "design.png",
    content: bytes | None = None,
) -> Any:
    data = content if content is not None else png_bytes()
    return await client.post(
        f"{API}/so/{so_id}/lines/{line_id}/design",
        headers=headers,
        files={"file": (filename, data, "application/octet-stream")},
    )


async def confirm_design(
    client: AsyncClient, headers: dict[str, str], so_id: int, line_id: int
) -> Any:
    return await client.post(f"{API}/so/{so_id}/lines/{line_id}/design/confirm", headers=headers)


async def issue_all(client: AsyncClient, headers: dict[str, str], so_id: int) -> dict[str, Any]:
    """propose → issue (도안은 호출자가 확정해 둔다)."""
    res = await client.post(f"{API}/so/{so_id}/propose-wo", headers=headers)
    assert res.status_code == 200, res.text
    drafts = res.json()["items"]
    res = await client.post(f"{API}/so/{so_id}/issue-wo", headers=headers, json={"drafts": drafts})
    assert res.status_code == 200, res.text
    return cast(dict[str, Any], res.json())

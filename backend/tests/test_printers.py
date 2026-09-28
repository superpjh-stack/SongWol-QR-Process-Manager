"""A1-09 프린터 CRUD · 테스트 출력(미도달 200 zpl_sent=false) · 권한."""

from __future__ import annotations

from httpx import AsyncClient

from tests.conftest import ensure_station, headers_for, uniq
from tests.label_helpers import fake_printer, free_closed_port

API = "/api/v1"


async def test_printer_crud(client: AsyncClient, admin_headers: dict[str, str]) -> None:
    pid = uniq("LP-C")
    res = await client.post(
        f"{API}/printers",
        headers=admin_headers,
        json={
            "id": pid.lower(),
            "name": "포장 프린터",
            "host": "192.168.0.50",
            "purpose": "PACKING",
        },
    )
    assert res.status_code == 201, res.text
    p = res.json()
    assert p["id"] == pid and p["port"] == 9100 and p["active"] is True and p["location"] is None
    res = await client.post(
        f"{API}/printers",
        headers=admin_headers,
        json={"id": pid, "name": "x", "host": "h", "purpose": "PACKING"},
    )
    assert res.status_code == 409 and res.json()["code"] == "DUPLICATE_CODE"
    res = await client.post(
        f"{API}/printers",
        headers=admin_headers,
        json={"id": uniq("LP-X"), "name": "x", "host": "h", "purpose": "OTHER"},
    )
    assert res.status_code == 422 and res.json()["code"] == "VALIDATION_ERROR"

    res = await client.get(f"{API}/printers", headers=admin_headers)
    assert res.status_code == 200 and isinstance(res.json(), list)
    assert pid in {r["id"] for r in res.json()}
    res = await client.get(f"{API}/printers/{pid}", headers=admin_headers)
    assert res.status_code == 200 and res.json()["name"] == "포장 프린터"
    res = await client.patch(
        f"{API}/printers/{pid}",
        headers=admin_headers,
        json={"port": 9101, "location": "포장동", "purpose": "PRODUCTION"},
    )
    assert res.status_code == 200
    assert res.json()["port"] == 9101 and res.json()["location"] == "포장동"
    assert res.json()["purpose"] == "PRODUCTION"
    res = await client.patch(
        f"{API}/printers/{pid}", headers=admin_headers, json={"location": None}
    )
    assert res.status_code == 200 and res.json()["location"] is None
    res = await client.post(f"{API}/printers/{pid}/deactivate", headers=admin_headers)
    assert res.status_code == 200 and res.json()["active"] is False
    res = await client.get(f"{API}/printers", headers=admin_headers, params={"active": "true"})
    assert pid not in {r["id"] for r in res.json()}
    res = await client.post(f"{API}/printers/{pid}/activate", headers=admin_headers)
    assert res.status_code == 200 and res.json()["active"] is True
    res = await client.get(f"{API}/printers/LP-NOPE", headers=admin_headers)
    assert res.status_code == 404 and res.json()["code"] == "PRINTER_NOT_FOUND"


async def test_printer_test_label(client: AsyncClient, admin_headers: dict[str, str]) -> None:
    pid = uniq("LP-TS")
    res = await client.post(
        f"{API}/printers",
        headers=admin_headers,
        json={
            "id": pid,
            "name": "테스트",
            "host": "127.0.0.1",
            "port": free_closed_port(),
            "purpose": "PACKING",
        },
    )
    assert res.status_code == 201
    # 미도달 → 200 + zpl_sent=false + PRINTER_UNREACHABLE (503 아님)
    res = await client.post(f"{API}/printers/{pid}/test", headers=admin_headers)
    assert res.status_code == 200, res.text
    r = res.json()
    assert r["zpl_sent"] is False and r["error"] == "PRINTER_UNREACHABLE" and r["sent_at"] is None
    assert r["printer_id"] == pid and r["host"] == "127.0.0.1" and "^XA" in r["zpl"]
    # 도달 → zpl_sent=true, 프린터가 ZPL 을 받는다
    async with fake_printer() as (port, received):
        await client.patch(f"{API}/printers/{pid}", headers=admin_headers, json={"port": port})
        res = await client.post(f"{API}/printers/{pid}/test", headers=admin_headers)
    assert res.status_code == 200 and res.json()["zpl_sent"] is True
    assert res.json()["error"] is None and res.json()["sent_at"].endswith("+09:00")
    sent = received[0].decode("utf-8")
    assert sent.startswith("^XA") and "SONGWOL QR TEST" in sent and pid in sent and "^BQN" in sent
    res = await client.post(f"{API}/printers/LP-NOPE/test", headers=admin_headers)
    assert res.status_code == 404


async def test_printer_permissions(client: AsyncClient, admin_headers: dict[str, str]) -> None:
    manager = await headers_for(client, "t_manager", "MANAGER")
    sales = await headers_for(client, "t_sales", "SALES")
    assert (await client.get(f"{API}/printers", headers=manager)).status_code == 200
    assert (await client.get(f"{API}/printers", headers=sales)).status_code == 403
    body = {"id": uniq("LP-M"), "name": "x", "host": "h", "purpose": "PACKING"}
    assert (await client.post(f"{API}/printers", headers=manager, json=body)).status_code == 403
    _, key = await ensure_station("T-K-PRN-1")
    assert (
        await client.get(f"{API}/printers", headers={"X-Station-Key": key})
    ).status_code == 200  # STATION R
    assert (
        await client.post(f"{API}/printers", headers={"X-Station-Key": key}, json=body)
    ).status_code == 403
    assert (await client.get(f"{API}/printers")).status_code == 401


async def test_printer_host_private_only(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    """DEF-QA2-S1-012 / D45: 사설 대역만. 위반 422 BAD_PRINTER_HOST."""
    ok_hosts = ["10.1.2.3", "172.16.0.9", "172.31.255.1", "192.168.0.50", "127.0.0.1", "localhost"]
    bad_hosts = ["8.8.8.8", "172.32.0.1", "203.0.113.5", "2001:db8::1", "no-such-host.invalid"]
    for h in ok_hosts:
        res = await client.post(
            f"{API}/printers",
            headers=admin_headers,
            json={"id": uniq("LP-H"), "name": "x", "host": h, "purpose": "PACKING"},
        )
        assert res.status_code == 201, (h, res.text)
    pid = res.json()["id"]
    for h in bad_hosts:
        res = await client.post(
            f"{API}/printers",
            headers=admin_headers,
            json={"id": uniq("LP-B"), "name": "x", "host": h, "purpose": "PACKING"},
        )
        assert res.status_code == 422 and res.json()["code"] == "BAD_PRINTER_HOST", (h, res.text)
        assert res.json()["detail"][0]["loc"] == ["body", "host"]
    res = await client.patch(
        f"{API}/printers/{pid}", headers=admin_headers, json={"host": "1.1.1.1"}
    )
    assert res.status_code == 422 and res.json()["code"] == "BAD_PRINTER_HOST"
    res = await client.patch(
        f"{API}/printers/{pid}", headers=admin_headers, json={"host": "10.0.0.7"}
    )
    assert res.status_code == 200 and res.json()["host"] == "10.0.0.7"

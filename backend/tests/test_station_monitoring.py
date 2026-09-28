"""S4: 단말 모니터링 (admin #14) — ``offline_state`` 는 이미 S0/S1 부터 있었다(검증만 여기서
보강). 이 파일은 새로 만든 두 경로: ``GET/PUT /settings/station-offline`` ·
``GET /stations/{id}/workers``.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from tests.conftest import ensure_station, ensure_user, headers_for, uniq
from tests.helpers_order import API

pytestmark = pytest.mark.asyncio


async def test_get_put_station_offline_settings(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    res = await client.get(f"{API}/settings/station-offline", headers=admin_headers)
    assert res.status_code == 200, res.text
    assert res.json() == {"warn_minutes": 30, "error_minutes": 1440}

    res = await client.put(
        f"{API}/settings/station-offline",
        headers=admin_headers,
        json={"warn_minutes": 15, "error_minutes": 720},
    )
    assert res.status_code == 200, res.text
    assert res.json() == {"warn_minutes": 15, "error_minutes": 720}

    res2 = await client.get(f"{API}/settings/station-offline", headers=admin_headers)
    assert res2.json() == {"warn_minutes": 15, "error_minutes": 720}


async def test_put_station_offline_settings_requires_admin(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    manager_headers = await headers_for(client, uniq("mgr").lower(), "MANAGER")
    res = await client.put(
        f"{API}/settings/station-offline",
        headers=manager_headers,
        json={"warn_minutes": 10, "error_minutes": 60},
    )
    assert res.status_code == 403


async def test_station_offline_state_reflects_settings(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    station_id, key = await ensure_station(uniq("T-K-MON-"))
    # 등록만으로는 last_seen_at 이 없다(ERROR, "한 번도 접속 안 한 단말") — 실제 요청 한 번으로
    # 채운다(``_load_station_from_key`` 가 매 요청마다 갱신).
    res_me = await client.get(f"{API}/stations/me", headers={"X-Station-Key": key})
    assert res_me.status_code == 200, res_me.text

    res = await client.get(f"{API}/stations/{station_id}", headers=admin_headers)
    assert res.status_code == 200
    assert res.json()["offline_state"] == "ONLINE"


async def test_stations_workers_admin_sees_all_active_login_roles(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    w = await ensure_user(uniq("w").lower(), "WORKER", card=True)
    await ensure_user(uniq("v").lower(), "VIEWER", card=False)  # VIEWER 는 단말 로그인 불가
    station_id, _key = await ensure_station(uniq("T-K-WK-"))

    res = await client.get(f"{API}/stations/{station_id}/workers", headers=admin_headers)
    assert res.status_code == 200, res.text
    login_ids = {u["login_id"] for u in res.json()}
    assert w.login_id in login_ids
    for u in res.json():
        assert u["role"] in ("WORKER", "MANAGER", "ADMIN")
        assert "pin_hash" not in u and "password_hash" not in u


async def test_stations_workers_station_key_self_only(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    station_a, key_a = await ensure_station(uniq("T-K-WKA-"))
    station_b, _key_b = await ensure_station(uniq("T-K-WKB-"))

    res = await client.get(
        f"{API}/stations/{station_a}/workers", headers={"X-Station-Key": key_a}
    )
    assert res.status_code == 200, res.text

    res_other = await client.get(
        f"{API}/stations/{station_b}/workers", headers={"X-Station-Key": key_a}
    )
    assert res_other.status_code == 403

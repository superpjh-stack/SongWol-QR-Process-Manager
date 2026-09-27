"""S0-3 인증.

로그인 · JWT 만료 · 역할 403 · 단말 키 대조 · rotate 후 구 key 거부 · 작업자 로그인(카드·PIN·잠금).
"""

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.security import create_access_token
from tests.conftest import (
    TEST_ADMIN_LOGIN,
    TEST_ADMIN_PASSWORD,
    ensure_station,
    ensure_user,
    headers_for,
    uniq,
)

API = "/api/v1"


@pytest.mark.asyncio
async def test_login_ok_and_me(client: AsyncClient) -> None:
    await ensure_user(TEST_ADMIN_LOGIN, "ADMIN", password=TEST_ADMIN_PASSWORD)
    res = await client.post(
        f"{API}/auth/login", json={"login_id": TEST_ADMIN_LOGIN, "password": TEST_ADMIN_PASSWORD}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 43200  # 12h (spec §13)
    assert body["user"]["login_id"] == TEST_ADMIN_LOGIN and body["user"]["role"] == "ADMIN"
    assert res.headers.get("X-Request-Id")
    me = await client.get(
        f"{API}/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"}
    )
    assert me.status_code == 200 and me.json()["login_id"] == TEST_ADMIN_LOGIN


@pytest.mark.asyncio
async def test_login_bad_password_401_contract_shape(client: AsyncClient) -> None:
    await ensure_user(TEST_ADMIN_LOGIN, "ADMIN", password=TEST_ADMIN_PASSWORD)
    res = await client.post(
        f"{API}/auth/login", json={"login_id": TEST_ADMIN_LOGIN, "password": "wrong"}
    )
    assert res.status_code == 401
    assert set(res.json()) == {"code", "message", "detail"}
    assert res.json()["code"] == "BAD_CREDENTIALS"


@pytest.mark.asyncio
async def test_login_inactive_user_403(client: AsyncClient) -> None:
    login = uniq("t_inact_").lower()
    await ensure_user(login, "MANAGER", password=TEST_ADMIN_PASSWORD, active=False)
    res = await client.post(
        f"{API}/auth/login", json={"login_id": login, "password": TEST_ADMIN_PASSWORD}
    )
    assert res.status_code == 403 and res.json()["code"] == "USER_INACTIVE"


@pytest.mark.asyncio
async def test_missing_and_expired_token(client: AsyncClient) -> None:
    res = await client.get(f"{API}/auth/me")
    assert res.status_code == 401 and res.json()["code"] == "UNAUTHENTICATED"
    u = await ensure_user(TEST_ADMIN_LOGIN, "ADMIN", password=TEST_ADMIN_PASSWORD)
    token, _ = create_access_token(
        user_id=u.id, login_id=u.login_id, role=u.role, now=datetime.now(UTC) - timedelta(hours=13)
    )
    res = await client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401 and res.json()["code"] == "TOKEN_EXPIRED"
    res = await client.get(f"{API}/auth/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert res.status_code == 401 and res.json()["code"] == "UNAUTHENTICATED"


@pytest.mark.asyncio
async def test_role_guard_403(client: AsyncClient) -> None:
    viewer = await headers_for(client, "t_viewer", "VIEWER")
    res = await client.get(f"{API}/customers", headers=viewer)  # VIEWER 는 기준정보 —
    assert res.status_code == 403 and res.json()["code"] == "FORBIDDEN"
    manager = await headers_for(client, "t_manager", "MANAGER")
    res = await client.post(f"{API}/customers", headers=manager, json={"code": "X", "name": "x"})
    assert res.status_code == 403  # MANAGER 는 거래처 R
    res = await client.get(f"{API}/customers", headers=manager)
    assert res.status_code == 200


@pytest.mark.asyncio
async def test_validation_422_detail_loc(client: AsyncClient) -> None:
    res = await client.post(f"{API}/auth/login", json={"login_id": "", "password": ""})
    assert res.status_code == 422
    body = res.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert body["detail"][0]["loc"][0] == "body"


@pytest.mark.asyncio
async def test_unknown_route_404_contract_shape(client: AsyncClient) -> None:
    res = await client.get(f"{API}/nope")
    assert res.status_code == 404 and res.json()["code"] == "NOT_FOUND"


@pytest.mark.asyncio
async def test_station_key_ok_bad_inactive_and_rotate(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    sid, key = await ensure_station("T-K-ROT-1")
    res = await client.get(f"{API}/stations/me", headers={"X-Station-Key": key})
    assert res.status_code == 200 and res.json()["id"] == sid
    assert res.json()["offline_state"] == "ONLINE"  # last_seen_at 갱신됨
    res = await client.get(f"{API}/stations/me", headers={"X-Station-Key": "bad"})
    assert res.status_code == 401 and res.json()["code"] == "BAD_STATION_KEY"
    res = await client.get(f"{API}/stations/me")
    assert res.status_code == 401
    # 회전 → 새 키 1회 응답 + setup_url/QR, 구 키 거부
    res = await client.post(f"{API}/stations/{sid}/rotate-key", headers=admin_headers)
    assert res.status_code == 200, res.text
    rotated = res.json()
    assert set(rotated) == {"api_key", "setup_url", "setup_qr_png"}
    assert f"/setup?s={sid}&k={rotated['api_key']}" in rotated["setup_url"]
    assert rotated["setup_url"].endswith("&v=1")
    assert len(rotated["setup_qr_png"]) > 100
    old = await client.get(f"{API}/stations/me", headers={"X-Station-Key": key})
    assert old.status_code == 401
    new = await client.get(f"{API}/stations/me", headers={"X-Station-Key": rotated["api_key"]})
    assert new.status_code == 200
    # 비활성 단말 → 403 STATION_INACTIVE
    res = await client.post(f"{API}/stations/{sid}/deactivate", headers=admin_headers)
    assert res.status_code == 200 and res.json()["active"] is False
    res = await client.get(f"{API}/stations/me", headers={"X-Station-Key": rotated["api_key"]})
    assert res.status_code == 403 and res.json()["code"] == "STATION_INACTIVE"
    res = await client.post(f"{API}/stations/{sid}/activate", headers=admin_headers)
    assert res.status_code == 200 and res.json()["active"] is True


@pytest.mark.asyncio
async def test_worker_login_by_card_records_login_event(
    client: AsyncClient, station_key: tuple[str, str]
) -> None:
    sid, key = station_key
    worker = await ensure_user(uniq("t_w_").lower(), "WORKER", pin="1234", card=True)
    assert worker.card_code and worker.card_code.startswith("US-")
    res = await client.post(
        f"{API}/auth/worker", json={"card_code": worker.card_code}, headers={"X-Station-Key": key}
    )
    assert res.status_code == 200, res.text
    assert res.json()["worker"]["card_code"] == worker.card_code
    assert res.json()["login_via"] == "CARD"
    # 서버가 scan_event(action=LOGIN, payload.login_via) 를 직접 기록 (shopfloor ⑤)
    from app.db.models.scan import ScanEvent
    from app.db.session import SessionLocal

    async with SessionLocal() as s:
        ev = (
            (
                await s.execute(
                    select(ScanEvent)
                    .where(ScanEvent.worker_id == worker.id, ScanEvent.action == "LOGIN")
                    .order_by(ScanEvent.id.desc())
                )
            )
            .scalars()
            .first()
        )
    assert ev is not None and ev.station_id == sid and ev.payload["login_via"] == "CARD"
    # 단말 키 없이는 불가
    res = await client.post(f"{API}/auth/worker", json={"card_code": worker.card_code})
    assert res.status_code == 401
    # 없는 카드
    res = await client.post(
        f"{API}/auth/worker", json={"card_code": "US-9999"}, headers={"X-Station-Key": key}
    )
    assert res.status_code == 404 and res.json()["code"] == "USER_CARD_NOT_FOUND"


@pytest.mark.asyncio
async def test_worker_login_pin_rules(client: AsyncClient, station_key: tuple[str, str]) -> None:
    _, key = station_key
    h = {"X-Station-Key": key}
    # login_id + PIN 인데 카드 없음 → 409 CARD_REQUIRED
    nocard = await ensure_user(uniq("t_nc_").lower(), "WORKER", pin="1234", card=False)
    res = await client.post(
        f"{API}/auth/worker", json={"login_id": nocard.login_id, "pin": "1234"}, headers=h
    )
    assert res.status_code == 409 and res.json()["code"] == "CARD_REQUIRED"
    # SALES 는 단말 로그인 불가
    sales = await ensure_user(uniq("t_sl_").lower(), "SALES", pin="1234", card=True)
    res = await client.post(f"{API}/auth/worker", json={"card_code": sales.card_code}, headers=h)
    assert res.status_code == 403 and res.json()["code"] == "ROLE_NOT_ALLOWED"
    # 비활성
    inactive = await ensure_user(
        uniq("t_ia_").lower(), "WORKER", pin="1234", card=True, active=False
    )
    res = await client.post(f"{API}/auth/worker", json={"card_code": inactive.card_code}, headers=h)
    assert res.status_code == 403 and res.json()["code"] == "USER_INACTIVE"
    # login_id+PIN 정상 → login_via PIN
    w = await ensure_user(uniq("t_pin_").lower(), "MANAGER", pin="5678", card=True)
    res = await client.post(
        f"{API}/auth/worker", json={"login_id": w.login_id, "pin": "5678"}, headers=h
    )
    assert res.status_code == 200 and res.json()["login_via"] == "PIN"
    # PIN 4회 실패 → BAD_PIN, 5회째 → 429 PIN_LOCKED + Retry-After, 이후 맞는 PIN 도 잠김
    for i in range(4):
        res = await client.post(
            f"{API}/auth/worker", json={"login_id": w.login_id, "pin": "0000"}, headers=h
        )
        assert res.status_code == 401 and res.json()["code"] == "BAD_PIN", (i, res.text)
    res = await client.post(
        f"{API}/auth/worker", json={"login_id": w.login_id, "pin": "0000"}, headers=h
    )
    assert res.status_code == 429 and res.json()["code"] == "PIN_LOCKED"
    assert int(res.headers["Retry-After"]) > 0
    res = await client.post(
        f"{API}/auth/worker", json={"login_id": w.login_id, "pin": "5678"}, headers=h
    )
    assert res.status_code == 429
    # 카드 + PIN 병행도 검증된다 (잠긴 상태)
    res = await client.post(
        f"{API}/auth/worker", json={"card_code": w.card_code, "pin": "5678"}, headers=h
    )
    assert res.status_code == 429
    # 카드만 → PIN 검증 없이 OK (카드 분실 시에만 PIN)
    res = await client.post(f"{API}/auth/worker", json={"card_code": w.card_code}, headers=h)
    assert res.status_code == 200

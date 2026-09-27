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


# ---------------------------------------------------------------------------
# S0 수정 웨이브 (QA 반영): D26 PIN_NOT_SET · 잠금 범위 · D27 LOGIN_LOCKED · D28 login_id 정규화
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_pin_not_set_409_without_counting(
    client: AsyncClient, station_key: tuple[str, str]
) -> None:
    _, key = station_key
    h = {"X-Station-Key": key}
    w = await ensure_user(uniq("t_np_").lower(), "WORKER", pin=None, card=True)
    for _ in range(6):  # 6번 보내도 카운트·잠금 없음
        res = await client.post(
            f"{API}/auth/worker", json={"card_code": w.card_code, "pin": "1234"}, headers=h
        )
        assert res.status_code == 409 and res.json()["code"] == "PIN_NOT_SET", res.text
    from app.db.models.master import AppUser
    from app.db.session import SessionLocal

    async with SessionLocal() as s:
        u = await s.get(AppUser, w.id)
        assert u is not None and u.pin_failed_count == 0 and u.pin_locked_until is None
    # 카드만 → 200
    res = await client.post(f"{API}/auth/worker", json={"card_code": w.card_code}, headers=h)
    assert res.status_code == 200


@pytest.mark.asyncio
async def test_pin_lock_scope_card_only_allowed_and_set_pin_resets(
    client: AsyncClient, station_key: tuple[str, str], admin_headers: dict[str, str]
) -> None:
    _, key = station_key
    h = {"X-Station-Key": key}
    w = await ensure_user(uniq("t_lk_").lower(), "WORKER", pin="1111", card=True)
    for _ in range(5):
        await client.post(
            f"{API}/auth/worker", json={"card_code": w.card_code, "pin": "0000"}, headers=h
        )
    res = await client.post(
        f"{API}/auth/worker", json={"card_code": w.card_code, "pin": "1111"}, headers=h
    )
    assert res.status_code == 429 and res.json()["code"] == "PIN_LOCKED"
    # 잠금 중 카드 단독 로그인은 허용 (D26, DEF-QA1-004 고정)
    res = await client.post(f"{API}/auth/worker", json={"card_code": w.card_code}, headers=h)
    assert res.status_code == 200 and res.json()["login_via"] == "CARD"
    # 관리자 웹 로그인은 PIN 잠금과 무관 (분리 카운터)
    await ensure_user(w.login_id, "WORKER", password=TEST_ADMIN_PASSWORD, pin="1111", card=True)
    # ensure_user 가 pin 카운터를 리셋하므로 다시 잠근다
    for _ in range(5):
        await client.post(
            f"{API}/auth/worker", json={"card_code": w.card_code, "pin": "0000"}, headers=h
        )
    res = await client.post(
        f"{API}/auth/login", json={"login_id": w.login_id, "password": TEST_ADMIN_PASSWORD}
    )
    assert res.status_code == 200
    # set-pin 성공 → 카운터·잠금 리셋 (§14.1)
    res = await client.post(
        f"{API}/users/{w.id}/set-pin", headers=admin_headers, json={"pin": "2222"}
    )
    assert res.status_code == 200
    res = await client.post(
        f"{API}/auth/worker", json={"card_code": w.card_code, "pin": "2222"}, headers=h
    )
    assert res.status_code == 200 and res.json()["login_via"] == "CARD"


@pytest.mark.asyncio
async def test_admin_login_lock_5_per_15min(client: AsyncClient) -> None:
    login = uniq("t_ll_").lower()
    await ensure_user(login, "MANAGER", password=TEST_ADMIN_PASSWORD)
    for i in range(4):
        res = await client.post(
            f"{API}/auth/login", json={"login_id": login, "password": "Wrong1234"}
        )
        assert res.status_code == 401 and res.json()["code"] == "BAD_CREDENTIALS", i
    res = await client.post(f"{API}/auth/login", json={"login_id": login, "password": "Wrong1234"})
    assert res.status_code == 429 and res.json()["code"] == "LOGIN_LOCKED"
    assert int(res.headers["Retry-After"]) > 0
    # 잠금 중에는 올바른 비밀번호도 429
    res = await client.post(
        f"{API}/auth/login", json={"login_id": login, "password": TEST_ADMIN_PASSWORD}
    )
    assert res.status_code == 429
    # 없는 ID 는 카운터 없이 401
    res = await client.post(
        f"{API}/auth/login", json={"login_id": "no_such_user_x", "password": "x1234567"}
    )
    assert res.status_code == 401
    # login_id 정규화 (D28): 대문자·공백 → 소문자 trim 으로 같은 사용자
    from app.db.models.master import AppUser
    from app.db.session import SessionLocal

    async with SessionLocal() as s:
        from sqlalchemy import select

        u = (await s.execute(select(AppUser).where(AppUser.login_id == login))).scalar_one()
        u.login_locked_until = None
        u.login_failed_count = 0
        await s.commit()
    res = await client.post(
        f"{API}/auth/login",
        json={"login_id": f"  {login.upper()} ", "password": TEST_ADMIN_PASSWORD},
    )
    assert res.status_code == 200 and res.json()["user"]["login_id"] == login


@pytest.mark.asyncio
async def test_openapi_declares_security_schemes(client: AsyncClient) -> None:
    doc = (await client.get("/openapi.json")).json()
    assert set(doc["components"]["securitySchemes"]) == {"BearerJWT", "StationKey"}
    assert doc["paths"]["/api/v1/auth/me"]["get"]["security"] == [{"BearerJWT": []}]
    worker = doc["paths"]["/api/v1/auth/worker"]["post"]
    assert {"StationKey": []} in worker["security"]
    assert "X-Station-Key" in [p["name"] for p in worker.get("parameters", [])]
    customers = doc["paths"]["/api/v1/customers"]["get"]
    assert {"BearerJWT": []} in customers["security"] and {"StationKey": []} in customers[
        "security"
    ]
    # JWT 전용 경로에 X-Station-Key 일반 파라미터 노출 없음 (DEF-QA1-002)
    assert "X-Station-Key" not in [
        p["name"] for p in doc["paths"]["/api/v1/auth/me"]["get"].get("parameters", [])
    ]


@pytest.mark.asyncio
async def test_health_time_is_kst_and_integrity_detail_masked(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    res = await client.get("/health")
    assert res.json()["time"].endswith("+09:00")  # DEF-QA2-007
    # 동시 같은 login_id 생성 → IntegrityError 핸들러 경로: detail 에 DB 원문 없음 (DEF-QA2-008)
    import asyncio

    login = uniq("t_race_").lower()
    body = {"login_id": login, "name": "x", "role": "VIEWER"}
    results = await asyncio.gather(
        *(client.post(f"{API}/users", headers=admin_headers, json=body) for _ in range(4))
    )
    codes = sorted(r.status_code for r in results)
    assert codes[0] == 201 and set(codes[1:]) == {409}
    for r in results:
        if r.status_code == 409:
            assert r.json()["code"] == "DUPLICATE_CODE" and r.json()["detail"] == []
            assert "constraint" not in r.text

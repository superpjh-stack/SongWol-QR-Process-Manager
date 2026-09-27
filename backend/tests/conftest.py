"""테스트 공통.

- 테스트 DB 는 ``songwol_qr_test`` (DATABASE_URL 의 DB 이름 뒤에 ``_test``). 없으면 만든다.
- 세션 시작 시 ``alembic upgrade head → downgrade base → upgrade head`` 왕복을 실제로 돌린다
  (S0-2 완료 조건). 실패는 그대로 올린다.
- 앱 모듈(app.db.session 등)은 DATABASE_URL 을 바꾼 뒤에 import 되어야 하므로
  여기서 먼저 환경을 세팅한다.
"""

import asyncio
import os
import subprocess
import sys
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))


def _load_dotenv_fallback() -> None:
    """환경변수에 DATABASE_URL 이 없으면 저장소 .env 에서 읽는다 (pydantic-settings 순서)."""
    if os.environ.get("DATABASE_URL"):
        return
    for candidate in (BACKEND_DIR.parent / ".env", BACKEND_DIR / ".env"):
        if candidate.is_file():
            for line in candidate.read_text().splitlines():
                if line.startswith("DATABASE_URL="):
                    os.environ["DATABASE_URL"] = line.split("=", 1)[1].strip()
                    return


def _test_database_url() -> str:
    _load_dotenv_fallback()
    base = os.environ.get("DATABASE_URL") or "postgresql+asyncpg://localhost:5432/songwol_qr"
    if base.endswith("_test"):
        return base
    head, _, dbname = base.rpartition("/")
    dbname = dbname.split("?")[0]
    return f"{head}/{dbname}_test"


TEST_DATABASE_URL = _test_database_url()
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")
os.environ.setdefault("CHECKCODE_SECRET", "test-checkcode-secret")
os.environ.pop("CHECKCODE_SECRET_PREV", None)


def _asyncpg_dsn(url: str) -> str:
    return url.replace("postgresql+asyncpg://", "postgresql://", 1)


async def _ensure_database() -> None:
    import asyncpg

    dsn = _asyncpg_dsn(TEST_DATABASE_URL)
    head, _, dbname = dsn.rpartition("/")
    admin = await asyncpg.connect(f"{head}/postgres")
    try:
        exists = await admin.fetchval("SELECT 1 FROM pg_database WHERE datname = $1", dbname)
        if not exists:
            await admin.execute(f'CREATE DATABASE "{dbname}"')
    finally:
        await admin.close()


def _alembic(*args: str) -> None:
    proc = subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND_DIR,
        env={**os.environ, "DATABASE_URL": TEST_DATABASE_URL},
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"alembic {' '.join(args)} failed:\n{proc.stdout}\n{proc.stderr}")


@pytest.fixture(scope="session", autouse=True)
def migrated_db() -> str:
    asyncio.run(_ensure_database())
    _alembic("upgrade", "head")
    _alembic("downgrade", "base")
    _alembic("upgrade", "head")
    return TEST_DATABASE_URL


@pytest.fixture(autouse=True)
async def _dispose_engine_per_test() -> AsyncIterator[None]:
    """pytest-asyncio 는 테스트마다 이벤트 루프를 새로 만든다.

    전역 엔진의 풀 연결이 이전 루프에 묶여 있으면 'Event loop is closed' 가 나므로
    테스트마다 풀을 비운다.
    """
    yield
    from app.db.session import engine

    await engine.dispose()


# ---------------------------------------------------------------------------
# S0-3 / S0-5 / S0-6 공통 픽스처: HTTP 클라이언트 · 관리자 JWT · 단말 키 · 품목군
# ---------------------------------------------------------------------------
import uuid  # noqa: E402
from typing import Any  # noqa: E402

from httpx import ASGITransport, AsyncClient  # noqa: E402

TEST_ADMIN_LOGIN = "t_admin"
TEST_ADMIN_PASSWORD = "Admin1234x"  # 정책: 8자+영문+숫자


def uniq(prefix: str, n: int = 6) -> str:
    return f"{prefix}{uuid.uuid4().hex[:n].upper()}"


async def ensure_user(
    login_id: str,
    role: str,
    *,
    password: str | None = None,
    pin: str | None = None,
    card: bool = False,
    active: bool = True,
) -> Any:
    """테스트용 사용자 upsert (ORM 직접). 카드는 US 채번."""
    from sqlalchemy import select

    from app.core.hashing import hash_secret
    from app.core.sequence import next_code
    from app.db.models.master import AppUser
    from app.db.session import SessionLocal

    async with SessionLocal() as s:
        u = (
            await s.execute(select(AppUser).where(AppUser.login_id == login_id))
        ).scalar_one_or_none()
        if u is None:
            u = AppUser(login_id=login_id, name=login_id, role=role)
            s.add(u)
        u.role = role
        u.active = active
        u.password_hash = hash_secret(password) if password else None
        u.pin_hash = hash_secret(pin) if pin else None
        u.pin_failed_count = 0
        u.pin_locked_until = None
        if card and not u.card_code:
            u.card_code = await next_code(s, "US")
        await s.commit()
        await s.refresh(u)
        return u


async def ensure_station(
    station_id: str, *, type_: str = "KIOSK", process_code: str | None = "P30"
) -> tuple[str, str]:
    """(station_id, api_key). 이미 있으면 키를 회전해 새 키를 돌려준다."""
    from app.core.apikey import api_key_prefix, generate_api_key, hash_api_key
    from app.db.models.master import Station
    from app.db.session import SessionLocal

    key = generate_api_key()
    async with SessionLocal() as s:
        st = await s.get(Station, station_id)
        if st is None:
            st = Station(id=station_id, type=type_, process_code=process_code)
            s.add(st)
        st.active = True
        st.api_key_hash = hash_api_key(key)
        st.api_key_prefix = api_key_prefix(key)
        await s.commit()
    return station_id, key


async def ensure_item_group(code: str, name: str | None = None) -> str:
    from app.db.models.master import ItemGroup
    from app.db.session import SessionLocal

    async with SessionLocal() as s:
        if await s.get(ItemGroup, code) is None:
            s.add(ItemGroup(code=code, name=name or code))
            await s.commit()
    return code


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
async def admin_headers(client: AsyncClient) -> dict[str, str]:
    await ensure_user(TEST_ADMIN_LOGIN, "ADMIN", password=TEST_ADMIN_PASSWORD)
    res = await client.post(
        "/api/v1/auth/login", json={"login_id": TEST_ADMIN_LOGIN, "password": TEST_ADMIN_PASSWORD}
    )
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def headers_for(client: AsyncClient, login_id: str, role: str) -> dict[str, str]:
    await ensure_user(login_id, role, password=TEST_ADMIN_PASSWORD)
    res = await client.post(
        "/api/v1/auth/login", json={"login_id": login_id, "password": TEST_ADMIN_PASSWORD}
    )
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


@pytest.fixture
async def station_key() -> tuple[str, str]:
    return await ensure_station("T-K-P30-1")


@pytest.fixture
async def item_group() -> str:
    return await ensure_item_group("T_TOWEL_40", "테스트 40수")

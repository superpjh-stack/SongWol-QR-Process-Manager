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

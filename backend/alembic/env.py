"""Alembic async env (asyncpg).

- DB URL: ``app.core.config.Settings.database_url`` (.env / 환경변수)
- 대상 메타데이터: ``app.db.base.Base.metadata`` (schema ``mes``)
- 모델이 import 되어야 autogenerate 가 감지한다. 도메인 모델이 생기면 아래 import 블록에 추가.
"""

import asyncio
import re
from logging.config import fileConfig

from sqlalchemy import Connection, pool, text
from sqlalchemy.ext.asyncio import async_engine_from_config

# --- 모델 import (autogenerate 감지용): app.db.models 가 전 도메인 모듈을 export 한다 ---
import app.db.models  # noqa: F401
from alembic import context
from app.core.config import get_settings
from app.db.base import SCHEMA, Base

_PARTITION_RE = re.compile(r"scan_event_\d{6}")

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", get_settings().database_url)
target_metadata = Base.metadata


def _include_name(name: str | None, type_: str, parent_names: dict[str, str | None]) -> bool:
    # mes 스키마만 관리한다 (같은 DB 서버를 다른 시스템과 공유하므로).
    if type_ == "schema":
        return name == SCHEMA
    # scan_event 월 파티션(scan_event_YYYYMM)은 모델이 아니라 스크립트가 만든다 → 비교 대상에서 제외
    if type_ == "table" and name is not None and _PARTITION_RE.fullmatch(name):
        return False
    return True


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_schemas=True,
        include_name=_include_name,
        version_table_schema=SCHEMA,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    # alembic_version 테이블이 mes 스키마에 있으므로 첫 실행 전에 스키마가 있어야 한다
    # (progress.md 재현 사실). 0001_master 도 같은 문장을 실행한다 (멱등).
    # 별도 트랜잭션으로 커밋한다 — autobegin 된 트랜잭션이 남아 있으면 begin_transaction() 이
    # 새 트랜잭션을 열지 않아 마이그레이션 전체가 커밋되지 않는다.
    connection.execute(text(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}"))
    connection.commit()
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_schemas=True,
        include_name=_include_name,
        version_table_schema=SCHEMA,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

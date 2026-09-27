"""Alembic async env (asyncpg).

- DB URL: ``app.core.config.Settings.database_url`` (.env / 환경변수)
- 대상 메타데이터: ``app.db.base.Base.metadata`` (schema ``mes``)
- 모델이 import 되어야 autogenerate 가 감지한다. 도메인 모델이 생기면 아래 import 블록에 추가.
"""

import asyncio
from logging.config import fileConfig

from sqlalchemy import Connection, pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context
from app.core.config import get_settings
from app.db.base import SCHEMA, Base

# --- 모델 import (autogenerate 감지용). 다음 웨이브에서 채운다 ---
# from app.domain.master import models  # noqa: F401

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", get_settings().database_url)
target_metadata = Base.metadata


def _include_name(name: str | None, type_: str, parent_names: dict[str, str | None]) -> bool:
    # mes 스키마만 관리한다 (같은 DB 서버를 다른 시스템과 공유하므로).
    if type_ == "schema":
        return name == SCHEMA
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

"""시드 기준정보 (db-schema §10). 멱등(UPSERT). 실행: ``python -m app.db.seed [--dev-stations]``.

- process 5행 · print_method 6행: 값이 바뀌었으면 갱신 (ON CONFLICT DO UPDATE).
- admin: 없으면 생성. ``SEED_ADMIN_PASSWORD`` 가 있으면 password_hash 를 그 값으로 갱신,
  없으면 건드리지 않는다.
- ``--dev-item-groups``: 품목군 개발 시드 TOWEL_40 · TOWEL_50 (미결 U-1, db-schema §14.1).
  운영 DB 에는 쓰지 않는다.
- ``--dev-stations``: 개발 station 6대. **새로 만드는 단말만** API key 를 생성해 stdout 에
  1회 출력한다 (이미 있는 단말의 key 는 바꾸지 않는다 — 회전은 A1-07 화면/API 몫).
- item_routing 시드는 넣지 않는다 (spec §4.2 는 [확인] 제안값 → 운영은 A1-11 엑셀 등록).
- code_sequence 시드 없음 (US 행은 첫 카드 발급 때 생성).

실패는 예외 그대로 올린다 (조용한 실패 금지).
"""

import argparse
import asyncio
import sys
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.apikey import api_key_prefix, generate_api_key, hash_api_key
from app.core.config import get_settings
from app.core.hashing import hash_secret
from app.db.models.master import AppUser, ItemGroup, PrintMethod, Process, Station
from app.db.seed_data import (
    ADMIN_LOGIN_ID,
    ADMIN_ROLE,
    DEV_ITEM_GROUP_ROWS,
    DEV_STATION_ROWS,
    PRINT_METHOD_ROWS,
    PROCESS_ROWS,
    as_dicts,
)


@dataclass
class SeedResult:
    process: int = 0
    print_method: int = 0
    admin: str = ""
    stations_created: list[tuple[str, str]] = field(default_factory=list)  # (id, api_key)
    stations_existing: list[str] = field(default_factory=list)
    item_groups: int = 0


async def seed_process(session: AsyncSession) -> int:
    stmt = pg_insert(Process).values(as_dicts(PROCESS_ROWS))
    stmt = stmt.on_conflict_do_update(
        index_elements=["code"],
        set_={
            "name": stmt.excluded.name,
            "seq": stmt.excluded.seq,
            "requires_equipment": stmt.excluded.requires_equipment,
            "required_inputs": stmt.excluded.required_inputs,
        },
    )
    await session.execute(stmt)
    return len(PROCESS_ROWS)


async def seed_print_method(session: AsyncSession) -> int:
    stmt = pg_insert(PrintMethod).values(as_dicts(PRINT_METHOD_ROWS))
    stmt = stmt.on_conflict_do_update(
        index_elements=["code"],
        set_={
            "name": stmt.excluded.name,
            "equip_types": stmt.excluded.equip_types,
            "skips_p30": stmt.excluded.skips_p30,
        },
    )
    await session.execute(stmt)
    return len(PRINT_METHOD_ROWS)


async def seed_admin(session: AsyncSession, password: str | None) -> str:
    """'created' | 'password-updated' | 'unchanged'."""
    existing = (
        await session.execute(select(AppUser).where(AppUser.login_id == ADMIN_LOGIN_ID))
    ).scalar_one_or_none()
    if existing is None:
        session.add(
            AppUser(
                login_id=ADMIN_LOGIN_ID,
                name=ADMIN_LOGIN_ID,
                role=ADMIN_ROLE,
                password_hash=hash_secret(password) if password else None,
            )
        )
        return "created"
    if password:
        existing.password_hash = hash_secret(password)
        return "password-updated"
    return "unchanged"


async def seed_dev_item_groups(session: AsyncSession) -> int:
    stmt = pg_insert(ItemGroup).values(DEV_ITEM_GROUP_ROWS)
    stmt = stmt.on_conflict_do_update(index_elements=["code"], set_={"name": stmt.excluded.name})
    await session.execute(stmt)
    return len(DEV_ITEM_GROUP_ROWS)


async def seed_dev_stations(session: AsyncSession, result: SeedResult) -> None:
    ids = [r["id"] for r in DEV_STATION_ROWS]
    existing = set(
        (await session.execute(select(Station.id).where(Station.id.in_(ids)))).scalars().all()
    )
    for row in DEV_STATION_ROWS:
        if row["id"] in existing:
            result.stations_existing.append(row["id"])
            continue
        key = generate_api_key()
        session.add(
            Station(
                id=row["id"],
                type=row["type"],
                process_code=row["process_code"],
                location=row["location"],
                api_key_hash=hash_api_key(key),
                api_key_prefix=api_key_prefix(key),
            )
        )
        result.stations_created.append((row["id"], key))


async def run_seed(
    session: AsyncSession, *, dev_stations: bool, dev_item_groups: bool = False
) -> SeedResult:
    result = SeedResult()
    result.process = await seed_process(session)
    result.print_method = await seed_print_method(session)
    result.admin = await seed_admin(session, get_settings().seed_admin_password)
    if dev_item_groups:
        result.item_groups = await seed_dev_item_groups(session)
    if dev_stations:
        await seed_dev_stations(session, result)
    await session.commit()
    return result


async def _main(dev_stations: bool, dev_item_groups: bool) -> int:
    from app.db.session import SessionLocal, engine

    try:
        async with SessionLocal() as session:
            result = await run_seed(
                session, dev_stations=dev_stations, dev_item_groups=dev_item_groups
            )
    finally:
        await engine.dispose()

    print(f"process: {result.process} rows upserted")
    print(f"print_method: {result.print_method} rows upserted")
    print(f"admin: {result.admin}")
    if result.admin == "created" and not get_settings().seed_admin_password:
        print("  (SEED_ADMIN_PASSWORD 미설정 — admin 은 로그인 불가. 설정 후 다시 실행하면 갱신)")
    if dev_item_groups:
        print(f"item_group (dev): {result.item_groups} rows upserted")
    if dev_stations:
        for sid in result.stations_existing:
            print(f"station {sid}: exists (api key unchanged)")
        for sid, key in result.stations_created:
            print(f"station {sid}: created  API_KEY={key}   <- 지금 한 번만 보인다")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="db-schema §10 시드 (멱등)")
    ap.add_argument(
        "--dev-stations",
        action="store_true",
        help="개발용 station 6대도 만든다 (운영 DB 에는 쓰지 않는다)",
    )
    ap.add_argument(
        "--dev-item-groups",
        action="store_true",
        help="품목군 개발 시드 TOWEL_40·TOWEL_50 (미결 U-1. 운영 DB 에는 쓰지 않는다)",
    )
    args = ap.parse_args(argv)
    return asyncio.run(_main(args.dev_stations, args.dev_item_groups))


if __name__ == "__main__":
    sys.exit(main())

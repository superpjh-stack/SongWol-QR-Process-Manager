#!/usr/bin/env python3
"""scan_event 월 파티션 생성 (plan §5.1: pg_partman 미사용, 스크립트로 생성. db-schema §4.1).

사용법:
    python infra/scripts/create_partitions.py --months-ahead 3 [--database-url ...] [--dry-run]

동작:
    이번 달(Asia/Seoul 기준)부터 ``--months-ahead`` 개월 뒤까지(= months_ahead + 1 개), 없는 파티션을
    ``mes.scan_event_YYYYMM PARTITION OF mes.scan_event
      FOR VALUES FROM ('YYYY-MM-01 00:00+09') TO ('next-01 00:00+09')``
    로 만든다 (``CREATE TABLE IF NOT EXISTS`` — 이미 있으면 건너뛴다). prod 에서는 cron 으로 월 1회 실행한다.
    DEFAULT 파티션은 만들지 않는다: 파티션 누락은 INSERT 실패로 드러나야 한다 (조용한 실패 금지).

전제: mes.scan_event 가 ``PARTITION BY RANGE (received_at)`` 로 만들어져 있어야 한다 (Alembic 0003).
Alembic 0003 은 이 파일의 ``partition_statements()`` 를 import 해 초기 파티션을 만든다 (로직 중복 금지).

DB 접속은 asyncpg (backend venv 에 있음). ``--database-url`` 은 ``postgresql://`` 와
``postgresql+asyncpg://`` (backend .env 의 DATABASE_URL) 둘 다 받는다.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

SCHEMA = "mes"
TABLE = "scan_event"
TZ_SEOUL = ZoneInfo("Asia/Seoul")
# db-schema §4.1: 파티션 경계는 Asia/Seoul 자정 ('YYYY-MM-01 00:00+09')
BOUNDARY_SUFFIX = " 00:00+09"


def month_ranges(start_year: int, start_month: int, count: int) -> list[tuple[str, str, str]]:
    """(파티션 접미사 YYYYMM, from 'YYYY-MM-01', to 'YYYY-MM-01') 목록."""
    out: list[tuple[str, str, str]] = []
    y, m = start_year, start_month
    for _ in range(count):
        ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
        out.append((f"{y:04d}{m:02d}", f"{y:04d}-{m:02d}-01", f"{ny:04d}-{nm:02d}-01"))
        y, m = ny, nm
    return out


def partition_name(suffix: str) -> str:
    return f"{TABLE}_{suffix}"


def partition_statements(start_year: int, start_month: int, count: int) -> list[tuple[str, str]]:
    """(파티션 이름, CREATE TABLE IF NOT EXISTS … SQL) 목록. Alembic 0003 과 이 스크립트가 같이 쓴다."""
    stmts: list[tuple[str, str]] = []
    for suffix, d_from, d_to in month_ranges(start_year, start_month, count):
        name = partition_name(suffix)
        sql = (
            f"CREATE TABLE IF NOT EXISTS {SCHEMA}.{name} PARTITION OF {SCHEMA}.{TABLE} "
            f"FOR VALUES FROM ('{d_from}{BOUNDARY_SUFFIX}') TO ('{d_to}{BOUNDARY_SUFFIX}')"
        )
        stmts.append((name, sql))
    return stmts


def current_month_seoul(now: datetime | None = None) -> tuple[int, int]:
    """이번 달 (Asia/Seoul 기준). now 는 tz-aware 여야 한다."""
    now = now or datetime.now(TZ_SEOUL)
    local = now.astimezone(TZ_SEOUL)
    return local.year, local.month


def statements_from_now(months_ahead: int, now: datetime | None = None) -> list[tuple[str, str]]:
    """이번 달 ~ months_ahead 개월 뒤까지 (months_ahead + 1 개)."""
    if months_ahead < 0:
        raise ValueError("months_ahead must be >= 0")
    y, m = current_month_seoul(now)
    return partition_statements(y, m, months_ahead + 1)


def to_asyncpg_dsn(url: str) -> str:
    """SQLAlchemy 형 URL (postgresql+asyncpg://) 을 asyncpg DSN 으로."""
    if url.startswith("postgresql+asyncpg://"):
        return "postgresql://" + url[len("postgresql+asyncpg://") :]
    return url


async def _run(dsn: str, stmts: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """각 파티션을 만들고 (이름, 'created' | 'exists') 를 돌려준다."""
    import asyncpg

    conn = await asyncpg.connect(dsn)
    try:
        parent = await conn.fetchval(
            "SELECT relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
            "WHERE n.nspname=$1 AND c.relname=$2",
            SCHEMA,
            TABLE,
        )
        if isinstance(parent, bytes):  # asyncpg 는 "char" 를 bytes 로 준다
            parent = parent.decode()
        if parent != "p":
            raise RuntimeError(
                f"{SCHEMA}.{TABLE} 이 파티션 부모 테이블이 아니거나 없다 (relkind={parent!r}). "
                "alembic upgrade head 를 먼저 실행한다."
            )
        results: list[tuple[str, str]] = []
        for name, sql in stmts:
            exists = await conn.fetchval("SELECT to_regclass($1) IS NOT NULL", f"{SCHEMA}.{name}")
            if exists:
                results.append((name, "exists"))
                continue
            await conn.execute(sql)
            results.append((name, "created"))
        return results
    finally:
        await conn.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "--months-ahead", type=int, default=3, help="이번 달부터 몇 개월 뒤까지 만들지 (기본 3 → 4개)"
    )
    ap.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL", ""),
        help="postgresql://... 또는 postgresql+asyncpg://... (기본 $DATABASE_URL)",
    )
    ap.add_argument("--dry-run", action="store_true", help="SQL 만 출력")
    args = ap.parse_args(argv)

    try:
        stmts = statements_from_now(args.months_ahead)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    if args.dry_run:
        for _, sql in stmts:
            print(sql + ";")
        return 0

    if not args.database_url:
        print("error: --database-url 또는 $DATABASE_URL 이 필요하다", file=sys.stderr)
        return 2

    try:
        results = asyncio.run(_run(to_asyncpg_dsn(args.database_url), stmts))
    except Exception as e:  # noqa: BLE001 — 실패는 그대로 보이고 exit 1
        print(f"error: {type(e).__name__}: {e}", file=sys.stderr)
        return 1

    created = sum(1 for _, r in results if r == "created")
    for name, r in results:
        print(f"{SCHEMA}.{name}: {r}")
    print(f"done: created {created}, existing {len(results) - created}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

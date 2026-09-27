#!/usr/bin/env python3
"""scan_event 월 파티션 생성 (plan §3: pg_partman 미사용, 스크립트로 생성).

사용법:
    python infra/scripts/create_partitions.py --months-ahead 3 [--database-url ...] [--dry-run]

동작(예정):
    이번 달부터 ``--months-ahead`` 개월 뒤까지, 없는 파티션을
    ``mes.scan_event_YYYYMM PARTITION OF mes.scan_event FOR VALUES FROM ('YYYY-MM-01') TO ('next-01')``
    로 만든다. 이미 있으면 건너뛴다. prod 에서는 cron 으로 월 1회 실행한다.

전제: mes.scan_event 가 ``PARTITION BY RANGE (scanned_at)`` 로 만들어져 있어야 한다 (scan 웨이브에서 생성).
"""

from __future__ import annotations

import argparse
import os
import sys


def month_ranges(start_year: int, start_month: int, count: int) -> list[tuple[str, str, str]]:
    """(파티션 접미사 YYYYMM, from 'YYYY-MM-01', to 'YYYY-MM-01') 목록."""
    out: list[tuple[str, str, str]] = []
    y, m = start_year, start_month
    for _ in range(count):
        ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
        out.append((f"{y:04d}{m:02d}", f"{y:04d}-{m:02d}-01", f"{ny:04d}-{nm:02d}-01"))
        y, m = ny, nm
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--months-ahead", type=int, default=3, help="이번 달 포함 생성할 개월 수")
    ap.add_argument("--database-url", default=os.environ.get("DATABASE_URL", ""), help="postgresql://... (기본 $DATABASE_URL)")
    ap.add_argument("--dry-run", action="store_true", help="SQL 만 출력")
    args = ap.parse_args(argv)

    # TODO(scan 웨이브): asyncpg/psycopg 로 접속해 month_ranges() 결과마다
    #   CREATE TABLE IF NOT EXISTS mes.scan_event_{suffix} PARTITION OF mes.scan_event
    #   FOR VALUES FROM ('{from}') TO ('{to}');
    # 를 실행한다. --dry-run 이면 출력만.
    print("TODO: not implemented (Phase 0 stub)", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())

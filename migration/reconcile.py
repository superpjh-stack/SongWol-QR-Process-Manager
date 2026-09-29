#!/usr/bin/env python3
"""재고 대사 보고서 (spec §12.5, plan §5.3).

기준: 품목별 **실사 재고 = 신규 재고**(시스템 DB `mes.stock`). IMS 재고현황 엑셀은 참고값일
뿐이며 불일치는 차이만 기록하고 실사를 따른다(§12.5 "롤백" 조건도 이 기준을 따른다).

입력 파일은 IMS 원본 형식을 몰라도 되게, 이미 정리된 CSV 두 컬럼짜리다(M4 클렌징 이후 산출물):
    item_code,qty

사용법:
    python migration/reconcile.py <실사.csv> [--ims <IMS재고.csv>] [--out <결과.csv>]

DB 접속은 $DATABASE_URL (postgresql+asyncpg://... 또는 postgresql://...) 을 쓴다.
의존: asyncpg (backend/.venv 에 이미 설치됨 — profile.py 와 같은 방식으로 그 venv 로 실행한다).
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import os
import sys
from pathlib import Path

import asyncpg


def to_asyncpg_dsn(url: str) -> str:
    return url.replace("postgresql+asyncpg://", "postgresql://", 1)


def load_qty_csv(path: Path) -> dict[str, float]:
    """`item_code,qty` 2컬럼 CSV → {item_code: qty}. 헤더 유무 모두 허용(숫자로 안 읽히면 헤더로 간주)."""
    out: dict[str, float] = {}
    with path.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.reader(f):
            if len(row) < 2:
                continue
            code, raw_qty = row[0].strip(), row[1].strip()
            if not code:
                continue
            try:
                out[code] = float(raw_qty)
            except ValueError:
                continue  # 헤더 행
    return out


async def fetch_system_stock(dsn: str) -> dict[str, float]:
    conn = await asyncpg.connect(dsn)
    try:
        rows = await conn.fetch(
            "SELECT i.code, s.qty_on_hand FROM mes.stock s JOIN mes.item i ON i.id = s.item_id"
        )
        return {r["code"]: float(r["qty_on_hand"]) for r in rows}
    finally:
        await conn.close()


def build_report(
    counted: dict[str, float], system: dict[str, float], ims: dict[str, float] | None
) -> list[dict[str, object]]:
    codes = sorted(set(counted) | set(system) | set(ims or {}))
    rows: list[dict[str, object]] = []
    for code in codes:
        c = counted.get(code)
        s = system.get(code)
        i = (ims or {}).get(code)
        match = c is not None and s is not None and c == s
        rows.append(
            {
                "item_code": code,
                "counted_qty": c,
                "system_qty": s,
                "ims_qty": i,
                "counted_minus_system": None if c is None or s is None else c - s,
                "match": match,
                "note": (
                    "실사 없음" if c is None else "신규 재고 없음(품목 미등록?)" if s is None else ("일치" if match else "불일치")
                ),
            }
        )
    return rows


def print_report(rows: list[dict[str, object]]) -> None:
    total = len(rows)
    matched = sum(1 for r in rows if r["match"])
    mismatched = [r for r in rows if not r["match"]]
    print(f"# 재고 대사 보고서 — 총 {total}개 품목, 일치 {matched}, 불일치 {len(mismatched)}")
    print()
    if not mismatched:
        print("모든 품목이 실사 = 신규 재고로 일치한다. 컷오버(M8) 진행 가능.")
        return
    print("불일치 목록 (실사 기준으로 신규 재고를 조정해야 한다):")
    print(f"{'품목코드':<16}{'실사':>10}{'신규재고':>10}{'차이':>10}{'IMS참고':>10}  비고")
    for r in mismatched:
        c = "-" if r["counted_qty"] is None else f"{r['counted_qty']:.0f}"
        s = "-" if r["system_qty"] is None else f"{r['system_qty']:.0f}"
        d = "-" if r["counted_minus_system"] is None else f"{r['counted_minus_system']:+.0f}"
        i = "-" if r["ims_qty"] is None else f"{r['ims_qty']:.0f}"
        print(f"{r['item_code']:<16}{c:>10}{s:>10}{d:>10}{i:>10}  {r['note']}")


def write_csv(rows: list[dict[str, object]], out: Path) -> None:
    with out.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(
            f,
            fieldnames=["item_code", "counted_qty", "system_qty", "ims_qty", "counted_minus_system", "match", "note"],
        )
        w.writeheader()
        w.writerows(rows)


async def _main_async(args: argparse.Namespace) -> int:
    dsn = args.database_url or os.environ.get("DATABASE_URL", "")
    if not dsn:
        print("error: --database-url 또는 $DATABASE_URL 이 필요하다", file=sys.stderr)
        return 2

    counted = load_qty_csv(args.counted)
    ims = load_qty_csv(args.ims) if args.ims else None
    system = await fetch_system_stock(to_asyncpg_dsn(dsn))

    rows = build_report(counted, system, ims)
    print_report(rows)
    if args.out:
        write_csv(rows, args.out)
        print(f"\n결과를 {args.out} 에 저장했다.")

    return 0 if all(r["match"] for r in rows) else 1


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("counted", type=Path, help="실사 결과 CSV (item_code,qty)")
    ap.add_argument("--ims", type=Path, default=None, help="IMS 재고현황 CSV — 참고용, 없어도 된다")
    ap.add_argument("--out", type=Path, default=None, help="전체 대사 결과를 CSV 로 저장할 경로")
    ap.add_argument("--database-url", default=None, help="기본 $DATABASE_URL")
    args = ap.parse_args(argv)

    if not args.counted.exists():
        print(f"파일 없음: {args.counted}", file=sys.stderr)
        return 2
    if args.ims and not args.ims.exists():
        print(f"파일 없음: {args.ims}", file=sys.stderr)
        return 2

    return asyncio.run(_main_async(args))


if __name__ == "__main__":
    sys.exit(main())

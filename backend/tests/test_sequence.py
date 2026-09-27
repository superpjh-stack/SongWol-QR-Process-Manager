"""채번 (plan §5.1 · S0-4): 동시 100건 중복 0, 일자 경계 Asia/Seoul, 5자리 확장, 하위 WO 접미사."""

import asyncio
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import delete, select

from app.core.sequence import US_SEQ_DATE, next_code, seq_date_for, split_code
from app.db.models.master import CodeSequence
from app.db.session import SessionLocal

# 실제 날짜와 겹치지 않는 고정 시각으로 격리한다 (Asia/Seoul 2000-01-15)
FIXED_NOW = datetime(2000, 1, 15, 3, 0, tzinfo=UTC)


async def _reset(prefix: str, seq_date: date) -> None:
    async with SessionLocal() as s:
        await s.execute(
            delete(CodeSequence).where(
                CodeSequence.prefix == prefix, CodeSequence.seq_date == seq_date
            )
        )
        await s.commit()


async def _last_no(prefix: str, seq_date: date) -> int | None:
    async with SessionLocal() as s:
        return (
            await s.execute(
                select(CodeSequence.last_no).where(
                    CodeSequence.prefix == prefix, CodeSequence.seq_date == seq_date
                )
            )
        ).scalar_one_or_none()


@pytest.mark.asyncio
async def test_concurrent_100_codes_no_duplicates() -> None:
    """100 코루틴이 각각 별도 세션·트랜잭션으로 채번 → 중복 0, 1~100 연속."""
    await _reset("WO", date(2000, 1, 15))

    async def one() -> str:
        async with SessionLocal() as s:
            async with s.begin():
                return await next_code(s, "WO", now=FIXED_NOW)

    codes = await asyncio.gather(*(one() for _ in range(100)))
    assert len(codes) == 100
    assert len(set(codes)) == 100, "duplicate codes issued"
    numbers = sorted(int(c.rsplit("-", 1)[1]) for c in codes)
    assert numbers == list(range(1, 101))
    assert all(c.startswith("WO-000115-") for c in codes)
    assert await _last_no("WO", date(2000, 1, 15)) == 100


@pytest.mark.asyncio
async def test_day_boundary_is_asia_seoul() -> None:
    await _reset("SO", date(2000, 1, 15))
    await _reset("SO", date(2000, 1, 16))
    before = datetime(2000, 1, 15, 14, 59, 59, tzinfo=UTC)  # KST 23:59:59
    after = datetime(2000, 1, 15, 15, 0, 0, tzinfo=UTC)  # KST 다음날 00:00:00
    assert seq_date_for("SO", before) == date(2000, 1, 15)
    assert seq_date_for("SO", after) == date(2000, 1, 16)
    async with SessionLocal() as s:
        async with s.begin():
            c1 = await next_code(s, "SO", now=before)
            c2 = await next_code(s, "SO", now=after)
            c3 = await next_code(s, "SO", now=after)
    assert c1 == "SO-000115-0001"
    assert c2 == "SO-000116-0001"
    assert c3 == "SO-000116-0002"


@pytest.mark.asyncio
async def test_expands_to_five_digits_after_9999() -> None:
    await _reset("LT", date(2000, 1, 15))
    async with SessionLocal() as s:
        async with s.begin():
            s.add(CodeSequence(prefix="LT", seq_date=date(2000, 1, 15), last_no=9998))
    async with SessionLocal() as s:
        async with s.begin():
            a = await next_code(s, "LT", now=FIXED_NOW)
            b = await next_code(s, "LT", now=FIXED_NOW)
            c = await next_code(s, "LT", now=FIXED_NOW)
    assert (a, b, c) == ("LT-000115-9999", "LT-000115-10000", "LT-000115-10001")


@pytest.mark.asyncio
async def test_us_prefix_ignores_date() -> None:
    await _reset("US", US_SEQ_DATE)
    async with SessionLocal() as s:
        async with s.begin():
            a = await next_code(s, "US", now=FIXED_NOW)
            b = await next_code(s, "US", now=datetime(2030, 6, 1, tzinfo=UTC))
    assert (a, b) == ("US-0001", "US-0002")
    assert await _last_no("US", US_SEQ_DATE) == 2


def test_split_code_suffixes() -> None:
    assert split_code("WO-260907-0012", []) == "WO-260907-0012-A"
    assert split_code("WO-260907-0012", ["A"]) == "WO-260907-0012-B"
    assert split_code("WO-260907-0012", {"A", "C"}) == "WO-260907-0012-D"  # 재사용 없음
    assert split_code("WO-260907-10000", ["A"]) == "WO-260907-10000-B"
    all_26 = [chr(ord("A") + i) for i in range(26)]
    assert split_code("WO-260907-0012", all_26[:25]) == "WO-260907-0012-Z"
    with pytest.raises(ValueError, match="split limit"):
        split_code("WO-260907-0012", all_26)
    with pytest.raises(ValueError, match="not a parent"):
        split_code("WO-260907-0012-A", [])
    with pytest.raises(ValueError, match="not a parent"):
        split_code("SO-260907-0012", [])
    with pytest.raises(ValueError, match="invalid split suffix"):
        split_code("WO-260907-0012", ["a"])

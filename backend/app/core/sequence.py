"""코드 채번 (spec §2.1, plan §5.1, db-schema §2.12).

- ``code_sequence(prefix, seq_date, last_no)`` 행을 ``SELECT … FOR UPDATE`` 로 잠그고 1 증가한다.
  행이 없으면 먼저 ``INSERT … ON CONFLICT DO NOTHING`` 으로 만든다 (첫 채번 경쟁도 안전).
- 일자 경계는 Asia/Seoul (spec §13). 코드 = ``{prefix}-{YYMMDD}-{NNNN}``, 9999 초과 시 5자리.
- ``US`` 는 일자 무관: seq_date = 1970-01-01 고정 행, 코드 = ``US-{NNNN}``
  (db-schema §12-9, spec §6).
- 하위 WO 접미사 ``-A``~``-Z`` 는 ``split_code()`` (spec §2.1: 최대 26개, 병합 금지).

잠금은 호출자의 트랜잭션이 끝날 때까지 유지되므로 채번은 짧은 트랜잭션 안에서 한다.
"""

import re
from datetime import UTC, date, datetime
from typing import Literal
from zoneinfo import ZoneInfo

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.master import CodeSequence

Prefix = Literal["SO", "WO", "LT", "US"]

TZ_SEOUL = ZoneInfo("Asia/Seoul")
US_SEQ_DATE = date(1970, 1, 1)
SEQ_DIGITS = 4
MAX_SPLIT = 26

_DATED_CODE_RE = re.compile(r"^(SO|WO|LT)-(\d{6})-(\d{4,5})$")


def seq_date_for(prefix: Prefix, now: datetime | None = None) -> date:
    """채번 일자. tz-naive now 는 UTC 로 본다."""
    if prefix == "US":
        return US_SEQ_DATE
    now = now or datetime.now(UTC)
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)
    return now.astimezone(TZ_SEOUL).date()


def format_code(prefix: Prefix, seq_date: date, no: int) -> str:
    if no <= 0:
        raise ValueError(f"sequence number must be positive: {no}")
    number = f"{no:0{SEQ_DIGITS}d}"  # 9999 초과 시 자연히 5자리
    if prefix == "US":
        return f"US-{number}"
    return f"{prefix}-{seq_date:%y%m%d}-{number}"


async def next_no(session: AsyncSession, prefix: Prefix, seq_date: date) -> int:
    """행을 잠그고 last_no 를 1 올린 값을 돌려준다. 호출자 트랜잭션 안에서 실행된다."""
    await session.execute(
        pg_insert(CodeSequence)
        .values(prefix=prefix, seq_date=seq_date, last_no=0)
        .on_conflict_do_nothing(index_elements=["prefix", "seq_date"])
    )
    locked = await session.execute(
        select(CodeSequence.last_no)
        .where(CodeSequence.prefix == prefix, CodeSequence.seq_date == seq_date)
        .with_for_update()
    )
    last_no = locked.scalar_one()
    new_no = last_no + 1
    await session.execute(
        update(CodeSequence)
        .where(CodeSequence.prefix == prefix, CodeSequence.seq_date == seq_date)
        .values(last_no=new_no)
    )
    return new_no


async def next_code(session: AsyncSession, prefix: Prefix, now: datetime | None = None) -> str:
    """다음 코드. 예 ``SO-260928-0001``, ``US-0007``."""
    seq_date = seq_date_for(prefix, now)
    no = await next_no(session, prefix, seq_date)
    return format_code(prefix, seq_date, no)


def split_code(parent_code: str, existing_suffixes: list[str] | set[str] | tuple[str, ...]) -> str:
    """하위 WO 코드. 접미사는 A 부터, 이미 쓴 것 중 가장 큰 글자의 다음 (재사용 없음 — 인쇄된 코드).

    parent_code 는 접미사 없는 WO 코드여야 한다 (하위 WO 를 다시 나누지 않는다).
    26개를 넘으면 ValueError (api-contract 409 SPLIT_LIMIT 의 원인).
    """
    m = _DATED_CODE_RE.match(parent_code)
    if m is None or m.group(1) != "WO":
        raise ValueError(f"not a parent WO code: {parent_code!r}")
    used: list[str] = []
    for s in existing_suffixes:
        if len(s) != 1 or not ("A" <= s <= "Z"):
            raise ValueError(f"invalid split suffix: {s!r}")
        used.append(s)
    next_index = 0 if not used else ord(max(used)) - ord("A") + 1
    if next_index >= MAX_SPLIT:
        raise ValueError(f"split limit reached ({MAX_SPLIT}) for {parent_code}")
    return f"{parent_code}-{chr(ord('A') + next_index)}"

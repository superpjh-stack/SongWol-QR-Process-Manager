"""목록 공통 (api-contract §1 · §13.1 admin #4/#5): 페이징 · 정렬 · q 검색.

- ``?page=1&size=50`` (size 최대 200) → ``Page{items,page,size,total}``
- ``?sort=col,-col2`` — 허용 컬럼 밖이면 422 ``BAD_SORT``. 기본 정렬 = 허용 표의 첫 컬럼
- ``q`` 는 대상 컬럼 ILIKE OR
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from fastapi import Depends, Query
from sqlalchemy import ColumnElement, Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError

PAGE_SIZE_DEFAULT = 50
PAGE_SIZE_MAX = 200


@dataclass(slots=True)
class PageParams:
    page: int
    size: int

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.size


def page_params(
    page: int = Query(1, ge=1),
    size: int = Query(PAGE_SIZE_DEFAULT, ge=1, le=PAGE_SIZE_MAX),
) -> PageParams:
    return PageParams(page=page, size=size)


PageDep = Depends(page_params)


def parse_sort(
    sort: str | None, allowed: Mapping[str, Any], default: str | None = None
) -> list[ColumnElement[Any]]:
    """``"due_date,-created_at"`` → ORDER BY 식 목록. 첫 허용 컬럼이 기본 정렬."""
    if not sort:
        key = default or next(iter(allowed))
        col = allowed[key.lstrip("-")]
        return [col.desc() if key.startswith("-") else col.asc()]
    out: list[ColumnElement[Any]] = []
    for raw in sort.split(","):
        token = raw.strip()
        if not token:
            continue
        desc = token.startswith("-")
        name = token[1:] if desc else token
        col = allowed.get(name)
        if col is None:
            raise ApiError(
                422,
                "BAD_SORT",
                f"정렬할 수 없는 컬럼입니다: {name} (허용: {', '.join(allowed)})",
                [{"loc": ["query", "sort"], "msg": f"허용 컬럼: {', '.join(allowed)}"}],
            )
        out.append(col.desc() if desc else col.asc())
    return out


def q_filter(q: str | None, columns: Sequence[Any]) -> ColumnElement[bool] | None:
    if not q or not q.strip():
        return None
    pattern = f"%{q.strip()}%"
    return or_(*(c.ilike(pattern) for c in columns))


async def paginate(
    session: AsyncSession, stmt: Select[Any], params: PageParams
) -> tuple[list[Any], int]:
    """(rows, total). stmt 는 단일 엔티티 select 여야 한다."""
    count_stmt = select(func.count()).select_from(stmt.order_by(None).subquery())
    total = (await session.execute(count_stmt)).scalar_one()
    rows = (await session.execute(stmt.offset(params.offset).limit(params.size))).scalars().all()
    return list(rows), int(total)

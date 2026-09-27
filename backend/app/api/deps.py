"""FastAPI 의존성: 세션 · JWT 사용자 · 단말 키 · 역할 가드 (api-contract §2, §4).

- ``Authorization: Bearer <jwt>`` → ``AppUser`` (401 UNAUTHENTICATED / TOKEN_EXPIRED, 403
  USER_INACTIVE)
- ``X-Station-Key`` → ``Station`` (401 BAD_STATION_KEY, 403 STATION_INACTIVE) + ``last_seen_at``
  갱신
- ``X-Integration-Key`` (§11-2, 연계 [확장]) — 자리만. 환경변수 비교, S0 에서는 쓰는 엔드포인트
  없음.
- ``require_roles(*roles, station=…)`` → ``Principal`` (사용자 또는 단말). 둘 다 없으면 401, 권한
  밖이면 403.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import Depends, Header, Request
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.apikey import hash_api_key
from app.core.errors import ApiError, forbidden, unauthenticated
from app.core.request_context import current_user_id
from app.core.security import TokenExpired, TokenInvalid, decode_access_token
from app.db.models.master import AppUser, Station
from app.db.session import get_session

STATION_KEY_HEADER = "X-Station-Key"
INTEGRATION_KEY_HEADER = "X-Integration-Key"

Session = Depends(get_session)


@dataclass(slots=True)
class Principal:
    user: AppUser | None = None
    station: Station | None = None

    @property
    def user_id(self) -> int | None:
        return self.user.id if self.user else None

    @property
    def role(self) -> str | None:
        return self.user.role if self.user else None

    @property
    def is_station(self) -> bool:
        return self.station is not None


def _bearer(request: Request) -> str | None:
    auth = request.headers.get("authorization")
    if not auth:
        return None
    scheme, _, token = auth.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


async def _load_user_from_token(session: AsyncSession, token: str) -> AppUser:
    try:
        claims = decode_access_token(token)
    except TokenExpired as e:
        raise ApiError(401, "TOKEN_EXPIRED", "로그인이 만료되었습니다. 다시 로그인하세요") from e
    except TokenInvalid as e:
        raise ApiError(401, "UNAUTHENTICATED", "유효하지 않은 토큰입니다") from e
    user = await session.get(AppUser, claims.user_id)
    if user is None:
        raise ApiError(401, "UNAUTHENTICATED", "토큰의 사용자가 없습니다")
    if not user.active:
        raise ApiError(403, "USER_INACTIVE", "비활성 사용자입니다")
    current_user_id.set(user.id)
    return user


async def _load_station_from_key(session: AsyncSession, key: str) -> Station:
    station = (
        await session.execute(select(Station).where(Station.api_key_hash == hash_api_key(key)))
    ).scalar_one_or_none()
    if station is None:
        raise ApiError(
            401, "BAD_STATION_KEY", "단말 키가 올바르지 않습니다. 단말 등록이 필요합니다"
        )
    if not station.active:
        raise ApiError(403, "STATION_INACTIVE", f"비활성 단말입니다: {station.id}")
    # last_seen_at 갱신 (db-schema §2.9). ORM dirty 가 아닌 core UPDATE — 감사 로그 잡음 방지.
    await session.execute(
        update(Station).where(Station.id == station.id).values(last_seen_at=datetime.now(UTC))
    )
    await session.commit()
    return station


async def get_current_user(request: Request, session: AsyncSession = Session) -> AppUser:
    """JWT 필수."""
    token = _bearer(request)
    if token is None:
        raise unauthenticated()
    return await _load_user_from_token(session, token)


async def get_current_station(
    session: AsyncSession = Session,
    x_station_key: str | None = Header(default=None, alias=STATION_KEY_HEADER),
) -> Station:
    """단말 키 필수."""
    if not x_station_key:
        raise ApiError(401, "BAD_STATION_KEY", "X-Station-Key 헤더가 없습니다")
    return await _load_station_from_key(session, x_station_key)


async def get_principal(
    request: Request,
    session: AsyncSession = Session,
    x_station_key: str | None = Header(default=None, alias=STATION_KEY_HEADER),
) -> Principal:
    """JWT 우선, 없으면 단말 키. 둘 다 없으면 401."""
    token = _bearer(request)
    if token is not None:
        return Principal(user=await _load_user_from_token(session, token))
    if x_station_key:
        return Principal(station=await _load_station_from_key(session, x_station_key))
    raise unauthenticated()


_PRINCIPAL = Depends(get_principal)


def require_roles(*roles: str, station: bool = False) -> Callable[..., Awaitable[Principal]]:
    """역할 가드. ``station=True`` 면 단말 키만으로도 허용 (§4 STATION 열)."""

    allowed = frozenset(roles)

    async def _dep(principal: Principal = _PRINCIPAL) -> Principal:
        if principal.user is not None:
            if principal.user.role not in allowed:
                raise forbidden()
            return principal
        if principal.station is not None and station:
            return principal
        raise forbidden()

    return _dep


CurrentUser = Depends(get_current_user)
CurrentStation = Depends(get_current_station)

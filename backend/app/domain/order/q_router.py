"""QR 착지 라우터 ``GET /api/v1/q/{code}?c=`` (api-contract §10). 공개 + 선택 JWT.

토큰이 있는데 만료·불일치면 401 그대로 (QRL-01: 화면이 비로그인 표시로 전환). 단말 키는 쓰지 않는다.
"""

from __future__ import annotations

from fastapi import APIRouter, Query
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import BearerCreds, Session, _bearer, _load_user_from_token
from app.api.v1.schemas.order import QrLanding
from app.db.models.master import AppUser
from app.domain.order import q_service

router = APIRouter(prefix="/q", tags=["qr"])


async def optional_user(
    creds: HTTPAuthorizationCredentials | None = BearerCreds, session: AsyncSession = Session
) -> AppUser | None:
    token = _bearer(creds)
    if token is None:
        return None
    return await _load_user_from_token(session, token)


@router.get("/{code}", response_model=QrLanding)
async def qr_landing(
    code: str,
    c: str | None = Query(default=None, description="체크코드 4자 (QR URL 의 c=)"),
    creds: HTTPAuthorizationCredentials | None = BearerCreds,
    session: AsyncSession = Session,
) -> QrLanding:
    user = await optional_user(creds, session)
    return await q_service.landing(session, code, c, user)

"""인증 라우터 (api-contract §7.1 · §13.2)."""

from fastapi import APIRouter
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentStation, CurrentUser, Session
from app.api.v1.schemas.master import UserSummary
from app.api.v1.schemas.scan import (
    LoginRequest,
    LoginResponse,
    WorkerLoginRequest,
    WorkerLoginResponse,
)
from app.db.models.master import AppUser, Station
from app.domain.auth import service
from app.domain.master.admin_service import user_summary

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, session: AsyncSession = Session) -> LoginResponse:
    token, expires_in, user = await service.login(session, body.login_id, body.password)
    return LoginResponse(access_token=token, expires_in=expires_in, user=user_summary(user))


@router.get("/me", response_model=UserSummary)
async def me(user: AppUser = CurrentUser) -> UserSummary:
    return user_summary(user)


@router.post("/worker", response_model=WorkerLoginResponse)
async def worker(
    body: WorkerLoginRequest,
    station: Station = CurrentStation,
    session: AsyncSession = Session,
) -> WorkerLoginResponse:
    user, login_via = await service.worker_login(session, station, body)
    return WorkerLoginResponse(worker=user_summary(user), login_via=login_via)

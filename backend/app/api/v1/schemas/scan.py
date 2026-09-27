"""스캔 (ts-types §6). S0 는 로그인 관련 4종만. ScanRequest/ScanResponse 는 개발② 스캔 엔진(S2)."""

from typing import Literal

from pydantic import Field

from app.api.v1.schemas.common import ApiModel, CodeStr, LoginIdStr
from app.api.v1.schemas.master import UserSummary

LoginVia = Literal["CARD", "PIN", "OFFLINE_CACHE"]


class LoginRequest(ApiModel):
    login_id: LoginIdStr = Field(min_length=1, max_length=30)
    password: str = Field(min_length=1)


class LoginResponse(ApiModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: UserSummary


class WorkerLoginRequest(ApiModel):
    card_code: CodeStr | None = None
    login_id: LoginIdStr | None = None
    pin: str | None = None


class WorkerLoginResponse(ApiModel):
    worker: UserSummary
    login_via: LoginVia

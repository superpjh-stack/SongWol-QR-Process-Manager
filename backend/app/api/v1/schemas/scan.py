"""스캔 (ts-types §6). S0 는 로그인 관련 4종, S1 은 ScanEventSummary(WO 상세·이벤트 목록).
ScanRequest/ScanResponse 는 개발② 스캔 엔진(S2).
"""

import uuid
from typing import Any, Literal

from pydantic import Field

from app.api.v1.schemas.common import ApiModel, CodeStr, IdRef, KstDateTime, LoginIdStr
from app.api.v1.schemas.master import UserSummary

LoginVia = Literal["CARD", "PIN", "OFFLINE_CACHE"]
TargetType = Literal["SO", "WO", "LT", "US", "VB"]
ScanAction = Literal[
    "START", "DONE", "RECEIVE", "PACK", "SHIP", "LOGIN", "CANCEL", "REPRINT", "APPROVE", "MAP"
]
ScanResult = Literal["OK", "WARN", "REJECT"]
ApprovalStatus = Literal["PENDING", "APPROVED", "DENIED"]


class ScanEventSummary(ApiModel):
    """scan_event 1행 (ADM-16 이벤트 로그 · ``GET /wo/{id}/events``)."""

    event_uuid: uuid.UUID
    scanned_at: KstDateTime
    received_at: KstDateTime
    station_id: str
    process_code: str | None
    worker: UserSummary | None
    target_type: TargetType
    target_code: str
    action: ScanAction
    qty_good: int | None
    qty_bad: int | None
    qty_box: int | None
    equipment: IdRef | None
    result: ScanResult
    result_msg: str | None
    approval_status: ApprovalStatus | None
    compensates_uuid: uuid.UUID | None
    payload: dict[str, Any]


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

"""공통 (ts-types §3, §11)."""

from datetime import UTC, datetime
from typing import Annotated, Any
from zoneinfo import ZoneInfo

from pydantic import BaseModel, BeforeValidator, ConfigDict, PlainSerializer

TZ_SEOUL = ZoneInfo("Asia/Seoul")


def to_kst_iso(v: datetime) -> str:
    """응답 시각은 항상 +09:00 (api-contract §1). tz-naive 는 UTC 로 본다."""
    if v.tzinfo is None:
        v = v.replace(tzinfo=UTC)
    return v.astimezone(TZ_SEOUL).isoformat()


KstDateTime = Annotated[datetime, PlainSerializer(to_kst_iso, return_type=str, when_used="json")]


def normalize_code(v: Any) -> Any:
    """D28 (DEF-QA2-010): 코드 계열 입력은 trim + 대문자. UK 는 사실상 대소문자 무시."""
    return v.strip().upper() if isinstance(v, str) else v


def normalize_login_id(v: Any) -> Any:
    """login_id 는 trim + 소문자."""
    return v.strip().lower() if isinstance(v, str) else v


CodeStr = Annotated[str, BeforeValidator(normalize_code)]
LoginIdStr = Annotated[str, BeforeValidator(normalize_login_id)]


class ApiModel(BaseModel):
    """응답 모델 공통: ORM 객체에서 채운다."""

    model_config = ConfigDict(from_attributes=True)


class Page[T](BaseModel):
    items: list[T]
    page: int
    size: int
    total: int


class ApiError(BaseModel):
    code: str
    message: str
    detail: list[dict[str, Any]]


class IdRef(ApiModel):
    id: int
    code: str
    name: str | None = None

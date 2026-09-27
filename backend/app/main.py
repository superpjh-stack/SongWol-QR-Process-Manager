"""FastAPI 앱 진입점.

- ``/health`` (Phase 0) · ``/api/v1/*`` (S0-3 인증 · S0-5 기준정보 · S0-6 엑셀 임포트)
- 오류 계약 (api-contract §3.1): 모든 4xx/5xx 는 ``{code, message, detail[]}``
- 응답 헤더 ``X-Request-Id`` (없으면 서버 생성, audit_log.request_id)
"""

import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, InterfaceError, OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1.router import api_v1
from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.request_context import current_request_id, current_user_id, new_request_id
from app.db.audit import install_audit_hooks
from app.db.session import engine

logger = logging.getLogger(__name__)

settings = get_settings()
install_audit_hooks()

app = FastAPI(title=settings.app_name, version="0.0.1")
app.include_router(api_v1)


@app.middleware("http")
async def request_id_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    rid = request.headers.get("x-request-id") or new_request_id()
    token_rid = current_request_id.set(rid)
    token_uid = current_user_id.set(None)
    try:
        response = await call_next(request)
    finally:
        current_request_id.reset(token_rid)
        current_user_id.reset(token_uid)
    response.headers["X-Request-Id"] = rid
    return response


def _error_response(
    status: int,
    code: str,
    message: str,
    detail: list[Any] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"code": code, "message": message, "detail": detail or []},
        headers=headers,
    )


@app.exception_handler(ApiError)
async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
    return _error_response(exc.status, exc.code, exc.message, exc.detail, exc.headers)


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    detail = [
        {
            "loc": list(e.get("loc", [])),
            "msg": str(e.get("msg", "")),
            "type": str(e.get("type", "")),
        }
        for e in exc.errors()
    ]
    return _error_response(422, "VALIDATION_ERROR", "입력값이 올바르지 않습니다", detail)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    code = {
        401: "UNAUTHENTICATED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        405: "METHOD_NOT_ALLOWED",
    }.get(exc.status_code, "HTTP_ERROR")
    msg = exc.detail if isinstance(exc.detail, str) else "요청을 처리할 수 없습니다"
    return _error_response(exc.status_code, code, msg, headers=dict(exc.headers or {}))


@app.exception_handler(IntegrityError)
async def integrity_handler(request: Request, exc: IntegrityError) -> JSONResponse:
    """서비스가 미리 잡지 못한 제약 위반. 유니크 → 409 DUPLICATE_CODE, 그 외 409 STATE_CONFLICT."""
    text_ = str(exc.orig)
    logger.warning("integrity error: %s", text_)
    if "unique" in text_.lower() or "duplicate key" in text_.lower():
        return _error_response(
            409, "DUPLICATE_CODE", "이미 있는 코드입니다", [{"db": text_.splitlines()[0]}]
        )
    return _error_response(
        409, "STATE_CONFLICT", "데이터 제약에 걸렸습니다", [{"db": text_.splitlines()[0]}]
    )


@app.exception_handler(OperationalError)
@app.exception_handler(InterfaceError)
@app.exception_handler(ConnectionError)
async def db_unavailable_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("DB unavailable")
    return _error_response(
        503, "DB_UNAVAILABLE", "서비스 일시 중단 — 데이터베이스에 연결할 수 없습니다"
    )


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    db: Literal["ok", "error"]
    version: str
    time: str


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """프로세스 생존 + DB 연결 확인. DB 가 죽어도 200 + ``db: "error"`` 로 드러낸다 (HealthResponse,
    ts-types §9).
    """
    db: Literal["ok", "error"] = "ok"
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:
        logger.exception("health: DB check failed")
        db = "error"
    return HealthResponse(
        status="ok" if db == "ok" else "degraded",
        db=db,
        version=app.version,
        time=datetime.now(UTC).isoformat(),
    )

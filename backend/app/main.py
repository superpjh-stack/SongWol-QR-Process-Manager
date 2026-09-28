"""FastAPI 앱 진입점.

- ``/health`` (Phase 0) · ``/api/v1/*`` (S0-3 인증 · S0-5 기준정보 · S0-6 엑셀 임포트)
- 오류 계약 (api-contract §3.1): 모든 4xx/5xx 는 ``{code, message, detail[]}``
- 응답 헤더 ``X-Request-Id`` (없으면 서버 생성, audit_log.request_id)
"""

import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
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
from app.api.v1.schemas.common import to_kst_iso
from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.request_context import current_request_id, current_user_id, new_request_id
from app.db.bootstrap import bootstrap
from app.db.session import engine
from app.domain.board import scheduler as delay_scheduler
from app.domain.board.router import router as board_router
from app.ws.router import router as ws_router

logger = logging.getLogger(__name__)

settings = get_settings()
bootstrap()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """S4: 지연 감지 잡(§6.5) 기동/종료. 스캔·발행 등은 요청마다 즉시 처리되므로 그 외에는
    이 앱에 다른 백그라운드 작업이 없다."""
    delay_scheduler.start_scheduler()
    try:
        yield
    finally:
        delay_scheduler.stop_scheduler()


app = FastAPI(title=settings.app_name, version="0.0.1", lifespan=lifespan)
app.include_router(api_v1)
app.include_router(board_router, prefix="/api/v1")
# ``/ws/board`` 는 계약상 ``/api/v1`` 밖이다 (api-contract §8) — prefix 없이 붙인다.
app.include_router(ws_router)


IMPORT_PREVIEW_PATH = "/api/v1/master/import/preview"


@app.middleware("http")
async def upload_size_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """§14.5: 업로드 크기 Content-Length 선검사 — 본문을 파싱하기 전에 413 (DEF: QA① 제안 5)."""
    if request.method == "POST" and request.url.path == IMPORT_PREVIEW_PATH:
        length = request.headers.get("content-length")
        limit = settings.import_max_bytes + 64 * 1024  # multipart 경계 여유
        if length and length.isdigit() and int(length) > limit:
            mb = settings.import_max_bytes // (1024 * 1024)
            return _error_response(413, "FILE_TOO_LARGE", f"파일이 {mb}MB 를 넘습니다")
    return await call_next(request)


@app.middleware("http")
async def request_id_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    rid = request.headers.get("x-request-id") or new_request_id()
    request.state.request_id = rid  # 미처리 예외 핸들러(contextvar 리셋 뒤)가 읽는다
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
    # DEF-QA2-008: 제약명·테이블명 원문은 로그에만. 응답은 코드만.
    if "unique" in text_.lower() or "duplicate key" in text_.lower():
        return _error_response(409, "DUPLICATE_CODE", "이미 있는 코드입니다")
    return _error_response(409, "STATE_CONFLICT", "데이터 제약에 걸렸습니다")


@app.exception_handler(OperationalError)
@app.exception_handler(InterfaceError)
@app.exception_handler(ConnectionError)
async def db_unavailable_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("DB unavailable")
    return _error_response(
        503, "DB_UNAVAILABLE", "서비스 일시 중단 — 데이터베이스에 연결할 수 없습니다"
    )


@app.exception_handler(Exception)
async def unhandled_handler(request: Request, exc: Exception) -> JSONResponse:
    """D52 (DEF-QA2-S1-005): 미처리 예외도 계약 형식 500 + X-Request-Id. 원인은 로그에만."""
    rid = getattr(request.state, "request_id", None) or request.headers.get("x-request-id")
    logger.exception("unhandled error request_id=%s %s %s", rid, request.method, request.url.path)
    return _error_response(
        500, "INTERNAL_ERROR", "서버 오류", headers={"X-Request-Id": rid} if rid else None
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
        time=to_kst_iso(datetime.now(UTC)),  # api-contract §1: 응답 시각은 +09:00 (DEF-QA2-007)
    )

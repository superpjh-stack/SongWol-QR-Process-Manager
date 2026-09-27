"""오류 계약 (api-contract §3.1): 모든 4xx/5xx 는 ``{code, message, detail[]}``.

서비스 계층은 ``ApiError`` 를 던지고, ``app.main`` 의 핸들러가 형식을 맞춘다.
자주 쓰는 오류는 팩토리 함수로 둔다 (같은 문구를 두 번 쓰지 않는다).
"""

from typing import Any


class ApiError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        detail: list[Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.detail: list[Any] = detail or []
        self.headers = headers

    def body(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "detail": self.detail}


def not_found(code: str, what: str, key: str | int) -> ApiError:
    return ApiError(404, code, f"{what} {key} 을(를) 찾을 수 없습니다")


def duplicate_code(what: str, key: str) -> ApiError:
    return ApiError(409, "DUPLICATE_CODE", f"{what} 코드 {key} 이(가) 이미 있습니다")


def state_conflict(message: str, detail: list[Any] | None = None) -> ApiError:
    return ApiError(409, "STATE_CONFLICT", message, detail)


def validation(loc: list[str | int], msg: str, code: str = "VALIDATION_ERROR") -> ApiError:
    """422. ``detail[].loc`` 로 화면이 필드를 특정한다 (screens-admin §0.4)."""
    return ApiError(422, code, msg, [{"loc": loc, "msg": msg, "type": "value_error"}])


def unauthenticated() -> ApiError:
    return ApiError(401, "UNAUTHENTICATED", "로그인이 필요합니다")


def forbidden() -> ApiError:
    return ApiError(403, "FORBIDDEN", "접근 권한이 없습니다")

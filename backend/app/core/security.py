"""JWT · 비밀번호/PIN 정책 (api-contract §2.1, §11-13, §13.2).

- JWT payload ``{sub, login_id, role, exp, iat}``, HS256, 만료 12h (``jwt_expire_hours``).
  ``sub`` 는 JWT 규격대로 문자열(user_id).
- 비밀번호: 8자 이상, 영문+숫자 각 1자 이상 → 위반 422 ``WEAK_PASSWORD`` (연속·반복 검사 없음).
- PIN: 숫자 4~6자리 ``^\\d{4,6}$``.
해시는 ``app.core.hashing`` (bcrypt 직접, 결정 D15).
"""

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from jose import JWTError, jwt

from app.core.config import get_settings

PIN_RE = re.compile(r"^\d{4,6}$")
PASSWORD_MIN_LEN = 8
PIN_MAX_FAILURES = 5
PIN_LOCK_MINUTES = 15


@dataclass(frozen=True, slots=True)
class TokenClaims:
    user_id: int
    login_id: str
    role: str
    exp: datetime
    iat: datetime


class TokenExpired(Exception):
    pass


class TokenInvalid(Exception):
    pass


def create_access_token(
    *, user_id: int, login_id: str, role: str, now: datetime | None = None
) -> tuple[str, int]:
    """(token, expires_in 초)."""
    settings = get_settings()
    now = now or datetime.now(UTC)
    expires = timedelta(hours=settings.jwt_expire_hours)
    payload = {
        "sub": str(user_id),
        "login_id": login_id,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int((now + expires).timestamp()),
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, int(expires.total_seconds())


def decode_access_token(token: str) -> TokenClaims:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.ExpiredSignatureError as e:
        raise TokenExpired() from e
    except JWTError as e:
        raise TokenInvalid() from e
    try:
        return TokenClaims(
            user_id=int(payload["sub"]),
            login_id=str(payload["login_id"]),
            role=str(payload["role"]),
            exp=datetime.fromtimestamp(int(payload["exp"]), tz=UTC),
            iat=datetime.fromtimestamp(int(payload["iat"]), tz=UTC),
        )
    except (KeyError, ValueError, TypeError) as e:
        raise TokenInvalid() from e


def password_problem(password: str) -> str | None:
    """정책 위반 사유 문장. 통과면 None."""
    if len(password) < PASSWORD_MIN_LEN:
        return f"비밀번호는 {PASSWORD_MIN_LEN}자 이상이어야 합니다"
    if not re.search(r"[A-Za-z]", password):
        return "비밀번호에 영문자가 1자 이상 있어야 합니다"
    if not re.search(r"\d", password):
        return "비밀번호에 숫자가 1자 이상 있어야 합니다"
    return None


def is_valid_pin(pin: str) -> bool:
    return PIN_RE.fullmatch(pin) is not None

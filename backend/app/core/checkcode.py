"""QR 체크코드 (spec §6, plan §5.1).

- ``check = base32(hmac_sha256(secret, code))[:4]`` — 오타·조작 URL 차단.
- secret 은 ``CHECKCODE_SECRET``. 회전 중이면 ``CHECKCODE_SECRET_PREV`` 로 만든 체크코드도
  검증한다 (2세대). 발급은 항상 현재 secret 으로만 한다.
- ``parse_qr(text)``: 스캐너/카메라 원문(URL ``https://host/q/{CODE}?c={CHECK}`` 또는 맨 코드)에서
  code·check·type 을 뽑는다. SO/WO/LT/US 패턴이 아니면 전부 VB (업체 바코드 원문 그대로).
  체크코드 검증은 여기서 하지 않는다 (호출자가 ``verify_check``).
"""

import base64
import hashlib
import hmac
import re
from dataclasses import dataclass
from typing import Literal
from urllib.parse import parse_qs, unquote, urlsplit

from app.core.config import get_settings

CHECK_LEN = 4
TargetType = Literal["SO", "WO", "LT", "US", "VB"]

# spec §2.1 · §6: SO/WO/LT-YYMMDD-NNNN(N), 하위 WO 만 -A~-Z, 작업자 카드 US-NNNN(N)
_DATED_RE = re.compile(r"^(SO|WO|LT)-\d{6}-\d{4,5}(?:-([A-Z]))?$")
_USER_RE = re.compile(r"^US-\d{4,5}$")
_Q_PATH_RE = re.compile(r"(?:^|/)q/([^/?#]+)")


@dataclass(frozen=True, slots=True)
class ParsedCode:
    type: TargetType
    code: str
    check: str | None
    raw: str


def _hmac_check(secret: str, code: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), code.encode("utf-8"), hashlib.sha256).digest()
    return base64.b32encode(digest).decode("ascii")[:CHECK_LEN]


def make_check(code: str, *, secret: str | None = None) -> str:
    """현재 secret 으로 체크코드 4자 (Base32: A-Z, 2-7)."""
    return _hmac_check(secret if secret is not None else get_settings().checkcode_secret, code)


def verify_check(code: str, check: str | None) -> bool:
    """현재 secret → 이전 세대 secret 순으로 검증. 길이가 다르면 거부, 소문자는 대문자로 본다."""
    if check is None or len(check) != CHECK_LEN:
        return False
    given = check.upper()
    settings = get_settings()
    candidates = [settings.checkcode_secret]
    if settings.checkcode_secret_prev:
        candidates.append(settings.checkcode_secret_prev)
    return any(hmac.compare_digest(_hmac_check(s, code), given) for s in candidates)


def classify(code: str) -> TargetType:
    m = _DATED_RE.match(code)
    if m:
        prefix = m.group(1)
        if m.group(2) is not None and prefix != "WO":
            return "VB"  # 접미사는 하위 WO 에만 있다
        return prefix  # type: ignore[return-value]
    if _USER_RE.match(code):
        return "US"
    return "VB"


def parse_qr(text: str) -> ParsedCode:
    """스캔 원문 → ParsedCode.

    ① ``https?://…/q/{CODE}?c={CHECK}`` (또는 ``/q/{CODE}`` 경로) 면 CODE·CHECK 를 뽑는다
    ② ``^(SO|WO|LT)-\\d{6}-\\d{4,5}(-[A-Z])?$`` · ``^US-\\d{4,5}$`` 매치면 type 결정
    ③ 그 외 전부 VB (원문 그대로, check None)
    HID 스캐너가 붙이는 개행·공백은 제거한다.
    """
    raw = text.strip()
    if not raw:
        raise ValueError("empty scan text")

    code = raw
    check: str | None = None
    m = _Q_PATH_RE.search(raw)
    if m and ("://" in raw or raw.startswith("/")):
        parts = urlsplit(raw)
        code = unquote(m.group(1))
        c = parse_qs(parts.query).get("c")
        if c and c[0]:
            check = c[0].strip()
    elif "?c=" in raw:
        code, _, q = raw.partition("?")
        c = parse_qs(q).get("c")
        if c and c[0]:
            check = c[0].strip()

    kind = classify(code.upper())
    if kind != "VB":
        code = code.upper()
        check = check.upper() if check else None
    else:
        check = None
    return ParsedCode(type=kind, code=code, check=check, raw=raw)

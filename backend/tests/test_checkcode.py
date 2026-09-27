"""체크코드·QR 파싱 (spec §6, plan §5.1)."""

import base64
import hashlib
import hmac

import pytest

from app.core import checkcode
from app.core.checkcode import ParsedCode, make_check, parse_qr, verify_check
from app.core.config import get_settings


def _expected(secret: str, code: str) -> str:
    d = hmac.new(secret.encode(), code.encode(), hashlib.sha256).digest()
    return base64.b32encode(d).decode()[:4]


def test_make_check_is_deterministic_and_matches_spec_formula() -> None:
    code = "WO-260907-0012"
    c1 = make_check(code)
    c2 = make_check(code)
    assert c1 == c2
    assert len(c1) == 4
    assert c1 == _expected(get_settings().checkcode_secret, code)
    assert all(ch in "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567" for ch in c1)
    assert make_check("WO-260907-0013") != c1


def test_verify_accepts_current_and_rejects_typo() -> None:
    code = "SO-260928-0001"
    check = make_check(code)
    assert verify_check(code, check)
    assert verify_check(code, check.lower())  # 스캐너 대소문자 차이는 허용
    wrong = ("A" if check[-1] != "A" else "B") + check[1:]
    assert not verify_check(code, wrong)
    assert not verify_check(code, check[:3])
    assert not verify_check(code, None)
    assert not verify_check("SO-260928-0002", check)


def test_verify_accepts_previous_secret_during_rotation(monkeypatch: pytest.MonkeyPatch) -> None:
    code = "LT-260928-0003"
    old_secret = "old-generation-secret"
    old_check = make_check(code, secret=old_secret)
    assert not verify_check(code, old_check)

    settings = get_settings()
    monkeypatch.setattr(settings, "checkcode_secret_prev", old_secret)
    assert verify_check(code, old_check)
    assert verify_check(code, make_check(code))  # 현재 세대도 계속 유효
    monkeypatch.setattr(settings, "checkcode_secret_prev", None)
    assert not verify_check(code, old_check)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (
            "https://sw.example/q/WO-260907-0012?c=7K3F",
            ParsedCode(
                "WO", "WO-260907-0012", "7K3F", "https://sw.example/q/WO-260907-0012?c=7K3F"
            ),
        ),
        (
            "https://sw.example/q/WO-260907-0012-A?c=abcd\r\n",  # 하위 WO + HID 개행 + 소문자
            ParsedCode(
                "WO", "WO-260907-0012-A", "ABCD", "https://sw.example/q/WO-260907-0012-A?c=abcd"
            ),
        ),
        ("SO-260928-10001", ParsedCode("SO", "SO-260928-10001", None, "SO-260928-10001")),  # 5자리
        (
            "http://localhost:5173/q/LT-260928-0007",
            ParsedCode("LT", "LT-260928-0007", None, "http://localhost:5173/q/LT-260928-0007"),
        ),
        (
            "https://sw.example/q/US-0007?c=Q2ZX",
            ParsedCode("US", "US-0007", "Q2ZX", "https://sw.example/q/US-0007?c=Q2ZX"),
        ),
        ("8801234567890", ParsedCode("VB", "8801234567890", None, "8801234567890")),
        ("SO-260907-0012-A", ParsedCode("VB", "SO-260907-0012-A", None, "SO-260907-0012-A")),
    ],
)
def test_parse_qr(text: str, expected: ParsedCode) -> None:
    assert parse_qr(text) == expected


def test_parse_qr_rejects_empty() -> None:
    with pytest.raises(ValueError):
        parse_qr("   ")


def test_check_len_constant() -> None:
    assert checkcode.CHECK_LEN == 4

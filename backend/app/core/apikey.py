"""단말 API key 생성·해시 (db-schema §2.9: 해시만 저장, 앞 8자는 로그 식별용).

해시는 SHA-256 hex (64자, api_key_hash VARCHAR(128)). S0-3 단말 인증은 ``hash_api_key`` 로 대조한다.
"""

import hashlib
import secrets

API_KEY_PREFIX_LEN = 8


def generate_api_key() -> str:
    """URL-safe 43자."""
    return secrets.token_urlsafe(32)


def hash_api_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def api_key_prefix(key: str) -> str:
    return key[:API_KEY_PREFIX_LEN]

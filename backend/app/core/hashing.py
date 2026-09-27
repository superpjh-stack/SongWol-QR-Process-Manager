"""비밀번호·PIN 해시 (bcrypt 직접 호출).

passlib 1.7.4 는 bcrypt 5.x 와 호환되지 않으므로(progress.md) bcrypt 를 직접 쓴다.
결과는 ``$2b$`` 형식이라 passlib 의 bcrypt 핸들러로도 검증된다. S0-3 인증은 이 함수를 그대로 쓴다.
"""

import bcrypt


def hash_secret(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def verify_secret(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("ascii"))
    except ValueError:
        return False

"""요청 단위 컨텍스트 (감사 로그용): 현재 사용자 id · X-Request-Id.

미들웨어/의존성이 설정하고 ``app.db.audit`` 이 읽는다. 스레드가 아니라 contextvar 라
asyncio 태스크마다 분리된다.
"""

import uuid
from contextvars import ContextVar

current_user_id: ContextVar[int | None] = ContextVar("current_user_id", default=None)
current_request_id: ContextVar[str | None] = ContextVar("current_request_id", default=None)


def new_request_id() -> str:
    return uuid.uuid4().hex

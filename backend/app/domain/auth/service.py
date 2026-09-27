"""인증 서비스 (api-contract §2 · §7.1 · §13.2).

- ``login``: login_id + password → JWT (12h). 실패 401 ``BAD_CREDENTIALS`` (아이디/비밀번호 구분
  없이).
- ``worker_login``: 카드(``US-NNNN``) 또는 login_id+PIN. 성공 시 서버가 ``scan_event(action=LOGIN,
  payload.login_via)`` 를 직접 기록한다 (shopfloor ⑤). 오류 코드는 shopfloor ③:
  404 USER_CARD_NOT_FOUND · 401 BAD_PIN · 403 USER_INACTIVE · 403 ROLE_NOT_ALLOWED · 409
  CARD_REQUIRED
  · 429 PIN_LOCKED (5회 실패, 15분, Retry-After). PIN 실패 카운트는 승인 경로와 공유(app_user 컬럼).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.schemas.scan import WorkerLoginRequest
from app.core.errors import ApiError, validation
from app.core.hashing import verify_secret
from app.core.security import PIN_LOCK_MINUTES, PIN_MAX_FAILURES, create_access_token
from app.db.models.master import AppUser, Station
from app.db.models.scan import ScanEvent, ScanEventKey

STATION_LOGIN_ROLES = frozenset({"WORKER", "MANAGER", "ADMIN"})


async def login(session: AsyncSession, login_id: str, password: str) -> tuple[str, int, AppUser]:
    user = (
        await session.execute(select(AppUser).where(AppUser.login_id == login_id))
    ).scalar_one_or_none()
    if user is None or not user.password_hash or not verify_secret(password, user.password_hash):
        raise ApiError(401, "BAD_CREDENTIALS", "아이디 또는 비밀번호가 올바르지 않습니다")
    if not user.active:
        raise ApiError(403, "USER_INACTIVE", "비활성 사용자입니다")
    token, expires_in = create_access_token(user_id=user.id, login_id=user.login_id, role=user.role)
    return token, expires_in, user


def _check_lock(user: AppUser, now: datetime) -> None:
    if user.pin_locked_until is not None and user.pin_locked_until > now:
        retry = int((user.pin_locked_until - now).total_seconds()) + 1
        raise ApiError(
            429,
            "PIN_LOCKED",
            f"PIN 이 {PIN_MAX_FAILURES}회 틀려 잠겼습니다. {retry // 60 + 1}분 후 다시 시도하세요",
            headers={"Retry-After": str(retry)},
        )


async def verify_pin(session: AsyncSession, user: AppUser, pin: str) -> None:
    """PIN 대조 + 잠금 카운트. 실패는 commit 후 401 BAD_PIN (카운트가 남아야 한다)."""
    now = datetime.now(UTC)
    _check_lock(user, now)
    if user.pin_hash and verify_secret(pin, user.pin_hash):
        if user.pin_failed_count or user.pin_locked_until:
            user.pin_failed_count = 0
            user.pin_locked_until = None
            await session.commit()
        return
    user.pin_failed_count = (user.pin_failed_count or 0) + 1
    remaining = PIN_MAX_FAILURES - user.pin_failed_count
    if user.pin_failed_count >= PIN_MAX_FAILURES:
        user.pin_locked_until = now + timedelta(minutes=PIN_LOCK_MINUTES)
        user.pin_failed_count = 0
        await session.commit()
        raise ApiError(
            429,
            "PIN_LOCKED",
            f"PIN 이 {PIN_MAX_FAILURES}회 틀려 {PIN_LOCK_MINUTES}분 동안 잠겼습니다",
            headers={"Retry-After": str(PIN_LOCK_MINUTES * 60)},
        )
    await session.commit()
    raise ApiError(401, "BAD_PIN", f"PIN 이 올바르지 않습니다 (남은 시도 {remaining}회)")


async def _record_login_event(
    session: AsyncSession, station: Station, user: AppUser, login_via: str
) -> None:
    now = datetime.now(UTC)
    ev = ScanEvent(
        event_uuid=uuid.uuid4(),
        scanned_at=now,
        received_at=now,
        station_id=station.id,
        process_code=station.process_code,
        worker_id=user.id,
        target_type="US",
        target_code=user.card_code or user.login_id,
        action="LOGIN",
        payload={"login_via": login_via},
        result="OK",
        result_msg=f"로그인 {user.name}",
    )
    session.add(ev)
    await session.flush()
    session.add(
        ScanEventKey(
            event_uuid=ev.event_uuid,
            received_at=now,
            event_id=ev.id,
            result="OK",
            response={"result": "OK", "action": "LOGIN", "login_via": login_via},
        )
    )


async def worker_login(
    session: AsyncSession, station: Station, body: WorkerLoginRequest
) -> tuple[AppUser, str]:
    """→ (user, login_via)."""
    if body.card_code:
        card = body.card_code.strip().upper()
        user = (
            await session.execute(select(AppUser).where(AppUser.card_code == card))
        ).scalar_one_or_none()
        if user is None:
            raise ApiError(404, "USER_CARD_NOT_FOUND", f"카드 {card} 에 해당하는 사용자가 없습니다")
        login_via = "CARD"
    elif body.login_id:
        if not body.pin:
            raise validation(["body", "pin"], "login_id 로그인에는 PIN 이 필요합니다")
        user = (
            await session.execute(select(AppUser).where(AppUser.login_id == body.login_id))
        ).scalar_one_or_none()
        if user is None:
            raise ApiError(404, "USER_CARD_NOT_FOUND", f"사용자 {body.login_id} 이(가) 없습니다")
        login_via = "PIN"
    else:
        raise validation(["body", "card_code"], "card_code 또는 login_id 가 필요합니다")

    if not user.active:
        raise ApiError(403, "USER_INACTIVE", "비활성 사용자입니다")
    if user.role not in STATION_LOGIN_ROLES:
        raise ApiError(403, "ROLE_NOT_ALLOWED", f"{user.role} 역할은 단말 로그인이 불가합니다")
    if login_via == "PIN" and not user.card_code:
        raise ApiError(
            409, "CARD_REQUIRED", "카드가 없는 사용자입니다. 관리자에게 카드 발급을 요청하세요"
        )
    if body.pin:
        await verify_pin(session, user, body.pin)

    await _record_login_event(session, station, user, login_via)
    await session.commit()
    return user, login_via

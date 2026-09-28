"""알림 어댑터 · CRUD (db-schema §7.1, api-contract §7.8 · §15.6 U1).

``NotificationChannel`` 은 최소 인터페이스(``send``) 하나 — U1 결정(progress.md 「이메일
어댑터로 임시」)에 따라 ``EmailChannel`` 하나만 등록한다. 발송 실패(또는 수신자 없음)는
예외를 올리지 않고 ``False`` 를 돌려준다 — 호출자가 ``notification.sent_at`` 을 NULL 로
남겨 다음 배치(지연 감지 잡)가 재시도한다(조용한 실패 금지: 실패 자체는 로그에 남고, 화면은
``GET /notifications?unacked=true`` 로 미발송·미확인을 그대로 드러낸다).
"""

from __future__ import annotations

import logging
import smtplib
from abc import ABC, abstractmethod
from datetime import UTC, datetime
from email.message import EmailMessage
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.schemas import board as B
from app.core.config import get_settings
from app.core.errors import not_found, state_conflict
from app.db.models.master import AppUser
from app.db.models.ops import Notification
from app.domain.common.listing import PageParams, paginate
from app.domain.master.admin_service import user_summary

logger = logging.getLogger(__name__)

BROADCAST_ROLES = ("MANAGER", "SALES")


class NotificationChannel(ABC):
    """알림 전송 채널 최소 인터페이스. U1 은 이메일 하나만 등록한다 — 카카오·문자·푸시는
    [확장](§7.1 CHECK 는 이미 4종을 더 허용해 둔다, 구현만 아직)."""

    name: str

    @abstractmethod
    async def send(self, *, to: list[str], subject: str, message: str) -> bool: ...


class EmailChannel(NotificationChannel):
    name = "EMAIL"

    async def send(self, *, to: list[str], subject: str, message: str) -> bool:
        if not to:
            logger.warning(
                "알림 수신자 이메일이 없습니다(사용자 email 미설정) — 발송 보류: %s", subject
            )
            return False
        settings = get_settings()
        if not settings.smtp_host:
            logger.info("SMTP 미설정 — 알림 발송 보류(재시도 대상): %s", subject)
            return False
        try:
            msg = EmailMessage()
            msg["Subject"] = subject
            msg["From"] = settings.smtp_from
            msg["To"] = ", ".join(to)
            msg.set_content(message)
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
                if settings.smtp_use_tls:
                    smtp.starttls()
                if settings.smtp_user:
                    smtp.login(settings.smtp_user, settings.smtp_password)
                smtp.send_message(msg)
            return True
        except Exception:
            logger.exception("이메일 알림 발송 실패: %s", subject)
            return False


CHANNELS: dict[str, NotificationChannel] = {"EMAIL": EmailChannel()}


# ======================================================================
# 생성 (지연 감지 잡 · 기타 알림 생성 지점 공용)
# ======================================================================
async def create_notification(
    session: AsyncSession,
    *,
    type_: str,
    target_code: str,
    message: str,
    dedupe_key: str,
    channel: str = "EMAIL",
    recipient_user_id: int | None = None,
) -> bool:
    """dedupe_key UK 로 하루 1회(§7.1). 이미 있으면 조용히 건너뛴다(중복이 아니라 정상 멱등).

    반환값 True = 새로 만들었다.
    """
    stmt = (
        pg_insert(Notification)
        .values(
            type=type_,
            target_code=target_code,
            message=message,
            channel=channel,
            dedupe_key=dedupe_key,
            recipient_user_id=recipient_user_id,
        )
        .on_conflict_do_nothing(index_elements=["dedupe_key"])
    )
    result = await session.execute(stmt)
    return bool(result.rowcount)  # type: ignore[attr-defined]


async def _resolve_recipients(session: AsyncSession, n: Notification) -> list[str]:
    if n.recipient_user_id is not None:
        u = await session.get(AppUser, n.recipient_user_id)
        return [u.email] if u is not None and u.email else []
    rows = (
        await session.execute(
            select(AppUser.email).where(
                AppUser.role.in_(BROADCAST_ROLES),
                AppUser.active.is_(True),
                AppUser.email.is_not(None),
            )
        )
    ).scalars().all()
    return [e for e in rows if e]


async def dispatch_pending(session: AsyncSession, *, limit: int = 200) -> int:
    """``sent_at IS NULL`` 인 알림을 채널로 보내 본다. 성공한 것만 ``sent_at`` 을 채운다.

    지연 감지 잡이 매 실행마다 부른다 — 실패했던 이전 건도 함께 재시도된다(플랜 §5.1).
    """
    rows = (
        (
            await session.execute(
                select(Notification).where(Notification.sent_at.is_(None)).limit(limit)
            )
        )
        .scalars()
        .all()
    )
    sent = 0
    for n in rows:
        channel = CHANNELS.get(n.channel)
        if channel is None:
            continue
        to = await _resolve_recipients(session, n)
        subject = f"[송월타월 QR] {n.type} {n.target_code}"
        ok = await channel.send(to=to, subject=subject, message=n.message)
        if ok:
            n.sent_at = datetime.now(UTC)
            sent += 1
    return sent


# ======================================================================
# 조회 · 확인 (GET /notifications · POST /notifications/{id}/ack)
# ======================================================================
def notification_out(n: Notification, ack_user: AppUser | None) -> B.Notification:
    return B.Notification(
        id=n.id,
        type=n.type,
        target_code=n.target_code,
        message=n.message,
        channel=n.channel,
        created_at=n.created_at,
        sent_at=n.sent_at,
        ack_by=user_summary(ack_user) if ack_user is not None else None,
        ack_at=n.ack_at,
    )


async def list_notifications(
    session: AsyncSession,
    params: PageParams,
    *,
    unacked: bool,
    type_: str | None,
    from_: datetime | None,
    to: datetime | None,
) -> tuple[list[B.Notification], int]:
    stmt = select(Notification)
    if unacked:
        stmt = stmt.where(Notification.ack_at.is_(None))
    if type_:
        stmt = stmt.where(Notification.type == type_.upper())
    if from_ is not None:
        stmt = stmt.where(Notification.created_at >= from_)
    if to is not None:
        stmt = stmt.where(Notification.created_at <= to)
    stmt = stmt.order_by(Notification.created_at.desc())
    rows, total = await paginate(session, stmt, params)
    ack_users = {
        u.id: u
        for u in (
            await session.execute(
                select(AppUser).where(
                    AppUser.id.in_([r.ack_by for r in rows if r.ack_by is not None] or [0])
                )
            )
        ).scalars()
    }
    return [notification_out(r, ack_users.get(r.ack_by) if r.ack_by else None) for r in rows], total


async def ack_notification(
    session: AsyncSession, notification_id: int, user: AppUser
) -> B.Notification:
    n = await session.get(Notification, notification_id)
    if n is None:
        raise not_found("NOTIFICATION_NOT_FOUND", "알림", notification_id)
    if n.ack_at is not None:
        raise state_conflict("이미 확인한 알림입니다")
    n.ack_by = user.id
    n.ack_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(n)
    return notification_out(n, user)


__all__: list[Any] = [
    "CHANNELS",
    "NotificationChannel",
    "ack_notification",
    "create_notification",
    "dispatch_pending",
    "list_notifications",
]

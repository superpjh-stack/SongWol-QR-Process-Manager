"""운영 (db-schema §7).

notification · audit_log · migration_batch · migration_map
"""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.models.enums import (
    AuditAction,
    MigrationSource,
    MigrationStatus,
    NotificationChannel,
    NotificationType,
    sql_in,
)

__all__ = ["AuditLog", "MigrationBatch", "MigrationMap", "Notification"]


class Notification(Base):
    """알림 (§7.1). dedupe_key = `{type}:{target_code}:{YYYY-MM-DD}` 하루 1회."""

    __tablename__ = "notification"
    __table_args__ = (
        CheckConstraint(sql_in("type", NotificationType), name="type"),
        CheckConstraint(sql_in("channel", NotificationChannel), name="channel"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    target_code: Mapped[str] = mapped_column(String(30), nullable=False)
    message: Mapped[str] = mapped_column(String(500), nullable=False)
    channel: Mapped[str] = mapped_column(String(10), nullable=False)
    dedupe_key: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    recipient_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("app_user.id", ondelete="RESTRICT")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ack_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("app_user.id", ondelete="RESTRICT")
    )
    ack_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuditLog(Base):
    """감사 로그 (§7.2). spec `table` → `table_name` (예약어 회피)."""

    __tablename__ = "audit_log"
    __table_args__ = (
        Index("ix_audit_log_table_name_row_id", "table_name", "row_id"),
        CheckConstraint(sql_in("action", AuditAction), name="action"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    table_name: Mapped[str] = mapped_column(String(40), nullable=False)
    row_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    action: Mapped[str] = mapped_column(String(10), nullable=False)
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("app_user.id", ondelete="RESTRICT")
    )
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    request_id: Mapped[str | None] = mapped_column(String(40))


class MigrationBatch(Base):
    """마이그레이션 배치 (§7.3)."""

    __tablename__ = "migration_batch"
    __table_args__ = (
        CheckConstraint(sql_in("source", MigrationSource), name="source"),
        CheckConstraint(sql_in("status", MigrationStatus), name="status"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    source: Mapped[str] = mapped_column(String(10), nullable=False)
    entity: Mapped[str] = mapped_column(String(20), nullable=False)
    source_file: Mapped[str] = mapped_column(String(300), nullable=False)
    source_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    extracted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    row_count_src: Mapped[int] = mapped_column(Integer, nullable=False)
    row_count_loaded: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    row_count_merged: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    status: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'PREVIEW'")
    )
    created_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("app_user.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class MigrationMap(Base):
    """legacy_id ↔ new_id (§7.4)."""

    __tablename__ = "migration_map"
    __table_args__ = (UniqueConstraint("entity", "legacy_id"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    batch_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("migration_batch.id", ondelete="RESTRICT"), nullable=False
    )
    entity: Mapped[str] = mapped_column(String(20), nullable=False)
    legacy_id: Mapped[str] = mapped_column(String(50), nullable=False)
    new_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    note: Mapped[str | None] = mapped_column(String(200))

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
    SmallInteger,
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
        Index("ix_audit_log_table_row_key", "table_name", "row_key"),
        CheckConstraint(sql_in("action", AuditAction), name="action"),
        CheckConstraint("row_id IS NOT NULL OR row_key IS NOT NULL", name="row_ref"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    table_name: Mapped[str] = mapped_column(String(40), nullable=False)
    # 0006 (db-schema §15, F24): 숫자 PK 는 row_id, 자연키(station·process·…)는 row_key.
    # 둘 중 하나는 필수
    row_id: Mapped[int | None] = mapped_column(BigInteger)
    row_key: Mapped[str | None] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(10), nullable=False)
    # DEF-QA1-001/DEF-QA2-004: None 은 JSON 'null' 이 아니라 SQL NULL 로 (before IS NULL 조회 가능)
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONB(none_as_null=True))
    after: Mapped[dict[str, Any] | None] = mapped_column(JSONB(none_as_null=True))
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
    # db-schema §7.3 은 VARCHAR(10) 이나 CHECK 값 'ROLLED_BACK' 이 11자
    # → 0005 에서 12 로 확장 (계약 결함으로 보고)
    status: Mapped[str] = mapped_column(
        String(12), nullable=False, server_default=text("'PREVIEW'")
    )
    created_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("app_user.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # 0005 (§14.2, admin #23·#24): 미리보기 오류·중복 후보 보존, commit 시 병합 정책
    errors: Mapped[list[Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    duplicates: Mapped[list[Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    merge_policy: Mapped[str | None] = mapped_column(String(10))
    # 0006: 대사식 row_count_src = loaded + merged + skipped + failed + ignored (F30, ADM-31)
    row_count_skipped: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default=text("0")
    )
    row_count_failed: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default=text("0")
    )
    row_count_ignored: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, server_default=text("0")
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

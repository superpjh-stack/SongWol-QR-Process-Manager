"""스캔 이벤트 (db-schema §4).

scan_event — append-only, ``received_at`` 월 RANGE 파티션 (부모 테이블). 파티션 자체는
Alembic 0003 과 ``infra/scripts/create_partitions.py`` 가 만든다. DEFAULT 파티션은 없다
(파티션 누락 = INSERT 실패, 조용한 실패 금지).
scan_event_key — event_uuid 멱등키 (파티션 테이블은 파티션 키 없는 UNIQUE 불가, §12-14).
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    PrimaryKeyConstraint,
    Sequence,
    String,
    Text,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import SCHEMA, Base
from app.db.models.enums import ApprovalStatus, ScanAction, ScanResult, ScanTargetType, sql_in

__all__ = ["SCAN_EVENT_ID_SEQ", "ScanEvent", "ScanEventKey"]

# PG 16 은 파티션 테이블에 IDENTITY 컬럼을 허용하지 않는다 (17 부터 허용).
# db-schema §1 이 IDENTITY 를 "bigserial 동등" 으로 정의하고 §13-9 가 16 호환 문법을 요구하므로
# scan_event.id 만 시퀀스 기본값(bigserial 동등)을 쓴다.
SCAN_EVENT_ID_SEQ = Sequence("scan_event_id_seq", schema=SCHEMA)


class ScanEvent(Base):
    """scan_event (§4.1). PK(id, received_at)."""

    __tablename__ = "scan_event"
    __table_args__ = (
        PrimaryKeyConstraint("id", "received_at"),
        CheckConstraint(sql_in("target_type", ScanTargetType), name="target_type"),
        CheckConstraint(sql_in("action", ScanAction), name="action"),
        CheckConstraint(sql_in("result", ScanResult), name="result"),
        CheckConstraint(sql_in("approval_status", ApprovalStatus), name="approval_status"),
        Index("ix_scan_event_target", "target_code", text("scanned_at DESC")),
        Index("ix_scan_event_station", "station_id", text("scanned_at DESC")),
        Index("ix_scan_event_wo", "wo_id", "received_at"),
        Index(
            "ix_scan_event_pending",
            "approval_status",
            postgresql_where=text("approval_status = 'PENDING'"),
        ),
        {"postgresql_partition_by": "RANGE (received_at)"},
    )

    id: Mapped[int] = mapped_column(
        BigInteger, SCAN_EVENT_ID_SEQ, server_default=SCAN_EVENT_ID_SEQ.next_value()
    )
    event_uuid: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    scanned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    station_id: Mapped[str] = mapped_column(
        String(20), ForeignKey("station.id", ondelete="RESTRICT"), nullable=False
    )
    process_code: Mapped[str | None] = mapped_column(
        String(3), ForeignKey("process.code", ondelete="RESTRICT")
    )
    worker_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("app_user.id", ondelete="RESTRICT")
    )
    target_type: Mapped[str] = mapped_column(String(5), nullable=False)
    target_code: Mapped[str] = mapped_column(String(64), nullable=False)
    action: Mapped[str] = mapped_column(String(10), nullable=False)
    qty_good: Mapped[int | None] = mapped_column(Integer)
    qty_bad: Mapped[int | None] = mapped_column(Integer)
    qty_box: Mapped[int | None] = mapped_column(Integer)
    equipment_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("equipment.id", ondelete="RESTRICT")
    )
    payload: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    result: Mapped[str] = mapped_column(String(10), nullable=False)
    result_msg: Mapped[str | None] = mapped_column(Text)
    approval_status: Mapped[str | None] = mapped_column(String(10))
    compensates_uuid: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    wo_id: Mapped[int | None] = mapped_column(BigInteger)


class ScanEventKey(Base):
    """멱등키 (§4.2). 같은 트랜잭션에서 scan_event 보다 먼저 INSERT (PK 충돌 = 중복)."""

    __tablename__ = "scan_event_key"

    event_uuid: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    event_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    result: Mapped[str] = mapped_column(String(10), nullable=False)
    response: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)

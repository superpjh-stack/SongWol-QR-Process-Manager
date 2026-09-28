"""출하 (db-schema §6).

pack_box · shipment · shipment_box
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    PrimaryKeyConstraint,
    SmallInteger,
    String,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.models.enums import ShipmentStatus, sql_in

__all__ = ["PackBox", "Shipment", "ShipmentBox"]


class PackBox(Base):
    """발송 박스 LOT (§6.1). shipment_id 는 shipment_box 의 캐시 (§13-3)."""

    __tablename__ = "pack_box"
    __table_args__ = (
        UniqueConstraint("wo_id", "box_no"),
        CheckConstraint("qty > 0", name="qty"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    code: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    wo_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("work_order.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    box_no: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    qty: Mapped[int] = mapped_column(Integer, nullable=False)
    packed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    worker_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("app_user.id", ondelete="RESTRICT"), nullable=False
    )
    station_id: Mapped[str | None] = mapped_column(
        String(20), ForeignKey("station.id", ondelete="RESTRICT")
    )
    shipment_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("shipment.id", ondelete="RESTRICT")
    )
    event_uuid: Mapped[uuid.UUID | None] = mapped_column(Uuid)


class Shipment(Base):
    """출하 (§6.2)."""

    __tablename__ = "shipment"
    __table_args__ = (CheckConstraint(sql_in("status", ShipmentStatus), name="status"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    so_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("sales_order.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    carrier: Mapped[str | None] = mapped_column(String(20))
    tracking_no: Mapped[str | None] = mapped_column(String(40), index=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, server_default=text("'READY'"))
    shipped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    worker_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("app_user.id", ondelete="RESTRICT")
    )
    station_id: Mapped[str | None] = mapped_column(
        String(20), ForeignKey("station.id", ondelete="RESTRICT")
    )
    qty_total: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    event_uuid: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ShipmentBox(Base):
    """출하 ↔ 박스 원장 (§6.3). UK(box_id) — 1박스 1송장.

    ``reconciled_at`` (S3 수정 웨이브, DEF-QA1-S3-001/DEF-QA2-S3-004): 이 박스의 재고·WO·P60
    반영이 실제로 적용됐는지를 **박스 단위로** 추적한다. NULL 이면 아직 반영 전(§6.4 합류만
    되고 확정 대기 — REST ``confirm=false`` 로 모은 박스, 또는 이미 SHIPPED 로 확정된 shipment
    에 나중 스캔이 합류시켰지만 아직 그 반영 루프를 못 탄 박스). ``apply_ship`` 의 확정
    (``confirm=True``) 경로는 이 컬럼이 NULL 인 박스만 골라 정확히 한 번씩 반영한 뒤 채운다 —
    shipment.status 만으로 게이팅하면(예전 방식) 이미 SHIPPED 인 shipment 에 박스가 나중에
    합류할 때 기존에 반영된 박스까지 다시 반영해 이중 계상되는 문제가 있었다."""

    __tablename__ = "shipment_box"
    __table_args__ = (
        PrimaryKeyConstraint("shipment_id", "box_id"),
        UniqueConstraint("box_id"),
    )

    shipment_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("shipment.id", ondelete="RESTRICT"), nullable=False
    )
    box_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("pack_box.id", ondelete="RESTRICT"), nullable=False
    )
    reconciled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

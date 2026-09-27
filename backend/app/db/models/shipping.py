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
    """출하 ↔ 박스 원장 (§6.3). UK(box_id) — 1박스 1송장."""

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

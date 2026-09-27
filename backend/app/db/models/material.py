"""자재 (db-schema §5).

inbound_lot · material_receipt · vendor_barcode_map · stock · stock_txn
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.models.enums import Inspection, LotStatus, StockSource, StockTxnType, sql_in

__all__ = ["InboundLot", "MaterialReceipt", "Stock", "StockTxn", "VendorBarcodeMap"]


class InboundLot(Base):
    """입고 LOT (§5.1). `LT-YYMMDD-NNNN` — pack_box 와 같은 LT 시퀀스 (§12-17)."""

    __tablename__ = "inbound_lot"
    __table_args__ = (
        CheckConstraint("qty > 0", name="qty"),
        CheckConstraint(sql_in("status", LotStatus), name="status"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    code: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    item_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("item.id", ondelete="RESTRICT"), nullable=False
    )
    vendor: Mapped[str | None] = mapped_column(String(100))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    qty: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, server_default=text("'OK'"))
    quarantine_memo: Mapped[str | None] = mapped_column(String(300))


class MaterialReceipt(Base):
    """입고 (§5.2)."""

    __tablename__ = "material_receipt"
    __table_args__ = (
        CheckConstraint("qty > 0", name="qty"),
        CheckConstraint(sql_in("inspection", Inspection), name="inspection"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    wo_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("work_order.id", ondelete="RESTRICT")
    )
    item_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("item.id", ondelete="RESTRICT"), nullable=False
    )
    lot_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("inbound_lot.id", ondelete="RESTRICT"), nullable=False
    )
    qty: Mapped[int] = mapped_column(Integer, nullable=False)
    box_count: Mapped[int | None] = mapped_column(Integer)
    inspection: Mapped[str] = mapped_column(String(5), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    worker_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("app_user.id", ondelete="RESTRICT"), nullable=False
    )
    station_id: Mapped[str | None] = mapped_column(
        String(20), ForeignKey("station.id", ondelete="RESTRICT")
    )
    vendor_barcode: Mapped[str | None] = mapped_column(String(64))
    event_uuid: Mapped[uuid.UUID | None] = mapped_column(Uuid)


class VendorBarcodeMap(Base):
    """협력업체 바코드 매핑 (§5.3)."""

    __tablename__ = "vendor_barcode_map"
    __table_args__ = (
        UniqueConstraint("vendor_barcode", "wo_id"),
        Index("ix_vendor_barcode_map_vendor_barcode", "vendor_barcode"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    vendor_barcode: Mapped[str] = mapped_column(String(64), nullable=False)
    wo_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("work_order.id", ondelete="RESTRICT"), nullable=False
    )
    item_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("item.id", ondelete="RESTRICT"), nullable=False
    )
    mapped_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    mapped_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("app_user.id", ondelete="RESTRICT"), nullable=False
    )
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))


class Stock(Base):
    """현재고 (§5.4). PK = item_id."""

    __tablename__ = "stock"

    item_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("item.id", ondelete="RESTRICT"), primary_key=True
    )
    qty_on_hand: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class StockTxn(Base):
    """재고 거래 (§5.5)."""

    __tablename__ = "stock_txn"
    __table_args__ = (
        Index("ix_stock_txn_item_id_created_at", "item_id", "created_at"),
        CheckConstraint(sql_in("txn_type", StockTxnType), name="txn_type"),
        CheckConstraint("qty <> 0", name="qty"),
        CheckConstraint(sql_in("source", StockSource), name="source"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    item_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("item.id", ondelete="RESTRICT"), nullable=False
    )
    txn_type: Mapped[str] = mapped_column(String(10), nullable=False)
    qty: Mapped[int] = mapped_column(Integer, nullable=False)
    ref_type: Mapped[str | None] = mapped_column(String(20))
    ref_id: Mapped[int | None] = mapped_column(BigInteger)
    reason: Mapped[str | None] = mapped_column(String(200))
    source: Mapped[str] = mapped_column(String(10), nullable=False, server_default=text("'NEW'"))
    created_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("app_user.id", ondelete="RESTRICT")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

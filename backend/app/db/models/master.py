"""기준정보 (db-schema §2).

customer · customer_address · item · process · equipment · print_method · item_routing
· routing_step · station · app_user · printer · code_sequence
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.models._mixins import TimestampMixin
from app.db.models.enums import EquipType, PrinterPurpose, Role, StationType, sql_in

__all__ = [
    "AppUser",
    "CodeSequence",
    "Customer",
    "CustomerAddress",
    "Equipment",
    "Item",
    "ItemRouting",
    "PrintMethod",
    "Printer",
    "Process",
    "RoutingStep",
    "Station",
]


class Customer(TimestampMixin, Base):
    """거래처 (§2.1)."""

    __tablename__ = "customer"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    code: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    contact_name: Mapped[str | None] = mapped_column(String(50))
    phone: Mapped[str | None] = mapped_column(String(30))
    email: Mapped[str | None] = mapped_column(String(100))
    default_carrier: Mapped[str | None] = mapped_column(String(20))
    legacy_id: Mapped[str | None] = mapped_column(String(50))
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))

    addresses: Mapped[list["CustomerAddress"]] = relationship(back_populates="customer")


class CustomerAddress(Base):
    """거래처 배송지 (§2.2, §12-4)."""

    __tablename__ = "customer_address"
    __table_args__ = (
        Index(
            "uq_customer_address_default",
            "customer_id",
            unique=True,
            postgresql_where=text("is_default"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    customer_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("customer.id", ondelete="RESTRICT"), nullable=False
    )
    label: Mapped[str] = mapped_column(String(50), nullable=False)
    receiver: Mapped[str | None] = mapped_column(String(50))
    phone: Mapped[str | None] = mapped_column(String(30))
    postal_code: Mapped[str | None] = mapped_column(String(10))
    address1: Mapped[str] = mapped_column(String(200), nullable=False)
    address2: Mapped[str | None] = mapped_column(String(200))
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))

    customer: Mapped[Customer] = relationship(back_populates="addresses")


class Item(TimestampMixin, Base):
    """품목(완제 타월) (§2.3)."""

    __tablename__ = "item"
    __table_args__ = (
        CheckConstraint(
            "qty_tolerance_pct >= 0 AND qty_tolerance_pct <= 50", name="qty_tolerance_pct"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    code: Mapped[str] = mapped_column(String(30), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    item_group: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    spec: Mapped[str | None] = mapped_column(String(50))
    color: Mapped[str | None] = mapped_column(String(30))
    weight_g: Mapped[int | None] = mapped_column(Integer)
    vendor_item_code: Mapped[str | None] = mapped_column(String(50))
    vendor_barcode: Mapped[str | None] = mapped_column(String(64), index=True)
    qty_tolerance_pct: Mapped[Decimal] = mapped_column(
        Numeric(4, 1), nullable=False, server_default=text("3.0")
    )
    legacy_id: Mapped[str | None] = mapped_column(String(50))
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))


class Process(Base):
    """공정 (§2.4). P40 은 존재하지 않는다. CHECK IN 목록은 두지 않는다 (spec §13 확장성)."""

    __tablename__ = "process"

    code: Mapped[str] = mapped_column(String(3), primary_key=True)
    name: Mapped[str] = mapped_column(String(30), nullable=False)
    seq: Mapped[int] = mapped_column(SmallInteger, nullable=False, unique=True)
    requires_equipment: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    required_inputs: Mapped[list[Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))


class Equipment(Base):
    """설비 (§2.5)."""

    __tablename__ = "equipment"
    __table_args__ = (CheckConstraint(sql_in("equip_type", EquipType), name="equip_type"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    code: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    process_code: Mapped[str] = mapped_column(
        String(3),
        ForeignKey("process.code", ondelete="RESTRICT"),
        nullable=False,
        server_default=text("'P30'"),
    )
    equip_type: Mapped[str] = mapped_column(String(10), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))


class PrintMethod(Base):
    """가공방식 (§2.6)."""

    __tablename__ = "print_method"

    code: Mapped[str] = mapped_column(String(20), primary_key=True)
    name: Mapped[str] = mapped_column(String(30), nullable=False)
    equip_types: Mapped[list[Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    skips_p30: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))


class ItemRouting(TimestampMixin, Base):
    """라우팅 헤더 (§2.7)."""

    __tablename__ = "item_routing"
    __table_args__ = (UniqueConstraint("item_group", "print_method"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    item_group: Mapped[str] = mapped_column(String(30), nullable=False)
    print_method: Mapped[str] = mapped_column(
        String(20), ForeignKey("print_method.code", ondelete="RESTRICT"), nullable=False
    )
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))

    steps: Mapped[list["RoutingStep"]] = relationship(
        back_populates="routing", order_by="RoutingStep.seq"
    )


class RoutingStep(Base):
    """라우팅 단계 (§2.8)."""

    __tablename__ = "routing_step"
    __table_args__ = (
        UniqueConstraint("routing_id", "seq"),
        UniqueConstraint("routing_id", "process_code"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    routing_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("item_routing.id", ondelete="RESTRICT"), nullable=False
    )
    seq: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    process_code: Mapped[str] = mapped_column(
        String(3), ForeignKey("process.code", ondelete="RESTRICT"), nullable=False
    )
    std_lead_hours: Mapped[Decimal] = mapped_column(Numeric(6, 1), nullable=False)
    tolerance_pct: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))

    routing: Mapped[ItemRouting] = relationship(back_populates="steps")


class Station(TimestampMixin, Base):
    """단말 (§2.9). PK 는 단말 코드 자연키."""

    __tablename__ = "station"
    __table_args__ = (CheckConstraint(sql_in("type", StationType), name="type"),)

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    type: Mapped[str] = mapped_column(String(10), nullable=False)
    process_code: Mapped[str | None] = mapped_column(
        String(3), ForeignKey("process.code", ondelete="RESTRICT")
    )
    location: Mapped[str | None] = mapped_column(String(100))
    api_key_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    api_key_prefix: Mapped[str] = mapped_column(String(8), nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))


class AppUser(TimestampMixin, Base):
    """사용자 (§2.10, spec `user` → 예약어 회피)."""

    __tablename__ = "app_user"
    __table_args__ = (CheckConstraint(sql_in("role", Role), name="role"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    login_id: Mapped[str] = mapped_column(String(30), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    role: Mapped[str] = mapped_column(String(10), nullable=False)
    card_code: Mapped[str | None] = mapped_column(String(10), unique=True)
    pin_hash: Mapped[str | None] = mapped_column(String(128))
    password_hash: Mapped[str | None] = mapped_column(String(128))
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))


class Printer(Base):
    """라벨 프린터 (§2.11)."""

    __tablename__ = "printer"
    __table_args__ = (CheckConstraint(sql_in("purpose", PrinterPurpose), name="purpose"),)

    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    host: Mapped[str] = mapped_column(String(100), nullable=False)
    port: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("9100"))
    purpose: Mapped[str] = mapped_column(String(20), nullable=False)
    location: Mapped[str | None] = mapped_column(String(100))
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))


class CodeSequence(Base):
    """채번 (§2.12, plan §5.1). US 는 seq_date='1970-01-01' 고정 행 (§12-9)."""

    __tablename__ = "code_sequence"

    prefix: Mapped[str] = mapped_column(String(4), primary_key=True)
    seq_date: Mapped[date] = mapped_column(Date, primary_key=True)
    last_no: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))

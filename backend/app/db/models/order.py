"""수주·작업지시 (db-schema §3).

sales_order · sales_order_line · design · work_order · wo_route_step · step_work · label_issue
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    CHAR,
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
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.models._mixins import CreatedAtMixin, TimestampMixin
from app.db.models.enums import (
    LabelTargetType,
    LabelType,
    ReceiptStatus,
    SoStatus,
    StepStatus,
    WoStatus,
    sql_in,
)

__all__ = [
    "Design",
    "LabelIssue",
    "SalesOrder",
    "SalesOrderLine",
    "StepWork",
    "WoRouteStep",
    "WorkOrder",
]


class SalesOrder(TimestampMixin, Base):
    """수주 (§3.1)."""

    __tablename__ = "sales_order"
    __table_args__ = (CheckConstraint(sql_in("status", SoStatus), name="status"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    code: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    customer_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("customer.id", ondelete="RESTRICT"), nullable=False
    )
    order_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    ship_to: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'OPEN'"))
    progress_pct: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, server_default=text("0")
    )
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    shipped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    memo: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("app_user.id", ondelete="RESTRICT"), nullable=False
    )
    # 0005 (§14.2, admin 필드 G) [S1]
    cancel_reason: Mapped[str | None] = mapped_column(String(200))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("app_user.id", ondelete="RESTRICT")
    )

    lines: Mapped[list["SalesOrderLine"]] = relationship(
        back_populates="sales_order", order_by="SalesOrderLine.line_no"
    )


class SalesOrderLine(Base):
    """수주 라인 (§3.2). design_id 는 design.so_line_id 와 순환 FK → use_alter (§11)."""

    __tablename__ = "sales_order_line"
    __table_args__ = (
        UniqueConstraint("so_id", "line_no"),
        CheckConstraint("qty > 0", name="qty"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    so_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("sales_order.id", ondelete="RESTRICT"), nullable=False
    )
    line_no: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    item_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("item.id", ondelete="RESTRICT"), nullable=False
    )
    print_method: Mapped[str] = mapped_column(
        String(20), ForeignKey("print_method.code", ondelete="RESTRICT"), nullable=False
    )
    qty: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    design_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey(
            "design.id",
            ondelete="RESTRICT",
            use_alter=True,
            name="fk_sales_order_line_design_id",
        ),
    )
    design_confirmed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    sales_order: Mapped[SalesOrder] = relationship(back_populates="lines")


class Design(CreatedAtMixin, Base):
    """도안 (§3.3)."""

    __tablename__ = "design"
    __table_args__ = (
        UniqueConstraint("so_line_id", "version"),
        Index("uq_design_current", "so_line_id", unique=True, postgresql_where=text("is_current")),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    so_line_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("sales_order_line.id", ondelete="RESTRICT"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    file_path: Mapped[str] = mapped_column(String(300), nullable=False)
    thumbnail_path: Mapped[str | None] = mapped_column(String(300))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    uploaded_by: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("app_user.id", ondelete="RESTRICT"), nullable=False
    )
    # 0005 (§14.2, admin 필드 H) [S1]
    confirmed_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("app_user.id", ondelete="RESTRICT")
    )


class WorkOrder(TimestampMixin, Base):
    """작업지시 (§3.4)."""

    __tablename__ = "work_order"
    __table_args__ = (
        UniqueConstraint("parent_wo_id", "split_suffix"),
        Index("ix_work_order_status_so_id", "status", "so_id"),
        CheckConstraint("qty_ordered > 0", name="qty_ordered"),
        CheckConstraint(sql_in("receipt_status", ReceiptStatus), name="receipt_status"),
        CheckConstraint(sql_in("status", WoStatus), name="status"),
        CheckConstraint("split_suffix ~ '^[A-Z]$'", name="split_suffix"),
        CheckConstraint("(parent_wo_id IS NULL) = (split_suffix IS NULL)", name="split_parent"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    code: Mapped[str] = mapped_column(String(24), nullable=False, unique=True)
    parent_wo_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("work_order.id", ondelete="RESTRICT")
    )
    split_suffix: Mapped[str | None] = mapped_column(CHAR(1))
    so_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("sales_order.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    so_line_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("sales_order_line.id", ondelete="RESTRICT"), nullable=False
    )
    item_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("item.id", ondelete="RESTRICT"), nullable=False
    )
    print_method: Mapped[str] = mapped_column(
        String(20), ForeignKey("print_method.code", ondelete="RESTRICT"), nullable=False
    )
    design_version: Mapped[int | None] = mapped_column(Integer)
    qty_ordered: Mapped[int] = mapped_column(Integer, nullable=False)
    qty_received: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    qty_good: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    qty_bad: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    qty_packed: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    qty_shipped: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    receipt_status: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default=text("'NONE'")
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'DRAFT'"))
    current_step_seq: Mapped[int | None] = mapped_column(SmallInteger)
    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    hold_reason: Mapped[str | None] = mapped_column(String(200))

    route_steps: Mapped[list["WoRouteStep"]] = relationship(
        back_populates="work_order", order_by="WoRouteStep.seq"
    )


class WoRouteStep(Base):
    """WO 공정 단계 — 라우팅 스냅샷 (§3.5)."""

    __tablename__ = "wo_route_step"
    __table_args__ = (
        UniqueConstraint("wo_id", "seq"),
        UniqueConstraint("wo_id", "process_code"),
        CheckConstraint(sql_in("status", StepStatus), name="status"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    wo_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("work_order.id", ondelete="RESTRICT"), nullable=False
    )
    seq: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    process_code: Mapped[str] = mapped_column(
        String(3), ForeignKey("process.code", ondelete="RESTRICT"), nullable=False
    )
    std_lead_hours: Mapped[Decimal] = mapped_column(Numeric(6, 1), nullable=False)
    tolerance_pct: Mapped[Decimal] = mapped_column(Numeric(4, 1), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'WAITING'")
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    qty_in: Mapped[int | None] = mapped_column(Integer)
    qty_good: Mapped[int | None] = mapped_column(Integer)
    qty_bad: Mapped[int | None] = mapped_column(Integer)
    equipment_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("equipment.id", ondelete="RESTRICT")
    )
    worker_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("app_user.id", ondelete="RESTRICT")
    )
    is_estimated: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    approved_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("app_user.id", ondelete="RESTRICT")
    )
    variance_reason: Mapped[str | None] = mapped_column(String(200))

    work_order: Mapped[WorkOrder] = relationship(back_populates="route_steps")


class StepWork(Base):
    """P30 설비별 작업 (§3.6) [확장]. 파일럿도 1행은 쓴다."""

    __tablename__ = "step_work"
    __table_args__ = (UniqueConstraint("route_step_id", "seq"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    route_step_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("wo_route_step.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    seq: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    equipment_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("equipment.id", ondelete="RESTRICT"), nullable=False
    )
    worker_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("app_user.id", ondelete="RESTRICT"), nullable=False
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    qty_good: Mapped[int | None] = mapped_column(Integer)
    qty_bad: Mapped[int | None] = mapped_column(Integer)


class LabelIssue(Base):
    """라벨 발행 이력 (§3.7)."""

    __tablename__ = "label_issue"
    __table_args__ = (
        UniqueConstraint("target_type", "target_code", "label_type", "issue_no"),
        Index("ix_label_issue_target_type_target_code", "target_type", "target_code"),
        CheckConstraint(sql_in("target_type", LabelTargetType), name="target_type"),
        CheckConstraint(sql_in("label_type", LabelType), name="label_type"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    target_type: Mapped[str] = mapped_column(String(5), nullable=False)
    target_code: Mapped[str] = mapped_column(String(30), nullable=False)
    label_type: Mapped[str] = mapped_column(String(20), nullable=False)
    issue_no: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default=text("1"))
    printer_id: Mapped[str | None] = mapped_column(
        String(20), ForeignKey("printer.id", ondelete="RESTRICT")
    )
    copies: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default=text("1"))
    issued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    issued_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("app_user.id", ondelete="RESTRICT")
    )
    station_id: Mapped[str | None] = mapped_column(
        String(20), ForeignKey("station.id", ondelete="RESTRICT")
    )

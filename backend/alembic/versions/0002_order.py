"""0002_order — 수주·작업지시

Revision ID: 0002_order
Revises: 0001_master
Create Date: 2026-09-28

contracts/db-schema.md §11 리비전 순서. 테이블·컬럼·제약은 db-schema 그대로 (SQLAlchemy 모델 app/db/models 와 1:1).
sales_order_line.design_id ↔ design.so_line_id 순환 FK: design 을 만든 뒤 FK 를 ALTER 로 붙인다 (§11).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0002_order"
down_revision: str | None = "0001_master"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "mes"


def upgrade() -> None:
    op.create_table(
        "sales_order",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("code", sa.String(length=20), nullable=False),
        sa.Column("customer_id", sa.BigInteger(), nullable=False),
        sa.Column("order_date", sa.Date(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("ship_to", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("status", sa.String(length=20), server_default=sa.text("'OPEN'"), nullable=False),
        sa.Column(
            "progress_pct",
            sa.Numeric(precision=5, scale=2),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("shipped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("memo", sa.Text(), nullable=True),
        sa.Column("created_by", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('OPEN', 'IN_PROGRESS', 'PARTIAL_SHIPPED', 'SHIPPED', 'CLOSED', 'CANCELLED')",
            name=op.f("ck_sales_order_status"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["mes.app_user.id"],
            name=op.f("fk_sales_order_created_by"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["customer_id"],
            ["mes.customer.id"],
            name=op.f("fk_sales_order_customer_id"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sales_order")),
        sa.UniqueConstraint("code", name=op.f("uq_sales_order_code")),
        schema="mes",
    )
    op.create_index(
        op.f("ix_sales_order_due_date"), "sales_order", ["due_date"], unique=False, schema="mes"
    )
    op.create_table(
        "label_issue",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("target_type", sa.String(length=5), nullable=False),
        sa.Column("target_code", sa.String(length=30), nullable=False),
        sa.Column("label_type", sa.String(length=20), nullable=False),
        sa.Column("issue_no", sa.SmallInteger(), server_default=sa.text("1"), nullable=False),
        sa.Column("printer_id", sa.String(length=20), nullable=True),
        sa.Column("copies", sa.SmallInteger(), server_default=sa.text("1"), nullable=False),
        sa.Column(
            "issued_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("issued_by", sa.BigInteger(), nullable=True),
        sa.Column("station_id", sa.String(length=20), nullable=True),
        sa.CheckConstraint(
            "label_type IN ('WORK_ORDER_PDF', 'WO_LABEL', 'BOX_LABEL', 'WORKER_CARD')",
            name=op.f("ck_label_issue_label_type"),
        ),
        sa.CheckConstraint(
            "target_type IN ('SO', 'WO', 'LT', 'US')", name=op.f("ck_label_issue_target_type")
        ),
        sa.ForeignKeyConstraint(
            ["issued_by"],
            ["mes.app_user.id"],
            name=op.f("fk_label_issue_issued_by"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["printer_id"],
            ["mes.printer.id"],
            name=op.f("fk_label_issue_printer_id"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["station_id"],
            ["mes.station.id"],
            name=op.f("fk_label_issue_station_id"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_label_issue")),
        sa.UniqueConstraint(
            "target_type",
            "target_code",
            "label_type",
            "issue_no",
            name=op.f("uq_label_issue_target_type_target_code_label_type_issue_no"),
        ),
        schema="mes",
    )
    op.create_index(
        "ix_label_issue_target_type_target_code",
        "label_issue",
        ["target_type", "target_code"],
        unique=False,
        schema="mes",
    )
    op.create_table(
        "sales_order_line",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("so_id", sa.BigInteger(), nullable=False),
        sa.Column("line_no", sa.SmallInteger(), nullable=False),
        sa.Column("item_id", sa.BigInteger(), nullable=False),
        sa.Column("print_method", sa.String(length=20), nullable=False),
        sa.Column("qty", sa.Integer(), nullable=False),
        sa.Column("unit_price", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("design_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "design_confirmed", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.CheckConstraint("qty > 0", name=op.f("ck_sales_order_line_qty")),
        sa.ForeignKeyConstraint(
            ["item_id"],
            ["mes.item.id"],
            name=op.f("fk_sales_order_line_item_id"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["print_method"],
            ["mes.print_method.code"],
            name=op.f("fk_sales_order_line_print_method"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["so_id"],
            ["mes.sales_order.id"],
            name=op.f("fk_sales_order_line_so_id"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sales_order_line")),
        sa.UniqueConstraint("so_id", "line_no", name=op.f("uq_sales_order_line_so_id_line_no")),
        schema="mes",
    )
    op.create_table(
        "design",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("so_line_id", sa.BigInteger(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("file_path", sa.String(length=300), nullable=False),
        sa.Column("thumbnail_path", sa.String(length=300), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_current", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("uploaded_by", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["so_line_id"],
            ["mes.sales_order_line.id"],
            name=op.f("fk_design_so_line_id"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["uploaded_by"],
            ["mes.app_user.id"],
            name=op.f("fk_design_uploaded_by"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_design")),
        sa.UniqueConstraint("so_line_id", "version", name=op.f("uq_design_so_line_id_version")),
        schema="mes",
    )
    op.create_index(
        "uq_design_current",
        "design",
        ["so_line_id"],
        unique=True,
        schema="mes",
        postgresql_where=sa.text("is_current"),
    )
    op.create_table(
        "work_order",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("code", sa.String(length=24), nullable=False),
        sa.Column("parent_wo_id", sa.BigInteger(), nullable=True),
        sa.Column("split_suffix", sa.CHAR(length=1), nullable=True),
        sa.Column("so_id", sa.BigInteger(), nullable=False),
        sa.Column("so_line_id", sa.BigInteger(), nullable=False),
        sa.Column("item_id", sa.BigInteger(), nullable=False),
        sa.Column("print_method", sa.String(length=20), nullable=False),
        sa.Column("design_version", sa.Integer(), nullable=True),
        sa.Column("qty_ordered", sa.Integer(), nullable=False),
        sa.Column("qty_received", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("qty_good", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("qty_bad", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("qty_packed", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("qty_shipped", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "receipt_status", sa.String(length=10), server_default=sa.text("'NONE'"), nullable=False
        ),
        sa.Column(
            "status", sa.String(length=20), server_default=sa.text("'DRAFT'"), nullable=False
        ),
        sa.Column("current_step_seq", sa.SmallInteger(), nullable=True),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("hold_reason", sa.String(length=200), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "receipt_status IN ('NONE', 'PARTIAL', 'FULL', 'OVER')",
            name=op.f("ck_work_order_receipt_status"),
        ),
        sa.CheckConstraint("split_suffix ~ '^[A-Z]$'", name=op.f("ck_work_order_split_suffix")),
        sa.CheckConstraint(
            "status IN ('DRAFT', 'ISSUED', 'IN_PROGRESS', 'PACKED', 'SHIPPED', 'CLOSED', 'ON_HOLD', 'CANCELLED')",
            name=op.f("ck_work_order_status"),
        ),
        sa.CheckConstraint(
            "(parent_wo_id IS NULL) = (split_suffix IS NULL)",
            name=op.f("ck_work_order_split_parent"),
        ),
        sa.CheckConstraint("qty_ordered > 0", name=op.f("ck_work_order_qty_ordered")),
        sa.ForeignKeyConstraint(
            ["item_id"], ["mes.item.id"], name=op.f("fk_work_order_item_id"), ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["parent_wo_id"],
            ["mes.work_order.id"],
            name=op.f("fk_work_order_parent_wo_id"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["print_method"],
            ["mes.print_method.code"],
            name=op.f("fk_work_order_print_method"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["so_id"], ["mes.sales_order.id"], name=op.f("fk_work_order_so_id"), ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["so_line_id"],
            ["mes.sales_order_line.id"],
            name=op.f("fk_work_order_so_line_id"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_work_order")),
        sa.UniqueConstraint("code", name=op.f("uq_work_order_code")),
        sa.UniqueConstraint(
            "parent_wo_id", "split_suffix", name=op.f("uq_work_order_parent_wo_id_split_suffix")
        ),
        schema="mes",
    )
    op.create_index(
        op.f("ix_work_order_so_id"), "work_order", ["so_id"], unique=False, schema="mes"
    )
    op.create_index(
        "ix_work_order_status_so_id", "work_order", ["status", "so_id"], unique=False, schema="mes"
    )
    op.create_table(
        "wo_route_step",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("wo_id", sa.BigInteger(), nullable=False),
        sa.Column("seq", sa.SmallInteger(), nullable=False),
        sa.Column("process_code", sa.String(length=3), nullable=False),
        sa.Column("std_lead_hours", sa.Numeric(precision=6, scale=1), nullable=False),
        sa.Column("tolerance_pct", sa.Numeric(precision=4, scale=1), nullable=False),
        sa.Column(
            "status", sa.String(length=20), server_default=sa.text("'WAITING'"), nullable=False
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("qty_in", sa.Integer(), nullable=True),
        sa.Column("qty_good", sa.Integer(), nullable=True),
        sa.Column("qty_bad", sa.Integer(), nullable=True),
        sa.Column("equipment_id", sa.BigInteger(), nullable=True),
        sa.Column("worker_id", sa.BigInteger(), nullable=True),
        sa.Column("is_estimated", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("approved_by", sa.BigInteger(), nullable=True),
        sa.Column("variance_reason", sa.String(length=200), nullable=True),
        sa.CheckConstraint(
            "status IN ('WAITING', 'STARTED', 'DONE', 'DONE_ESTIMATED', 'PARTIAL', 'SKIPPED')",
            name=op.f("ck_wo_route_step_status"),
        ),
        sa.ForeignKeyConstraint(
            ["approved_by"],
            ["mes.app_user.id"],
            name=op.f("fk_wo_route_step_approved_by"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["equipment_id"],
            ["mes.equipment.id"],
            name=op.f("fk_wo_route_step_equipment_id"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["process_code"],
            ["mes.process.code"],
            name=op.f("fk_wo_route_step_process_code"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["wo_id"],
            ["mes.work_order.id"],
            name=op.f("fk_wo_route_step_wo_id"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["worker_id"],
            ["mes.app_user.id"],
            name=op.f("fk_wo_route_step_worker_id"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_wo_route_step")),
        sa.UniqueConstraint(
            "wo_id", "process_code", name=op.f("uq_wo_route_step_wo_id_process_code")
        ),
        sa.UniqueConstraint("wo_id", "seq", name=op.f("uq_wo_route_step_wo_id_seq")),
        schema="mes",
    )
    op.create_table(
        "step_work",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("route_step_id", sa.BigInteger(), nullable=False),
        sa.Column("seq", sa.SmallInteger(), nullable=False),
        sa.Column("equipment_id", sa.BigInteger(), nullable=False),
        sa.Column("worker_id", sa.BigInteger(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("qty_good", sa.Integer(), nullable=True),
        sa.Column("qty_bad", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["equipment_id"],
            ["mes.equipment.id"],
            name=op.f("fk_step_work_equipment_id"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["route_step_id"],
            ["mes.wo_route_step.id"],
            name=op.f("fk_step_work_route_step_id"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["worker_id"],
            ["mes.app_user.id"],
            name=op.f("fk_step_work_worker_id"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_step_work")),
        sa.UniqueConstraint("route_step_id", "seq", name=op.f("uq_step_work_route_step_id_seq")),
        schema="mes",
    )
    op.create_index(
        op.f("ix_step_work_route_step_id"),
        "step_work",
        ["route_step_id"],
        unique=False,
        schema="mes",
    )
    op.create_foreign_key(
        "fk_sales_order_line_design_id",
        "sales_order_line",
        "design",
        ["design_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_sales_order_line_design_id", "sales_order_line", schema=SCHEMA, type_="foreignkey"
    )
    op.drop_table("step_work", schema="mes")
    op.drop_table("wo_route_step", schema="mes")
    op.drop_table("work_order", schema="mes")
    op.drop_table("design", schema="mes")
    op.drop_table("sales_order_line", schema="mes")
    op.drop_table("label_issue", schema="mes")
    op.drop_table("sales_order", schema="mes")

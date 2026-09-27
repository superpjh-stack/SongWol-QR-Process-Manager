"""0003_events_material_shipping — scan_event 파티션 · scan_event_key · 자재 · 출하

Revision ID: 0003_events_material_shipping
Revises: 0002_order
Create Date: 2026-09-28

contracts/db-schema.md §11 리비전 순서. 테이블·컬럼·제약은 db-schema 그대로 (SQLAlchemy 모델 app/db/models 와 1:1).
scan_event 는 received_at 월 RANGE 파티션 부모. 초기 파티션(이번 달 ~ +3개월)은
infra/scripts/create_partitions.py 의 함수를 import 해 만든다 (로직 중복 금지). DEFAULT 파티션은 없다.
scan_event.id 는 시퀀스 기본값(bigserial 동등): PG 16 은 파티션 테이블에 IDENTITY 를 허용하지 않는다 (§13-9).
"""

import importlib.util
from collections.abc import Sequence
from pathlib import Path

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0003_events_material_shipping"
down_revision: str | None = "0002_order"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "mes"

SCAN_EVENT_ID_SEQ = sa.Sequence("scan_event_id_seq", schema=SCHEMA)
INITIAL_MONTHS_AHEAD = 3  # 이번 달 + 3개월 = 4 파티션


def _load_create_partitions():  # type: ignore[no-untyped-def]
    """infra/scripts/create_partitions.py 를 파일 경로로 import (패키지가 아니다)."""
    path = Path(__file__).resolve().parents[3] / "infra" / "scripts" / "create_partitions.py"
    if not path.is_file():
        raise RuntimeError(f"create_partitions.py 가 없다: {path} (리포 전체를 체크아웃해야 한다)")
    spec = importlib.util.spec_from_file_location("create_partitions", path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def upgrade() -> None:
    op.execute(sa.schema.CreateSequence(SCAN_EVENT_ID_SEQ))
    op.create_table(
        "scan_event_key",
        sa.Column("event_uuid", sa.Uuid(), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("event_id", sa.BigInteger(), nullable=False),
        sa.Column("result", sa.String(length=10), nullable=False),
        sa.Column("response", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.PrimaryKeyConstraint("event_uuid", name=op.f("pk_scan_event_key")),
        schema="mes",
    )
    op.create_table(
        "inbound_lot",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("code", sa.String(length=20), nullable=False),
        sa.Column("item_id", sa.BigInteger(), nullable=False),
        sa.Column("vendor", sa.String(length=100), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("qty", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=12), server_default=sa.text("'OK'"), nullable=False),
        sa.Column("quarantine_memo", sa.String(length=300), nullable=True),
        sa.CheckConstraint("status IN ('OK', 'QUARANTINE')", name=op.f("ck_inbound_lot_status")),
        sa.CheckConstraint("qty > 0", name=op.f("ck_inbound_lot_qty")),
        sa.ForeignKeyConstraint(
            ["item_id"], ["mes.item.id"], name=op.f("fk_inbound_lot_item_id"), ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_inbound_lot")),
        sa.UniqueConstraint("code", name=op.f("uq_inbound_lot_code")),
        schema="mes",
    )
    op.create_table(
        "stock",
        sa.Column("item_id", sa.BigInteger(), nullable=False),
        sa.Column("qty_on_hand", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["item_id"], ["mes.item.id"], name=op.f("fk_stock_item_id"), ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("item_id", name=op.f("pk_stock")),
        schema="mes",
    )
    op.create_table(
        "stock_txn",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("item_id", sa.BigInteger(), nullable=False),
        sa.Column("txn_type", sa.String(length=10), nullable=False),
        sa.Column("qty", sa.Integer(), nullable=False),
        sa.Column("ref_type", sa.String(length=20), nullable=True),
        sa.Column("ref_id", sa.BigInteger(), nullable=True),
        sa.Column("reason", sa.String(length=200), nullable=True),
        sa.Column("source", sa.String(length=10), server_default=sa.text("'NEW'"), nullable=False),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "source IN ('IMS_XLS', 'NEW', 'COUNT')", name=op.f("ck_stock_txn_source")
        ),
        sa.CheckConstraint(
            "txn_type IN ('MIGRATE', 'RECEIVE', 'SHIP', 'ADJUST', 'REWORK')",
            name=op.f("ck_stock_txn_txn_type"),
        ),
        sa.CheckConstraint("qty <> 0", name=op.f("ck_stock_txn_qty")),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["mes.app_user.id"],
            name=op.f("fk_stock_txn_created_by"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["item_id"], ["mes.item.id"], name=op.f("fk_stock_txn_item_id"), ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_stock_txn")),
        schema="mes",
    )
    op.create_index(
        "ix_stock_txn_item_id_created_at",
        "stock_txn",
        ["item_id", "created_at"],
        unique=False,
        schema="mes",
    )
    op.create_table(
        "scan_event",
        sa.Column(
            "id",
            sa.BigInteger(),
            server_default=sa.text("nextval('mes.scan_event_id_seq')"),
            nullable=False,
        ),
        sa.Column("event_uuid", sa.Uuid(), nullable=False),
        sa.Column("scanned_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("station_id", sa.String(length=20), nullable=False),
        sa.Column("process_code", sa.String(length=3), nullable=True),
        sa.Column("worker_id", sa.BigInteger(), nullable=True),
        sa.Column("target_type", sa.String(length=5), nullable=False),
        sa.Column("target_code", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=10), nullable=False),
        sa.Column("qty_good", sa.Integer(), nullable=True),
        sa.Column("qty_bad", sa.Integer(), nullable=True),
        sa.Column("qty_box", sa.Integer(), nullable=True),
        sa.Column("equipment_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "payload",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("result", sa.String(length=10), nullable=False),
        sa.Column("result_msg", sa.Text(), nullable=True),
        sa.Column("approval_status", sa.String(length=10), nullable=True),
        sa.Column("compensates_uuid", sa.Uuid(), nullable=True),
        sa.Column("wo_id", sa.BigInteger(), nullable=True),
        sa.CheckConstraint(
            "action IN ('START', 'DONE', 'RECEIVE', 'PACK', 'SHIP', 'LOGIN', 'CANCEL', 'REPRINT', 'APPROVE', 'MAP')",
            name=op.f("ck_scan_event_action"),
        ),
        sa.CheckConstraint(
            "approval_status IN ('PENDING', 'APPROVED', 'DENIED')",
            name=op.f("ck_scan_event_approval_status"),
        ),
        sa.CheckConstraint("result IN ('OK', 'WARN', 'REJECT')", name=op.f("ck_scan_event_result")),
        sa.CheckConstraint(
            "target_type IN ('SO', 'WO', 'LT', 'US', 'VB')", name=op.f("ck_scan_event_target_type")
        ),
        sa.ForeignKeyConstraint(
            ["equipment_id"],
            ["mes.equipment.id"],
            name=op.f("fk_scan_event_equipment_id"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["process_code"],
            ["mes.process.code"],
            name=op.f("fk_scan_event_process_code"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["station_id"],
            ["mes.station.id"],
            name=op.f("fk_scan_event_station_id"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["worker_id"],
            ["mes.app_user.id"],
            name=op.f("fk_scan_event_worker_id"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", "received_at", name=op.f("pk_scan_event")),
        schema="mes",
        postgresql_partition_by="RANGE (received_at)",
    )
    op.create_index(
        "ix_scan_event_pending",
        "scan_event",
        ["approval_status"],
        unique=False,
        schema="mes",
        postgresql_where=sa.text("approval_status = 'PENDING'"),
    )
    op.create_index(
        "ix_scan_event_station",
        "scan_event",
        ["station_id", sa.literal_column("scanned_at DESC")],
        unique=False,
        schema="mes",
    )
    op.create_index(
        "ix_scan_event_target",
        "scan_event",
        ["target_code", sa.literal_column("scanned_at DESC")],
        unique=False,
        schema="mes",
    )
    op.create_index(
        "ix_scan_event_wo", "scan_event", ["wo_id", "received_at"], unique=False, schema="mes"
    )
    op.create_table(
        "shipment",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("so_id", sa.BigInteger(), nullable=False),
        sa.Column("carrier", sa.String(length=20), nullable=True),
        sa.Column("tracking_no", sa.String(length=40), nullable=True),
        sa.Column(
            "status", sa.String(length=10), server_default=sa.text("'READY'"), nullable=False
        ),
        sa.Column("shipped_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("worker_id", sa.BigInteger(), nullable=True),
        sa.Column("station_id", sa.String(length=20), nullable=True),
        sa.Column("qty_total", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("event_uuid", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('READY', 'SHIPPED', 'DELIVERED')", name=op.f("ck_shipment_status")
        ),
        sa.ForeignKeyConstraint(
            ["so_id"], ["mes.sales_order.id"], name=op.f("fk_shipment_so_id"), ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["station_id"],
            ["mes.station.id"],
            name=op.f("fk_shipment_station_id"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["worker_id"],
            ["mes.app_user.id"],
            name=op.f("fk_shipment_worker_id"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_shipment")),
        schema="mes",
    )
    op.create_index(op.f("ix_shipment_so_id"), "shipment", ["so_id"], unique=False, schema="mes")
    op.create_index(
        op.f("ix_shipment_tracking_no"), "shipment", ["tracking_no"], unique=False, schema="mes"
    )
    op.create_table(
        "material_receipt",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("wo_id", sa.BigInteger(), nullable=True),
        sa.Column("item_id", sa.BigInteger(), nullable=False),
        sa.Column("lot_id", sa.BigInteger(), nullable=False),
        sa.Column("qty", sa.Integer(), nullable=False),
        sa.Column("box_count", sa.Integer(), nullable=True),
        sa.Column("inspection", sa.String(length=5), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("worker_id", sa.BigInteger(), nullable=False),
        sa.Column("station_id", sa.String(length=20), nullable=True),
        sa.Column("vendor_barcode", sa.String(length=64), nullable=True),
        sa.Column("event_uuid", sa.Uuid(), nullable=True),
        sa.CheckConstraint(
            "inspection IN ('PASS', 'COND', 'FAIL')", name=op.f("ck_material_receipt_inspection")
        ),
        sa.CheckConstraint("qty > 0", name=op.f("ck_material_receipt_qty")),
        sa.ForeignKeyConstraint(
            ["item_id"],
            ["mes.item.id"],
            name=op.f("fk_material_receipt_item_id"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["lot_id"],
            ["mes.inbound_lot.id"],
            name=op.f("fk_material_receipt_lot_id"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["station_id"],
            ["mes.station.id"],
            name=op.f("fk_material_receipt_station_id"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["wo_id"],
            ["mes.work_order.id"],
            name=op.f("fk_material_receipt_wo_id"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["worker_id"],
            ["mes.app_user.id"],
            name=op.f("fk_material_receipt_worker_id"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_material_receipt")),
        schema="mes",
    )
    op.create_table(
        "pack_box",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("code", sa.String(length=20), nullable=False),
        sa.Column("wo_id", sa.BigInteger(), nullable=False),
        sa.Column("box_no", sa.SmallInteger(), nullable=False),
        sa.Column("qty", sa.Integer(), nullable=False),
        sa.Column("packed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("worker_id", sa.BigInteger(), nullable=False),
        sa.Column("station_id", sa.String(length=20), nullable=True),
        sa.Column("shipment_id", sa.BigInteger(), nullable=True),
        sa.Column("event_uuid", sa.Uuid(), nullable=True),
        sa.CheckConstraint("qty > 0", name=op.f("ck_pack_box_qty")),
        sa.ForeignKeyConstraint(
            ["shipment_id"],
            ["mes.shipment.id"],
            name=op.f("fk_pack_box_shipment_id"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["station_id"],
            ["mes.station.id"],
            name=op.f("fk_pack_box_station_id"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["wo_id"], ["mes.work_order.id"], name=op.f("fk_pack_box_wo_id"), ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["worker_id"],
            ["mes.app_user.id"],
            name=op.f("fk_pack_box_worker_id"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_pack_box")),
        sa.UniqueConstraint("code", name=op.f("uq_pack_box_code")),
        sa.UniqueConstraint("wo_id", "box_no", name=op.f("uq_pack_box_wo_id_box_no")),
        schema="mes",
    )
    op.create_index(op.f("ix_pack_box_wo_id"), "pack_box", ["wo_id"], unique=False, schema="mes")
    op.create_table(
        "vendor_barcode_map",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("vendor_barcode", sa.String(length=64), nullable=False),
        sa.Column("wo_id", sa.BigInteger(), nullable=False),
        sa.Column("item_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "mapped_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("mapped_by", sa.BigInteger(), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.ForeignKeyConstraint(
            ["item_id"],
            ["mes.item.id"],
            name=op.f("fk_vendor_barcode_map_item_id"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["mapped_by"],
            ["mes.app_user.id"],
            name=op.f("fk_vendor_barcode_map_mapped_by"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["wo_id"],
            ["mes.work_order.id"],
            name=op.f("fk_vendor_barcode_map_wo_id"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_vendor_barcode_map")),
        sa.UniqueConstraint(
            "vendor_barcode", "wo_id", name=op.f("uq_vendor_barcode_map_vendor_barcode_wo_id")
        ),
        schema="mes",
    )
    op.create_index(
        "ix_vendor_barcode_map_vendor_barcode",
        "vendor_barcode_map",
        ["vendor_barcode"],
        unique=False,
        schema="mes",
    )
    op.create_table(
        "shipment_box",
        sa.Column("shipment_id", sa.BigInteger(), nullable=False),
        sa.Column("box_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(
            ["box_id"],
            ["mes.pack_box.id"],
            name=op.f("fk_shipment_box_box_id"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["shipment_id"],
            ["mes.shipment.id"],
            name=op.f("fk_shipment_box_shipment_id"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("shipment_id", "box_id", name=op.f("pk_shipment_box")),
        sa.UniqueConstraint("box_id", name=op.f("uq_shipment_box_box_id")),
        schema="mes",
    )
    op.execute(f"ALTER SEQUENCE {SCHEMA}.scan_event_id_seq OWNED BY {SCHEMA}.scan_event.id")
    cp = _load_create_partitions()
    for name, sql in cp.statements_from_now(INITIAL_MONTHS_AHEAD):
        op.execute(sql)
        print(f"[0003] partition {SCHEMA}.{name}")


def downgrade() -> None:
    op.drop_table("shipment_box", schema="mes")
    op.drop_table("vendor_barcode_map", schema="mes")
    op.drop_table("pack_box", schema="mes")
    op.drop_table("material_receipt", schema="mes")
    op.drop_table("shipment", schema="mes")
    op.drop_table("scan_event", schema="mes")
    op.drop_table("stock_txn", schema="mes")
    op.drop_table("stock", schema="mes")
    op.drop_table("inbound_lot", schema="mes")
    op.drop_table("scan_event_key", schema="mes")
    op.execute(f"DROP SEQUENCE IF EXISTS {SCHEMA}.scan_event_id_seq")

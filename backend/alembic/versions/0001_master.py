"""0001_master — 기준정보 + 시드 (process · print_method · admin)

Revision ID: 0001_master
Revises: None
Create Date: 2026-09-28

contracts/db-schema.md §11 리비전 순서. 테이블·컬럼·제약은 db-schema 그대로 (SQLAlchemy 모델 app/db/models 와 1:1).
첫 리비전: ``CREATE SCHEMA IF NOT EXISTS mes`` 를 먼저 실행한다 (progress.md 재현 사실).
시드는 app/db/seed_data.py 상수를 쓴다 (app.db.seed 와 공유, 멱등 ON CONFLICT DO NOTHING).
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import insert as pg_insert

from alembic import op
from app.core.config import get_settings
from app.core.hashing import hash_secret
from app.db.seed_data import (
    ADMIN_LOGIN_ID,
    ADMIN_ROLE,
    PRINT_METHOD_ROWS,
    PROCESS_ROWS,
    as_dicts,
)

revision: str = "0001_master"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "mes"


def _seed() -> None:
    process = sa.table(
        "process",
        sa.column("code", sa.String),
        sa.column("name", sa.String),
        sa.column("seq", sa.SmallInteger),
        sa.column("requires_equipment", sa.Boolean),
        sa.column("required_inputs", postgresql.JSONB),
        schema=SCHEMA,
    )
    print_method = sa.table(
        "print_method",
        sa.column("code", sa.String),
        sa.column("name", sa.String),
        sa.column("equip_types", postgresql.JSONB),
        sa.column("skips_p30", sa.Boolean),
        schema=SCHEMA,
    )
    app_user = sa.table(
        "app_user",
        sa.column("login_id", sa.String),
        sa.column("name", sa.String),
        sa.column("role", sa.String),
        sa.column("password_hash", sa.String),
        schema=SCHEMA,
    )
    op.execute(
        pg_insert(process)
        .values(as_dicts(PROCESS_ROWS))
        .on_conflict_do_nothing(index_elements=["code"])
    )
    op.execute(
        pg_insert(print_method)
        .values(as_dicts(PRINT_METHOD_ROWS))
        .on_conflict_do_nothing(index_elements=["code"])
    )
    # admin (db-schema §10): 비밀번호는 SEED_ADMIN_PASSWORD. 없으면 password_hash NULL (로그인 불가) 로 두고 알린다.
    password = get_settings().seed_admin_password
    if not password:
        print(
            "[0001_master] SEED_ADMIN_PASSWORD 미설정 — admin 은 password_hash NULL (로그인 불가) 로 생성. "
            "python -m app.db.seed 로 나중에 설정한다."
        )
    op.execute(
        pg_insert(app_user)
        .values(
            login_id=ADMIN_LOGIN_ID,
            name=ADMIN_LOGIN_ID,
            role=ADMIN_ROLE,
            password_hash=hash_secret(password) if password else None,
        )
        .on_conflict_do_nothing(index_elements=["login_id"])
    )


def upgrade() -> None:
    op.execute(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}")
    op.create_table(
        "app_user",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("login_id", sa.String(length=30), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("role", sa.String(length=10), nullable=False),
        sa.Column("card_code", sa.String(length=10), nullable=True),
        sa.Column("pin_hash", sa.String(length=128), nullable=True),
        sa.Column("password_hash", sa.String(length=128), nullable=True),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
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
            "role IN ('ADMIN', 'MANAGER', 'SALES', 'WORKER', 'VIEWER')",
            name=op.f("ck_app_user_role"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_app_user")),
        sa.UniqueConstraint("card_code", name=op.f("uq_app_user_card_code")),
        sa.UniqueConstraint("login_id", name=op.f("uq_app_user_login_id")),
        schema="mes",
    )
    op.create_table(
        "code_sequence",
        sa.Column("prefix", sa.String(length=4), nullable=False),
        sa.Column("seq_date", sa.Date(), nullable=False),
        sa.Column("last_no", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.PrimaryKeyConstraint("prefix", "seq_date", name=op.f("pk_code_sequence")),
        schema="mes",
    )
    op.create_table(
        "customer",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("code", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("contact_name", sa.String(length=50), nullable=True),
        sa.Column("phone", sa.String(length=30), nullable=True),
        sa.Column("email", sa.String(length=100), nullable=True),
        sa.Column("default_carrier", sa.String(length=20), nullable=True),
        sa.Column("legacy_id", sa.String(length=50), nullable=True),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
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
        sa.PrimaryKeyConstraint("id", name=op.f("pk_customer")),
        sa.UniqueConstraint("code", name=op.f("uq_customer_code")),
        schema="mes",
    )
    op.create_table(
        "item",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("code", sa.String(length=30), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("item_group", sa.String(length=30), nullable=False),
        sa.Column("spec", sa.String(length=50), nullable=True),
        sa.Column("color", sa.String(length=30), nullable=True),
        sa.Column("weight_g", sa.Integer(), nullable=True),
        sa.Column("vendor_item_code", sa.String(length=50), nullable=True),
        sa.Column("vendor_barcode", sa.String(length=64), nullable=True),
        sa.Column(
            "qty_tolerance_pct",
            sa.Numeric(precision=4, scale=1),
            server_default=sa.text("3.0"),
            nullable=False,
        ),
        sa.Column("legacy_id", sa.String(length=50), nullable=True),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
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
            "qty_tolerance_pct >= 0 AND qty_tolerance_pct <= 50",
            name=op.f("ck_item_qty_tolerance_pct"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_item")),
        sa.UniqueConstraint("code", name=op.f("uq_item_code")),
        schema="mes",
    )
    op.create_index(op.f("ix_item_item_group"), "item", ["item_group"], unique=False, schema="mes")
    op.create_index(
        op.f("ix_item_vendor_barcode"), "item", ["vendor_barcode"], unique=False, schema="mes"
    )
    op.create_table(
        "print_method",
        sa.Column("code", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=30), nullable=False),
        sa.Column(
            "equip_types",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("skips_p30", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.PrimaryKeyConstraint("code", name=op.f("pk_print_method")),
        schema="mes",
    )
    op.create_table(
        "printer",
        sa.Column("id", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("host", sa.String(length=100), nullable=False),
        sa.Column("port", sa.Integer(), server_default=sa.text("9100"), nullable=False),
        sa.Column("purpose", sa.String(length=20), nullable=False),
        sa.Column("location", sa.String(length=100), nullable=True),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.CheckConstraint("purpose IN ('PRODUCTION', 'PACKING')", name=op.f("ck_printer_purpose")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_printer")),
        schema="mes",
    )
    op.create_table(
        "process",
        sa.Column("code", sa.String(length=3), nullable=False),
        sa.Column("name", sa.String(length=30), nullable=False),
        sa.Column("seq", sa.SmallInteger(), nullable=False),
        sa.Column(
            "requires_equipment", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column(
            "required_inputs",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.PrimaryKeyConstraint("code", name=op.f("pk_process")),
        sa.UniqueConstraint("seq", name=op.f("uq_process_seq")),
        schema="mes",
    )
    op.create_table(
        "customer_address",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("customer_id", sa.BigInteger(), nullable=False),
        sa.Column("label", sa.String(length=50), nullable=False),
        sa.Column("receiver", sa.String(length=50), nullable=True),
        sa.Column("phone", sa.String(length=30), nullable=True),
        sa.Column("postal_code", sa.String(length=10), nullable=True),
        sa.Column("address1", sa.String(length=200), nullable=False),
        sa.Column("address2", sa.String(length=200), nullable=True),
        sa.Column("is_default", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.ForeignKeyConstraint(
            ["customer_id"],
            ["mes.customer.id"],
            name=op.f("fk_customer_address_customer_id"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_customer_address")),
        schema="mes",
    )
    op.create_index(
        "uq_customer_address_default",
        "customer_address",
        ["customer_id"],
        unique=True,
        schema="mes",
        postgresql_where=sa.text("is_default"),
    )
    op.create_table(
        "equipment",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("code", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column(
            "process_code", sa.String(length=3), server_default=sa.text("'P30'"), nullable=False
        ),
        sa.Column("equip_type", sa.String(length=10), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.CheckConstraint(
            "equip_type IN ('PRINT', 'TRANSFER', 'DTF', 'EMB')",
            name=op.f("ck_equipment_equip_type"),
        ),
        sa.ForeignKeyConstraint(
            ["process_code"],
            ["mes.process.code"],
            name=op.f("fk_equipment_process_code"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_equipment")),
        sa.UniqueConstraint("code", name=op.f("uq_equipment_code")),
        schema="mes",
    )
    op.create_table(
        "item_routing",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("item_group", sa.String(length=30), nullable=False),
        sa.Column("print_method", sa.String(length=20), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["print_method"],
            ["mes.print_method.code"],
            name=op.f("fk_item_routing_print_method"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_item_routing")),
        sa.UniqueConstraint(
            "item_group", "print_method", name=op.f("uq_item_routing_item_group_print_method")
        ),
        schema="mes",
    )
    op.create_table(
        "station",
        sa.Column("id", sa.String(length=20), nullable=False),
        sa.Column("type", sa.String(length=10), nullable=False),
        sa.Column("process_code", sa.String(length=3), nullable=True),
        sa.Column("location", sa.String(length=100), nullable=True),
        sa.Column("api_key_hash", sa.String(length=128), nullable=False),
        sa.Column("api_key_prefix", sa.String(length=8), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
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
            "type IN ('KIOSK', 'PDA', 'TOUCHPC', 'BOARD', 'ADMIN')", name=op.f("ck_station_type")
        ),
        sa.ForeignKeyConstraint(
            ["process_code"],
            ["mes.process.code"],
            name=op.f("fk_station_process_code"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_station")),
        schema="mes",
    )
    op.create_table(
        "routing_step",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("routing_id", sa.BigInteger(), nullable=False),
        sa.Column("seq", sa.SmallInteger(), nullable=False),
        sa.Column("process_code", sa.String(length=3), nullable=False),
        sa.Column("std_lead_hours", sa.Numeric(precision=6, scale=1), nullable=False),
        sa.Column("tolerance_pct", sa.Numeric(precision=4, scale=1), nullable=True),
        sa.ForeignKeyConstraint(
            ["process_code"],
            ["mes.process.code"],
            name=op.f("fk_routing_step_process_code"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["routing_id"],
            ["mes.item_routing.id"],
            name=op.f("fk_routing_step_routing_id"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_routing_step")),
        sa.UniqueConstraint(
            "routing_id", "process_code", name=op.f("uq_routing_step_routing_id_process_code")
        ),
        sa.UniqueConstraint("routing_id", "seq", name=op.f("uq_routing_step_routing_id_seq")),
        schema="mes",
    )
    _seed()


def downgrade() -> None:
    op.drop_table("routing_step", schema="mes")
    op.drop_table("station", schema="mes")
    op.drop_table("item_routing", schema="mes")
    op.drop_table("equipment", schema="mes")
    op.drop_table("customer_address", schema="mes")
    op.drop_table("process", schema="mes")
    op.drop_table("printer", schema="mes")
    op.drop_table("print_method", schema="mes")
    op.drop_table("item", schema="mes")
    op.drop_table("customer", schema="mes")
    op.drop_table("code_sequence", schema="mes")
    op.drop_table("app_user", schema="mes")
    # 스키마는 남긴다 (alembic_version 이 mes 에 있다. 완전 제거는 DROP SCHEMA mes CASCADE 를 손으로).

"""0005_s0_delta — S0 델타 (label_template · app_setting · item_group · carrier + 컬럼 추가)

Revision ID: 0005_s0_delta
Revises: 0004_ops_views
Create Date: 2026-09-28

contracts/db-schema.md §14 그대로. 0001~0004 는 손대지 않는다.
순서 (§14.4): ① 4 테이블 CREATE + 시드(label_template 4행, app_setting 3키)
             ② item.item_group · item_routing.item_group 의 distinct 값을 item_group 에 INSERT → FK 추가
             ③ ALTER 컬럼 추가 (§14.2)   downgrade 는 역순, FK 먼저 DROP.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import insert as pg_insert

from alembic import op
from app.db.seed_data import APP_SETTING_ROWS
from app.domain.label.templates import DEFAULT_TEMPLATES, load_default_template

revision: str = "0005_s0_delta"
down_revision: str | None = "0004_ops_views"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "mes"


def _seed() -> None:
    label_template = sa.table(
        "label_template",
        sa.column("label_type", sa.String),
        sa.column("format", sa.String),
        sa.column("body", sa.Text),
        schema=SCHEMA,
    )
    rows = []
    for label_type in DEFAULT_TEMPLATES:
        fmt, body = load_default_template(label_type)
        rows.append({"label_type": label_type, "format": fmt, "body": body})
    op.execute(
        pg_insert(label_template).values(rows).on_conflict_do_nothing(index_elements=["label_type"])
    )

    app_setting = sa.table(
        "app_setting",
        sa.column("key", sa.String),
        sa.column("value", postgresql.JSONB),
        schema=SCHEMA,
    )
    op.execute(
        pg_insert(app_setting)
        .values(APP_SETTING_ROWS)
        .on_conflict_do_nothing(index_elements=["key"])
    )

    # ② 기존 item.item_group · item_routing.item_group 값 → item_group (name = code). FK 추가 전에 실행.
    op.execute(
        f"""
        INSERT INTO {SCHEMA}.item_group (code, name)
        SELECT DISTINCT g, g FROM (
            SELECT item_group AS g FROM {SCHEMA}.item
            UNION SELECT item_group FROM {SCHEMA}.item_routing
        ) x
        ON CONFLICT (code) DO NOTHING
        """
    )


def upgrade() -> None:
    # ① 테이블 4개
    op.create_table(
        "label_template",
        sa.Column("label_type", sa.String(length=20), nullable=False),
        sa.Column("format", sa.String(length=5), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.CheckConstraint(
            "label_type IN ('WORK_ORDER_PDF', 'WO_LABEL', 'BOX_LABEL', 'WORKER_CARD')",
            name=op.f("ck_label_template_label_type"),
        ),
        sa.CheckConstraint("format IN ('ZPL', 'HTML')", name=op.f("ck_label_template_format")),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            [f"{SCHEMA}.app_user.id"],
            name=op.f("fk_label_template_updated_by"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("label_type", name=op.f("pk_label_template")),
        schema=SCHEMA,
    )
    op.create_table(
        "app_setting",
        sa.Column("key", sa.String(length=50), nullable=False),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            [f"{SCHEMA}.app_user.id"],
            name=op.f("fk_app_setting_updated_by"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_app_setting")),
        schema=SCHEMA,
    )
    op.create_table(
        "item_group",
        sa.Column("code", sa.String(length=30), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.PrimaryKeyConstraint("code", name=op.f("pk_item_group")),
        schema=SCHEMA,
    )
    op.create_table(
        "carrier",
        sa.Column("code", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=50), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.PrimaryKeyConstraint("code", name=op.f("pk_carrier")),
        schema=SCHEMA,
    )
    _seed()

    # ② FK (기존 값은 _seed 가 item_group 에 넣었다)
    op.create_foreign_key(
        op.f("fk_item_item_group"),
        "item",
        "item_group",
        ["item_group"],
        ["code"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        op.f("fk_item_routing_item_group"),
        "item_routing",
        "item_group",
        ["item_group"],
        ["code"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        ondelete="RESTRICT",
    )

    # ③ 컬럼 추가 (§14.2)
    op.add_column(
        "station", sa.Column("printer_id", sa.String(length=20), nullable=True), schema=SCHEMA
    )
    op.create_foreign_key(
        op.f("fk_station_printer_id"),
        "station",
        "printer",
        ["printer_id"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        ondelete="RESTRICT",
    )
    op.add_column(
        "app_user",
        sa.Column(
            "pin_failed_count", sa.SmallInteger(), server_default=sa.text("0"), nullable=False
        ),
        schema=SCHEMA,
    )
    op.add_column(
        "app_user",
        sa.Column("pin_locked_until", sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "app_user",
        sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "migration_batch",
        sa.Column(
            "errors",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        schema=SCHEMA,
    )
    op.add_column(
        "migration_batch",
        sa.Column(
            "duplicates",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        schema=SCHEMA,
    )
    op.add_column(
        "migration_batch",
        sa.Column("merge_policy", sa.String(length=10), nullable=True),
        schema=SCHEMA,
    )
    # db-schema §7.3 결함: status VARCHAR(10) 에 CHECK 값 'ROLLED_BACK'(11자) 이 들어가지 않는다 → 12
    op.alter_column(
        "migration_batch",
        "status",
        existing_type=sa.String(length=10),
        type_=sa.String(length=12),
        existing_nullable=False,
        schema=SCHEMA,
    )
    op.add_column(
        "sales_order",
        sa.Column("cancel_reason", sa.String(length=200), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "sales_order",
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "sales_order", sa.Column("cancelled_by", sa.BigInteger(), nullable=True), schema=SCHEMA
    )
    op.create_foreign_key(
        op.f("fk_sales_order_cancelled_by"),
        "sales_order",
        "app_user",
        ["cancelled_by"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        ondelete="RESTRICT",
    )
    op.add_column(
        "design", sa.Column("confirmed_by", sa.BigInteger(), nullable=True), schema=SCHEMA
    )
    op.create_foreign_key(
        op.f("fk_design_confirmed_by"),
        "design",
        "app_user",
        ["confirmed_by"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    # ③ 역순: FK 먼저
    op.drop_constraint(op.f("fk_design_confirmed_by"), "design", schema=SCHEMA, type_="foreignkey")
    op.drop_column("design", "confirmed_by", schema=SCHEMA)
    op.drop_constraint(
        op.f("fk_sales_order_cancelled_by"), "sales_order", schema=SCHEMA, type_="foreignkey"
    )
    op.drop_column("sales_order", "cancelled_by", schema=SCHEMA)
    op.drop_column("sales_order", "cancelled_at", schema=SCHEMA)
    op.drop_column("sales_order", "cancel_reason", schema=SCHEMA)
    # status VARCHAR(12) 확장은 되돌리지 않는다 — 'ROLLED_BACK' 행이 있으면 10 으로 좁힐 수 없고(데이터 손실),
    # 넓은 채로 두어도 0004 스키마에 해가 없다.
    op.drop_column("migration_batch", "merge_policy", schema=SCHEMA)
    op.drop_column("migration_batch", "duplicates", schema=SCHEMA)
    op.drop_column("migration_batch", "errors", schema=SCHEMA)
    op.drop_column("app_user", "password_changed_at", schema=SCHEMA)
    op.drop_column("app_user", "pin_locked_until", schema=SCHEMA)
    op.drop_column("app_user", "pin_failed_count", schema=SCHEMA)
    op.drop_constraint(op.f("fk_station_printer_id"), "station", schema=SCHEMA, type_="foreignkey")
    op.drop_column("station", "printer_id", schema=SCHEMA)
    # ② FK
    op.drop_constraint(
        op.f("fk_item_routing_item_group"), "item_routing", schema=SCHEMA, type_="foreignkey"
    )
    op.drop_constraint(op.f("fk_item_item_group"), "item", schema=SCHEMA, type_="foreignkey")
    # ① 테이블
    op.drop_table("carrier", schema=SCHEMA)
    op.drop_table("item_group", schema=SCHEMA)
    op.drop_table("app_setting", schema=SCHEMA)
    op.drop_table("label_template", schema=SCHEMA)

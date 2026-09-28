"""0007_s1_order — S1 QA 반영 (F33 · DEF-QA1-S1-005 · DEF-QA2-S1-004)

Revision ID: 0007_s1_order
Revises: 0006_s0_fix
Create Date: 2026-09-28

1. work_order.cancel_reason VARCHAR(200) · cancelled_at TIMESTAMPTZ · cancelled_by BIGINT FK app_user.id
   — 취소 사유를 hold_reason 과 분리 (sales_order 의 0005 컬럼과 같은 모양)
2. 기존 CANCELLED 행: hold_reason 을 cancel_reason 으로 복사 (S1 임시 저장처였음). hold_reason 은 유지
3. downgrade: 컬럼 삭제 (복사한 값은 hold_reason 에 그대로 남는다)
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0007_s1_order"
down_revision: str | None = "0006_s0_fix"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "mes"


def upgrade() -> None:
    op.add_column(
        "work_order", sa.Column("cancel_reason", sa.String(length=200), nullable=True), schema=SCHEMA
    )
    op.add_column(
        "work_order",
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "work_order", sa.Column("cancelled_by", sa.BigInteger(), nullable=True), schema=SCHEMA
    )
    op.create_foreign_key(
        op.f("fk_work_order_cancelled_by"),
        "work_order",
        "app_user",
        ["cancelled_by"],
        ["id"],
        source_schema=SCHEMA,
        referent_schema=SCHEMA,
        ondelete="RESTRICT",
    )
    op.execute(
        f"UPDATE {SCHEMA}.work_order SET cancel_reason = hold_reason "
        "WHERE status = 'CANCELLED' AND cancel_reason IS NULL"
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("fk_work_order_cancelled_by"), "work_order", schema=SCHEMA, type_="foreignkey"
    )
    op.drop_column("work_order", "cancelled_by", schema=SCHEMA)
    op.drop_column("work_order", "cancelled_at", schema=SCHEMA)
    op.drop_column("work_order", "cancel_reason", schema=SCHEMA)

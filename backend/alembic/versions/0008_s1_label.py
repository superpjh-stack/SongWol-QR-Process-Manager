"""0008_s1_label — label_issue 전송 결과 컬럼 (D48, DEF-QA1-S1-003 / DEF-QA2-S1-009)

Revision ID: 0008_s1_label
Revises: 0007_s1_order
Create Date: 2026-09-28

label_issue 에 ``zpl_sent BOOLEAN NOT NULL DEFAULT false`` · ``sent_at TIMESTAMPTZ NULL`` ·
``error VARCHAR(40) NULL`` 추가. ``printer_id`` FK 는 0002 부터 있다. 기존 행은 zpl_sent=false
(PDF 발행 훅 행과 같은 의미: 전송 안 함, error NULL).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008_s1_label"
down_revision: str | None = "0007_s1_order"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "mes"


def upgrade() -> None:
    op.add_column(
        "label_issue",
        sa.Column("zpl_sent", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        schema=SCHEMA,
    )
    op.add_column(
        "label_issue",
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA,
    )
    op.add_column(
        "label_issue", sa.Column("error", sa.String(length=40), nullable=True), schema=SCHEMA
    )


def downgrade() -> None:
    op.drop_column("label_issue", "error", schema=SCHEMA)
    op.drop_column("label_issue", "sent_at", schema=SCHEMA)
    op.drop_column("label_issue", "zpl_sent", schema=SCHEMA)

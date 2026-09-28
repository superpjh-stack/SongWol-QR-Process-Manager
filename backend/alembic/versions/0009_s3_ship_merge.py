"""0009_s3_ship_merge — S3 수정 웨이브: 발송 병합 재설계 (DEF-QA1-S3-001 = DEF-QA2-S3-004)

Revision ID: 0009_s3_ship_merge
Revises: 0008_s1_label
Create Date: 2026-09-28

``shipment_box.reconciled_at TIMESTAMPTZ NULL`` 추가 — 박스 단위로 "재고/WO/P60 반영이 이미
됐는지"를 추적한다(``apply_ship`` §6.4 재설계, 자세한 설명은 ``app/db/models/shipping.py``
``ShipmentBox`` 참고).

기존 행 백필: 이미 ``SHIPPED`` 로 확정된 shipment 에 붙은 shipment_box 행은 전부 그 시점에
이미 재고·WO·P60 에 반영이 끝난 상태이므로, ``reconciled_at = shipment.shipped_at`` 으로
채운다(NULL 로 두면 이후 그 shipment 에 새 박스가 합류하는 순간 과거 박스까지 다시 반영되어
이중 계상된다). ``READY`` 상태 shipment 의 박스는 정의상 아직 반영 전이라 NULL 로 둔다.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0009_s3_ship_merge"
down_revision: str | None = "0008_s1_label"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "mes"


def upgrade() -> None:
    op.add_column(
        "shipment_box",
        sa.Column("reconciled_at", sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA,
    )
    op.execute(
        f"UPDATE {SCHEMA}.shipment_box sb "
        f"SET reconciled_at = sh.shipped_at "
        f"FROM {SCHEMA}.shipment sh "
        f"WHERE sh.id = sb.shipment_id AND sh.status = 'SHIPPED' AND sh.shipped_at IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_column("shipment_box", "reconciled_at", schema=SCHEMA)

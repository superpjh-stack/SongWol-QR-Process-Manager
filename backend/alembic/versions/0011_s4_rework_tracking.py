"""0011_s4_rework_tracking — S4 QA fix: 재작업(E3) 누적 수량 추적 (DEF-QA1-S4-003)

Revision ID: 0011_s4_rework_tracking
Revises: 0010_s4_delay_risk
Create Date: 2026-09-29

DEF-QA1-S4-003 (중, `outputs/qa-func-S4.md` §3.6): ``POST /wo/{id}/rework`` 의 유일한 가드가
``body.qty > wo.qty_bad`` 인데 ``wo.qty_bad`` 는 P30 캐시 컬럼이라 재작업을 아무리 해도 줄지
않는다 — 같은 불량분(예: 20개)을 여러 번(15+5+20=40개) 재작업 하위 WO 로 중복 투입할 수
있었다(각 호출이 ``stock_txn(REWORK)`` 도 함께 만들어 재고까지 부풀림).

``wo_route_step.qty_reworked`` (누적 재작업 투입 수량, 기본 0)를 추가해 그 단계 기준으로
"이미 재작업으로 소비된 수량"을 추적한다. ``wo.qty_bad`` 는 항상 P30 단계의 캐시 값이므로
(``recalc.recalc_wo``), 실무적으로는 P30 단계에만 값이 쌓인다 — 그러나 컬럼 자체는 범용으로
``wo_route_step`` 에 둔다(특정 단계에 종속시키지 않음, 향후 다른 단계에서 불량이 잡히는
케이스로 확장돼도 스키마 변경이 필요 없다).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0011_s4_rework_tracking"
down_revision: str | None = "0010_s4_delay_risk"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "mes"


def upgrade() -> None:
    op.add_column(
        "wo_route_step",
        sa.Column("qty_reworked", sa.Integer(), server_default=sa.text("0"), nullable=False),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_column("wo_route_step", "qty_reworked", schema=SCHEMA)

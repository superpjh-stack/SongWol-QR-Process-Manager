"""0010_s4_delay_risk — S4: 지연 판정 캐시 컬럼 + 사용자 이메일 (RISK-S1-1 · U1, api-contract §15.6)

Revision ID: 0010_s4_delay_risk
Revises: 0009_s3_ship_merge
Create Date: 2026-09-29

RISK-S1-1: ``GET /so?delay=true``·``GET /wo?delay=true`` 는 S1 까지 파일럿 규모(활성 SO 수백)
한정 Python 필터였다. S4 지연 감지 잡(§6.5, APScheduler 10분)이 이 두 컬럼을 갱신하도록 하고
목록 필터를 SQL ``WHERE delay_risk`` 로 전환한다 — 컬럼은 이 리비전에서 추가.

상세 조회(SoView/WoView.delay_risk, ``domain/order/recalc.wo_delay_risk``)는 그대로 매 요청
실시간 계산을 유지한다(단건이라 비용이 작고, 최대 10분 지연될 수 있는 캐시보다 정확하다) —
이 컬럼은 오직 목록 필터링용 캐시다. 기본값 false, 잡이 최초 실행되기 전까지는 목록 필터가
빈 결과를 줄 수 있어 배포 직후 1회 즉시 실행도 앱 기동 시 스케줄러가 맡는다
(``app/domain/board/delay_job.py``).

**계약 보고(작은 추가, S4 개발 중 발견)**: progress.md U1 이 「알림 채널 = 이메일 어댑터로
임시」로 정했는데(§B5-03), db-schema 어디에도 ``app_user`` 에 이메일 컬럼이 없다(고객사
``customer.email`` 만 있음, 알림 수신자인 내부 사용자용이 아니다). 계약 델타 없이는 이메일
어댑터가 보낼 주소가 없어, 최소 컬럼 하나(``app_user.email``, nullable — 없는 사용자는 그
채널만 건너뛴다, 조용한 실패 아님)를 이 리비전에 추가한다. 관리자 웹 사용자 등록/수정 화면에
필드 하나 추가가 필요하다는 뜻이라 프론트 담당에게 보고.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0010_s4_delay_risk"
down_revision: str | None = "0009_s3_ship_merge"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "mes"


def upgrade() -> None:
    op.add_column(
        "sales_order",
        sa.Column("delay_risk", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        schema=SCHEMA,
    )
    op.add_column(
        "work_order",
        sa.Column("delay_risk", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_sales_order_delay_risk",
        "sales_order",
        ["delay_risk"],
        schema=SCHEMA,
        postgresql_where=sa.text("delay_risk"),
    )
    op.create_index(
        "ix_work_order_delay_risk",
        "work_order",
        ["delay_risk"],
        schema=SCHEMA,
        postgresql_where=sa.text("delay_risk"),
    )
    op.add_column(
        "app_user", sa.Column("email", sa.String(length=100), nullable=True), schema=SCHEMA
    )


def downgrade() -> None:
    op.drop_column("app_user", "email", schema=SCHEMA)
    op.drop_index("ix_work_order_delay_risk", table_name="work_order", schema=SCHEMA)
    op.drop_index("ix_sales_order_delay_risk", table_name="sales_order", schema=SCHEMA)
    op.drop_column("work_order", "delay_risk", schema=SCHEMA)
    op.drop_column("sales_order", "delay_risk", schema=SCHEMA)

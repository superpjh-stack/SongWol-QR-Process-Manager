"""0006_s0_fix — S0 QA 반영 (db-schema §15)

Revision ID: 0006_s0_fix
Revises: 0005_s0_delta
Create Date: 2026-09-28

1. app_user.login_failed_count / login_locked_until (D27 — 관리자 웹 로그인 5회/15분 잠금, PIN 카운터와 분리)
2. audit_log.row_key 추가 → row_id NOT NULL 해제 → 데이터 이관(row_id=0 행의 JSON `_pk` → row_key,
   JSON 'null' → SQL NULL, `_pk` 키 제거) → CHECK(row_id IS NOT NULL OR row_key IS NOT NULL) · 인덱스
3. migration_batch.row_count_skipped / row_count_failed / row_count_ignored (F30 대사식, ADM-31)
4. downgrade 역순 (JSON null 복원은 하지 않는다)
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006_s0_fix"
down_revision: str | None = "0005_s0_delta"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "mes"


def upgrade() -> None:
    # 1. app_user
    op.add_column(
        "app_user",
        sa.Column(
            "login_failed_count", sa.SmallInteger(), server_default=sa.text("0"), nullable=False
        ),
        schema=SCHEMA,
    )
    op.add_column(
        "app_user",
        sa.Column("login_locked_until", sa.DateTime(timezone=True), nullable=True),
        schema=SCHEMA,
    )
    # 2. audit_log
    op.add_column(
        "audit_log", sa.Column("row_key", sa.String(length=64), nullable=True), schema=SCHEMA
    )
    op.alter_column(
        "audit_log", "row_id", existing_type=sa.BigInteger(), nullable=True, schema=SCHEMA
    )
    op.execute(f"UPDATE {SCHEMA}.audit_log SET before = NULL WHERE before = 'null'::jsonb")
    op.execute(f"UPDATE {SCHEMA}.audit_log SET after = NULL WHERE after = 'null'::jsonb")
    op.execute(
        f"""
        UPDATE {SCHEMA}.audit_log
           SET row_key = COALESCE(after->>'_pk', before->>'_pk'),
               row_id = NULL,
               after = after - '_pk',
               before = before - '_pk'
         WHERE row_id = 0 AND COALESCE(after->>'_pk', before->>'_pk') IS NOT NULL
        """
    )
    # 이름을 op.f() 로 고정한다 — env 의 명명 규칙이 create/drop 양쪽에서 이름을 다시 감싸기 때문
    op.create_check_constraint(
        op.f("ck_audit_log_row_ref"),
        "audit_log",
        "row_id IS NOT NULL OR row_key IS NOT NULL",
        schema=SCHEMA,
    )
    op.create_index(
        "ix_audit_log_table_row_key", "audit_log", ["table_name", "row_key"], schema=SCHEMA
    )
    # 3. migration_batch 카운트
    for col in ("row_count_skipped", "row_count_failed", "row_count_ignored"):
        op.add_column(
            "migration_batch",
            sa.Column(col, sa.SmallInteger(), server_default=sa.text("0"), nullable=False),
            schema=SCHEMA,
        )


def downgrade() -> None:
    for col in ("row_count_ignored", "row_count_failed", "row_count_skipped"):
        op.drop_column("migration_batch", col, schema=SCHEMA)
    op.drop_index("ix_audit_log_table_row_key", table_name="audit_log", schema=SCHEMA)
    op.drop_constraint(op.f("ck_audit_log_row_ref"), "audit_log", schema=SCHEMA, type_="check")
    op.execute(
        f"""
        UPDATE {SCHEMA}.audit_log
           SET row_id = 0,
               after = CASE WHEN after IS NOT NULL THEN jsonb_build_object('_pk', row_key) || after END,
               before = CASE WHEN before IS NOT NULL THEN jsonb_build_object('_pk', row_key) || before END
         WHERE row_key IS NOT NULL
        """
    )
    op.execute(f"UPDATE {SCHEMA}.audit_log SET row_id = 0 WHERE row_id IS NULL")
    op.alter_column(
        "audit_log", "row_id", existing_type=sa.BigInteger(), nullable=False, schema=SCHEMA
    )
    op.drop_column("audit_log", "row_key", schema=SCHEMA)
    op.drop_column("app_user", "login_locked_until", schema=SCHEMA)
    op.drop_column("app_user", "login_failed_count", schema=SCHEMA)

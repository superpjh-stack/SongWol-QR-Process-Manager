"""0004_ops_views — 운영 테이블 · 집계 뷰 7종 · reader 롤

Revision ID: 0004_ops_views
Revises: 0003_events_material_shipping
Create Date: 2026-09-28

contracts/db-schema.md §11 리비전 순서. 테이블·컬럼·제약은 db-schema 그대로 (SQLAlchemy 모델 app/db/models 와 1:1).
뷰 SQL 은 db-schema §9 그대로 (search_path=mes 로 실행). reader 롤은 클러스터 공용이라 없을 때만 만들고
downgrade 에서는 권한만 회수한다.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0004_ops_views"
down_revision: str | None = "0003_events_material_shipping"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "mes"

VIEW_NAMES = [
    "v_so_progress",
    "v_process_queue",
    "v_daily_output",
    "v_lead_time",
    "v_stock_current",
    "v_shipment_today",
    "v_lot_trace",
]

VIEWS_SQL = """
-- 1. v_so_progress
CREATE VIEW v_so_progress AS
SELECT so.id AS so_id, so.code AS so_code, c.name AS customer_name, so.due_date, so.status, so.progress_pct,
       so.confirmed_at, so.shipped_at,
       (SELECT string_agg(DISTINCT p.name, ',') FROM work_order w JOIN wo_route_step s ON s.wo_id=w.id AND s.seq=w.current_step_seq
          JOIN process p ON p.code=s.process_code WHERE w.so_id=so.id AND w.status IN ('ISSUED','IN_PROGRESS')) AS current_processes,
       EXISTS (SELECT 1 FROM work_order w JOIN wo_route_step s ON s.wo_id=w.id AND s.status IN ('WAITING','STARTED')
               WHERE w.so_id=so.id AND w.status IN ('ISSUED','IN_PROGRESS')
               GROUP BY w.id HAVING SUM(s.std_lead_hours) > EXTRACT(EPOCH FROM (so.due_date::timestamptz + interval '18 hours' - now()))/3600) AS delay_risk,
       -- db-schema §9 초안은 MAX(… SUM(…)) 로 집계가 중첩되어 PG 가 거부한다 → WO 별 잔여 합을 서브쿼리로 먼저 구한다 (의미 동일. 계약 변경 필요로 보고)
       (SELECT MAX(now() + make_interval(hours => r.remain_hours::int)) FROM (
          SELECT SUM(s.std_lead_hours) AS remain_hours FROM work_order w JOIN wo_route_step s ON s.wo_id=w.id AND s.status IN ('WAITING','STARTED')
          WHERE w.so_id=so.id AND w.status IN ('ISSUED','IN_PROGRESS') GROUP BY w.id) r) AS est_complete_at
FROM sales_order so JOIN customer c ON c.id=so.customer_id;

-- 2. v_process_queue
CREATE VIEW v_process_queue AS
SELECT s.process_code, p.name AS process_name, COUNT(*) AS wo_count, SUM(COALESCE(s.qty_in, w.qty_ordered)) AS qty_total,
       MAX(EXTRACT(EPOCH FROM (now() - COALESCE(s.started_at, w.issued_at)))/3600) AS max_wait_hours
FROM wo_route_step s JOIN work_order w ON w.id=s.wo_id JOIN process p ON p.code=s.process_code
WHERE w.status IN ('ISSUED','IN_PROGRESS') AND s.status IN ('WAITING','STARTED') AND s.seq = w.current_step_seq
GROUP BY s.process_code, p.name;

-- 3. v_daily_output
CREATE VIEW v_daily_output AS
SELECT (s.done_at AT TIME ZONE 'Asia/Seoul')::date AS work_date, s.process_code, e.code AS equipment_code, e.equip_type,
       u.id AS worker_id, u.name AS worker_name, SUM(s.qty_good) AS qty_good, SUM(s.qty_bad) AS qty_bad, COUNT(*) AS wo_count
FROM wo_route_step s LEFT JOIN equipment e ON e.id=s.equipment_id LEFT JOIN app_user u ON u.id=s.worker_id
WHERE s.status IN ('DONE','DONE_ESTIMATED','PARTIAL') AND s.done_at IS NOT NULL
GROUP BY 1,2,3,4,5,6;

-- 4. v_lead_time
CREATE VIEW v_lead_time AS
SELECT so.id AS so_id, so.code AS so_code, so.confirmed_at, so.shipped_at,
       EXTRACT(EPOCH FROM (so.shipped_at - so.confirmed_at))/3600 AS lead_hours,
       w.code AS wo_code, s.process_code,
       EXTRACT(EPOCH FROM (s.done_at - COALESCE(s.started_at, w.issued_at)))/3600 AS step_hours
FROM sales_order so JOIN work_order w ON w.so_id=so.id JOIN wo_route_step s ON s.wo_id=w.id
WHERE so.shipped_at IS NOT NULL;

-- 5. v_stock_current
CREATE VIEW v_stock_current AS
SELECT i.id AS item_id, i.code AS item_code, i.name AS item_name, i.spec, i.color, st.qty_on_hand, st.updated_at,
       (SELECT MAX(created_at) FROM stock_txn t WHERE t.item_id=i.id AND t.txn_type='RECEIVE') AS last_receive_at,
       (SELECT MAX(created_at) FROM stock_txn t WHERE t.item_id=i.id AND t.txn_type='SHIP') AS last_ship_at
FROM item i LEFT JOIN stock st ON st.item_id=i.id WHERE i.active;

-- 6. v_shipment_today
CREATE VIEW v_shipment_today AS
SELECT so.code AS so_code, c.name AS customer_name, so.due_date, so.status AS so_status,
       sh.id AS shipment_id, sh.tracking_no, sh.status AS shipment_status, sh.shipped_at, sh.qty_total,
       CASE WHEN so.due_date < (now() AT TIME ZONE 'Asia/Seoul')::date AND so.status NOT IN ('SHIPPED','CLOSED','CANCELLED') THEN true ELSE false END AS overdue
FROM sales_order so JOIN customer c ON c.id=so.customer_id LEFT JOIN shipment sh ON sh.so_id=so.id
WHERE so.due_date = (now() AT TIME ZONE 'Asia/Seoul')::date
   OR (sh.shipped_at AT TIME ZONE 'Asia/Seoul')::date = (now() AT TIME ZONE 'Asia/Seoul')::date
   OR (so.due_date < (now() AT TIME ZONE 'Asia/Seoul')::date AND so.status NOT IN ('SHIPPED','CLOSED','CANCELLED'));

-- 7. v_lot_trace  (송장 → 박스 → WO → 설비/작업자 → 입고 LOT)
CREATE VIEW v_lot_trace AS
SELECT sh.tracking_no, pb.code AS box_code, pb.qty AS box_qty, w.code AS wo_code, w.print_method,
       s.process_code, e.code AS equipment_code, u.name AS worker_name, s.done_at,
       il.code AS inbound_lot_code, il.vendor, il.received_at AS lot_received_at
FROM pack_box pb
LEFT JOIN shipment_box sb ON sb.box_id=pb.id LEFT JOIN shipment sh ON sh.id=sb.shipment_id
JOIN work_order w ON w.id=pb.wo_id
LEFT JOIN wo_route_step s ON s.wo_id=w.id AND s.process_code='P30'
LEFT JOIN equipment e ON e.id=s.equipment_id LEFT JOIN app_user u ON u.id=s.worker_id
LEFT JOIN material_receipt mr ON mr.wo_id=w.id LEFT JOIN inbound_lot il ON il.id=mr.lot_id;

"""

READER_ROLE = "reader"


def _view_statements() -> list[str]:
    """asyncpg 는 prepared statement 에 여러 문장을 넣지 못한다 → 세미콜론 단위로 나눠 실행."""
    out: list[str] = []
    for chunk in VIEWS_SQL.split(";"):
        body = "\n".join(ln for ln in chunk.splitlines() if not ln.strip().startswith("--")).strip()
        if body:
            out.append(body)
    return out


def upgrade() -> None:
    op.create_table(
        "audit_log",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("table_name", sa.String(length=40), nullable=False),
        sa.Column("row_id", sa.BigInteger(), nullable=False),
        sa.Column("action", sa.String(length=10), nullable=False),
        sa.Column("before", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("after", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("user_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("request_id", sa.String(length=40), nullable=True),
        sa.CheckConstraint(
            "action IN ('INSERT', 'UPDATE', 'DELETE', 'APPROVE')", name=op.f("ck_audit_log_action")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["mes.app_user.id"], name=op.f("fk_audit_log_user_id"), ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_audit_log")),
        schema="mes",
    )
    op.create_index(
        "ix_audit_log_table_name_row_id",
        "audit_log",
        ["table_name", "row_id"],
        unique=False,
        schema="mes",
    )
    op.create_table(
        "migration_batch",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("source", sa.String(length=10), nullable=False),
        sa.Column("entity", sa.String(length=20), nullable=False),
        sa.Column("source_file", sa.String(length=300), nullable=False),
        sa.Column("source_hash", sa.String(length=64), nullable=False),
        sa.Column("extracted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("row_count_src", sa.Integer(), nullable=False),
        sa.Column("row_count_loaded", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("row_count_merged", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "status", sa.String(length=10), server_default=sa.text("'PREVIEW'"), nullable=False
        ),
        sa.Column("created_by", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "source IN ('IMS_XLS', 'COUNT')", name=op.f("ck_migration_batch_source")
        ),
        sa.CheckConstraint(
            "status IN ('PREVIEW', 'LOADED', 'FAILED', 'ROLLED_BACK')",
            name=op.f("ck_migration_batch_status"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["mes.app_user.id"],
            name=op.f("fk_migration_batch_created_by"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_migration_batch")),
        schema="mes",
    )
    op.create_table(
        "notification",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("type", sa.String(length=20), nullable=False),
        sa.Column("target_code", sa.String(length=30), nullable=False),
        sa.Column("message", sa.String(length=500), nullable=False),
        sa.Column("channel", sa.String(length=10), nullable=False),
        sa.Column("dedupe_key", sa.String(length=100), nullable=False),
        sa.Column("recipient_user_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ack_by", sa.BigInteger(), nullable=True),
        sa.Column("ack_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "channel IN ('KAKAO', 'SMS', 'PUSH', 'EMAIL', 'INAPP')",
            name=op.f("ck_notification_channel"),
        ),
        sa.CheckConstraint(
            "type IN ('DELAY', 'DEFECT', 'RECEIPT_SHORT', 'QTY_VARIANCE', 'APPROVAL_REQUEST', 'OFFLINE_BACKLOG')",
            name=op.f("ck_notification_type"),
        ),
        sa.ForeignKeyConstraint(
            ["ack_by"],
            ["mes.app_user.id"],
            name=op.f("fk_notification_ack_by"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["recipient_user_id"],
            ["mes.app_user.id"],
            name=op.f("fk_notification_recipient_user_id"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notification")),
        sa.UniqueConstraint("dedupe_key", name=op.f("uq_notification_dedupe_key")),
        schema="mes",
    )
    op.create_table(
        "migration_map",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("batch_id", sa.BigInteger(), nullable=False),
        sa.Column("entity", sa.String(length=20), nullable=False),
        sa.Column("legacy_id", sa.String(length=50), nullable=False),
        sa.Column("new_id", sa.BigInteger(), nullable=False),
        sa.Column("note", sa.String(length=200), nullable=True),
        sa.ForeignKeyConstraint(
            ["batch_id"],
            ["mes.migration_batch.id"],
            name=op.f("fk_migration_map_batch_id"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_migration_map")),
        sa.UniqueConstraint("entity", "legacy_id", name=op.f("uq_migration_map_entity_legacy_id")),
        schema="mes",
    )
    # 뷰 7종 (db-schema §9). 트랜잭션 안에서만 search_path 를 바꾼다.
    op.execute(f"SET LOCAL search_path TO {SCHEMA}, public")
    for stmt in _view_statements():
        op.execute(stmt)
    # 읽기 전용 롤 reader: 뷰 7종만 SELECT (plan §5.1)
    op.execute(
        f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{READER_ROLE}') "
        f"THEN CREATE ROLE {READER_ROLE} NOLOGIN; END IF; END $$"
    )
    op.execute(f"GRANT USAGE ON SCHEMA {SCHEMA} TO {READER_ROLE}")
    for v in VIEW_NAMES:
        op.execute(f"GRANT SELECT ON {SCHEMA}.{v} TO {READER_ROLE}")


def downgrade() -> None:
    for v in reversed(VIEW_NAMES):
        op.execute(f"DROP VIEW IF EXISTS {SCHEMA}.{v}")
    op.execute(f"REVOKE USAGE ON SCHEMA {SCHEMA} FROM {READER_ROLE}")
    op.drop_table("migration_map", schema="mes")
    op.drop_table("notification", schema="mes")
    op.drop_table("migration_batch", schema="mes")
    op.drop_table("audit_log", schema="mes")

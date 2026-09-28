"""현황판 · 집계 · 알림 · 운영 (ts-types §9 · §10 `board.ts`, api-contract §7.8 · §8).

S0/S1 이 이미 ``MigrationBatch`` 등을 ``schemas/master.py`` 에 둔 것과 같은 사정(임포트 API가
먼저 필요로 했다)을 board.ts 자신도 겪는다 — 이 모듈은 board.ts 의 나머지(현황판·리포트·알림)만
담는다.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import ConfigDict, Field

from app.api.v1.schemas.common import ApiModel, KstDateTime
from app.api.v1.schemas.master import UserSummary
from app.api.v1.schemas.order import SoStatus, WorkOrderSummary
from app.api.v1.schemas.scan import PendingScan

NotificationType = Literal[
    "DELAY", "DEFECT", "RECEIPT_SHORT", "QTY_VARIANCE", "APPROVAL_REQUEST", "OFFLINE_BACKLOG"
]
NotificationChannel = Literal["KAKAO", "SMS", "PUSH", "EMAIL", "INAPP"]


class SoProgress(ApiModel):
    so_id: int
    so_code: str
    customer_name: str
    due_date: str
    status: SoStatus
    progress_pct: float
    current_processes: list[str]
    delay_risk: bool
    est_complete_at: KstDateTime | None


class ProcessQueueRow(ApiModel):
    process_code: str
    process_name: str
    wo_count: int
    qty_total: int
    max_wait_hours: float


class TodayShipments(ApiModel):
    planned: int
    done: int
    overdue: int


class OfflineBacklogRow(ApiModel):
    station_id: str
    count: int


class DashboardSummary(ApiModel):
    today_due: list[SoProgress]
    delay_risk: list[SoProgress]
    process_queue: list[ProcessQueueRow]
    today_shipments: TodayShipments
    output_per_hour_today: float
    pending_approvals: int
    offline_backlog: list[OfflineBacklogRow]
    generated_at: KstDateTime


class OutputReportRow(ApiModel):
    period: str
    process_code: str
    equipment_code: str | None
    equip_type: str | None
    worker_name: str | None
    qty_good: int
    qty_bad: int
    wo_count: int
    output_per_hour: float | None


class OutputReportTotals(ApiModel):
    qty_good: int
    qty_bad: int
    output_per_hour: float | None


class OutputReport(ApiModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    from_: str = Field(alias="from")
    to: str
    group: Literal["day", "week", "month"]
    rows: list[OutputReportRow]
    totals: OutputReportTotals


class AuditLog(ApiModel):
    """ts-types §9. ``row_id``/``row_key`` 는 F24 대로 둘 중 하나만 채워진다."""

    id: int
    table_name: str
    row_id: int | None
    row_key: str | None
    action: Literal["INSERT", "UPDATE", "DELETE", "APPROVE"]
    before: dict[str, Any] | None
    after: dict[str, Any] | None
    user: UserSummary | None
    at: KstDateTime
    request_id: str | None


class Notification(ApiModel):
    id: int
    type: NotificationType
    target_code: str
    message: str
    channel: NotificationChannel
    created_at: KstDateTime
    sent_at: KstDateTime | None
    ack_by: UserSummary | None
    ack_at: KstDateTime | None


# ======================================================================
# WebSocket /ws/board (ts-types §10)
# ======================================================================
class ProcessQueueDelta(ApiModel):
    process_code: str
    wo_count: int


class SnapshotMessage(ApiModel):
    type: Literal["snapshot"] = "snapshot"
    at: KstDateTime
    summary: DashboardSummary


class WoUpdatedMessage(ApiModel):
    type: Literal["wo_updated"] = "wo_updated"
    at: KstDateTime
    wo: WorkOrderSummary
    so: SoProgress
    process_queue_delta: list[ProcessQueueDelta]


class NotificationMessage(ApiModel):
    type: Literal["notification"] = "notification"
    at: KstDateTime
    notification: Notification


class ApprovalPendingMessage(ApiModel):
    type: Literal["approval_pending"] = "approval_pending"
    at: KstDateTime
    pending: PendingScan


class PingMessage(ApiModel):
    type: Literal["ping"] = "ping"
    at: KstDateTime


BoardMessage = Annotated[
    SnapshotMessage
    | WoUpdatedMessage
    | NotificationMessage
    | ApprovalPendingMessage
    | PingMessage,
    Field(discriminator="type"),
]

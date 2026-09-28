"""스캔 (ts-types §6). S0 는 로그인 관련 4종, S1 은 ScanEventSummary(WO 상세·이벤트 목록).
S2: ScanRequest/ScanResponse/배치/승인/대기 (스캔 엔진, api-contract §5).

``QueueItem``·``QueueResponse`` 는 ts-types §6 이름이지만 ``WorkOrderSummary`` 를 참조하므로
순환 임포트를 피해 ``app.api.v1.schemas.order`` 에 둔다 (order.py 가 이미 이 모듈을 임포트
한다 — ``label_job.py`` 와 같은 이유의 배치).
"""

import uuid
from datetime import date
from typing import Any, Literal

from pydantic import Field

from app.api.v1.schemas.common import ApiModel, CodeStr, IdRef, KstDateTime, LoginIdStr
from app.api.v1.schemas.label_job import LabelJob
from app.api.v1.schemas.master import UserSummary
from app.api.v1.schemas.material import Receipt
from app.api.v1.schemas.shipping import PackBoxSummary, ShipmentDetail

LoginVia = Literal["CARD", "PIN", "OFFLINE_CACHE"]
TargetType = Literal["SO", "WO", "LT", "US", "VB"]
ScanAction = Literal[
    "START", "DONE", "RECEIVE", "PACK", "SHIP", "LOGIN", "CANCEL", "REPRINT", "APPROVE", "MAP"
]
ScanResult = Literal["OK", "WARN", "REJECT"]
ApprovalStatus = Literal["PENDING", "APPROVED", "DENIED"]
InputVia = Literal["HID", "CAMERA", "MANUAL", "URL"]  # api-contract §16.1 (B2-09)
DefectType = Literal["COLOR", "POSITION", "STAIN", "EMB_LOOSE", "OTHER"]
VarianceReasonCode = Literal["SHORT_INPUT", "MISCOUNT", "DEFECT_EXTRA", "SPLIT_MOVED", "OTHER"]
StepStatus = Literal["WAITING", "STARTED", "DONE", "DONE_ESTIMATED", "PARTIAL", "SKIPPED"]
ReceiptStatus = Literal["NONE", "PARTIAL", "FULL", "OVER"]
Inspection = Literal["PASS", "COND", "FAIL"]


class ScanEventSummary(ApiModel):
    """scan_event 1행 (ADM-16 이벤트 로그 · ``GET /wo/{id}/events``)."""

    event_uuid: uuid.UUID
    scanned_at: KstDateTime
    received_at: KstDateTime
    station_id: str
    process_code: str | None
    worker: UserSummary | None
    target_type: TargetType
    target_code: str
    action: ScanAction
    qty_good: int | None
    qty_bad: int | None
    qty_box: int | None
    equipment: IdRef | None
    result: ScanResult
    result_msg: str | None
    approval_status: ApprovalStatus | None
    compensates_uuid: uuid.UUID | None
    payload: dict[str, Any]


class LoginRequest(ApiModel):
    login_id: LoginIdStr = Field(min_length=1, max_length=30)
    password: str = Field(min_length=1)


class LoginResponse(ApiModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: UserSummary


class WorkerLoginRequest(ApiModel):
    card_code: CodeStr | None = None
    login_id: LoginIdStr | None = None
    pin: str | None = None


class WorkerLoginResponse(ApiModel):
    worker: UserSummary
    login_via: LoginVia


# ======================================================================
# S2: 스캔 엔진 (api-contract §5)
# ======================================================================
class ScanExtra(ApiModel):
    """§5.4 ``extra`` 키 목록 (scan_event.payload 로 저장)."""

    defect_type: DefectType | None = None
    variance_reason: str | None = Field(default=None, max_length=200)
    inspection: Inspection | None = None
    vendor: str | None = None
    tracking_no: str | None = Field(default=None, max_length=40)
    carrier: str | None = None
    box_codes: list[str] | None = None
    wo_code: str | None = None
    cancel_event_uuid: uuid.UUID | None = None
    label_type: str | None = None
    printer_id: str | None = None
    variance_reason_code: VarianceReasonCode | None = None  # §13.5 ⑨
    offline_seq: int | None = None  # §13.7 ⑬ PACK


class ScanRequest(ApiModel):
    """spec §8.1 그대로 + 추가 3필드 (ts-types §6). ``check`` 생략 규칙은 §16.2 (엔진이 처리)."""

    event_uuid: uuid.UUID
    scanned_at: KstDateTime
    station_id: CodeStr = Field(min_length=1, max_length=20)
    worker_card: CodeStr = Field(min_length=1, max_length=10)
    code: str = Field(min_length=1, max_length=200)
    check: str | None = Field(default=None, min_length=4, max_length=4)
    action: ScanAction
    qty_good: int | None = Field(default=None, ge=0)
    qty_bad: int | None = Field(default=None, ge=0)
    qty_box: int | None = Field(default=None, ge=0)
    equipment_code: CodeStr | None = Field(default=None, max_length=20)
    extra: ScanExtra | None = None
    client_seq: int | None = None
    input_via: InputVia = "HID"


class ScanWoSummary(ApiModel):
    """§13.5 ⑯: receipt_status · qty_tolerance_pct · qty_good/packed/shipped 추가."""

    code: str
    so_code: str
    customer_name: str
    item_name: str
    spec: str | None
    color: str | None
    print_method: str
    qty_ordered: int
    qty_received: int
    qty_good: int
    qty_packed: int
    qty_shipped: int
    receipt_status: ReceiptStatus
    qty_tolerance_pct: float
    status: str
    current_step_seq: int | None
    design_thumbnail_url: str | None
    due_date: date


class ScanStep(ApiModel):
    """§13.5 ⑯ tolerance_pct · ㉕[S6] remaining_equip_types (파일럿은 항상 [])."""

    process_code: str
    status: StepStatus
    qty_in: int | None
    qty_good: int | None
    qty_bad: int | None
    tolerance_pct: float
    remaining_equip_types: list[str] = Field(default_factory=list)


class ScanResponse(ApiModel):
    """spec §8.1 의 7필드 + 추가 (ts-types §6). ``code`` 는 REJECT 의 기계 코드(§13.9)."""

    result: ScanResult
    message: str
    wo: ScanWoSummary | None
    next_process: str | None
    remaining_qty: int | None
    requires_approval: bool
    approval_token: str | None
    warnings: list[str] = Field(default_factory=list)
    step: ScanStep | None
    event_uuid: uuid.UUID | None
    duplicate: bool = False
    code: str | None = None
    label_job: LabelJob | None = None
    worker: UserSummary | None = None
    box: PackBoxSummary | None = None
    receipt: Receipt | None = None  # RECEIVE 응답, lot 포함 (shopfloor ⑰)
    shipment: ShipmentDetail | None = None  # so_remaining_qty 포함 (shopfloor ㉑)


class ScanBatchRequest(ApiModel):
    """§5.3: 오프라인 큐 일괄. 최대 200건."""

    events: list[ScanRequest] = Field(max_length=200)


class ScanBatchResultItem(ApiModel):
    event_uuid: uuid.UUID | None
    response: ScanResponse


class ScanBatchResponse(ApiModel):
    results: list[ScanBatchResultItem]


class ApproveRequest(ApiModel):
    """§5.5. ``note`` → variance_reason 저장(㉔), ``note_code`` 는 프리셋."""

    approver_card: str | None = None
    pin: str | None = None
    decision: Literal["APPROVE", "DENY"]
    note: str | None = Field(default=None, max_length=200)
    note_code: VarianceReasonCode | None = None


class PendingScan(ApiModel):
    event_uuid: uuid.UUID
    scanned_at: KstDateTime
    station_id: str
    worker: UserSummary | None
    wo: ScanWoSummary | None
    action: ScanAction
    process_code: str | None
    message: str
    approval_token: str

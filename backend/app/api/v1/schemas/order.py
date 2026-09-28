"""수주·WO (ts-types §5 · api-contract §7.3 · §13.4). ``?`` 는 기본값 있는 선택, ``| null`` 은
필수이되 null 허용 (ts-types §11).

S0 는 LabelJob 만 썼다. S1 (개발A) 이 수주·도안·WO·QR 착지 타입을 채운다.
"""

from datetime import date
from typing import Any, Literal

from pydantic import Field, model_validator

from app.api.v1.schemas.common import ApiModel, CodeStr, IdRef, KstDateTime, read_only_fields
from app.api.v1.schemas.label_job import LabelJob as LabelJob
from app.api.v1.schemas.label_job import LabelType as LabelType
from app.api.v1.schemas.master import RoutingStepInput, UserSummary
from app.api.v1.schemas.material import ReceiptSummary, VendorBarcodeMap
from app.api.v1.schemas.scan import ScanEventSummary
from app.api.v1.schemas.shipping import PackBoxSummary, ShipmentSummary

SoStatus = Literal["OPEN", "IN_PROGRESS", "PARTIAL_SHIPPED", "SHIPPED", "CLOSED", "CANCELLED"]
WoStatus = Literal[
    "DRAFT", "ISSUED", "IN_PROGRESS", "PACKED", "SHIPPED", "CLOSED", "ON_HOLD", "CANCELLED"
]
StepStatus = Literal["WAITING", "STARTED", "DONE", "DONE_ESTIMATED", "PARTIAL", "SKIPPED"]
ReceiptStatus = Literal["NONE", "PARTIAL", "FULL", "OVER"]
# admin #31 [S1]
AllowedAction = Literal[
    "VIEW_DETAIL", "REPRINT", "HOLD", "SPLIT", "APPROVE_PENDING", "QUARANTINE", "SHIP"
]
QrTargetType = Literal["SO", "WO", "LT", "US"]


# ---- 수주 ----
class ShipTo(ApiModel):
    """customer_address 스냅샷 (db-schema §3.1 ship_to JSONB). 길이는 customer_address 준용."""

    receiver: str | None = Field(default=None, max_length=50)
    phone: str | None = Field(default=None, max_length=30)
    postal_code: str | None = Field(default=None, max_length=10)
    address1: str = Field(min_length=1, max_length=200)
    address2: str | None = Field(default=None, max_length=200)


class ItemRef(IdRef):
    """``IdRef & { spec, color }`` (ts-types §5)."""

    spec: str | None
    color: str | None


class Design(ApiModel):
    id: int
    so_line_id: int
    version: int
    file_url: str
    thumbnail_url: str | None
    confirmed_at: KstDateTime | None
    is_current: bool
    created_at: KstDateTime


class SalesOrderLine(ApiModel):
    id: int
    line_no: int
    item: ItemRef
    print_method: str
    qty: int
    unit_price: float | None
    design: Design | None
    design_confirmed: bool


class SalesOrderLineInput(ApiModel):
    id: int | None = None  # PATCH 에서 기존 라인 지정. 없으면 신규 라인
    item_id: int
    print_method: CodeStr = Field(min_length=1, max_length=20)
    qty: int = Field(gt=0)
    unit_price: float | None = Field(default=None, ge=0)


class SalesOrderSummary(ApiModel):
    id: int
    code: str
    customer: IdRef
    order_date: date
    due_date: date
    status: SoStatus
    progress_pct: float
    delay_risk: bool
    line_count: int
    wo_count: int
    confirmed_at: KstDateTime | None
    shipped_at: KstDateTime | None


class SalesOrder(SalesOrderSummary):
    ship_to: ShipTo
    memo: str | None
    lines: list[SalesOrderLine]
    created_by: UserSummary
    created_at: KstDateTime
    updated_at: KstDateTime


class SalesOrderCreate(ApiModel):
    customer_id: int
    order_date: date
    due_date: date
    ship_to: ShipTo | None = None
    address_id: int | None = None
    memo: str | None = None
    lines: list[SalesOrderLineInput] = Field(min_length=1)

    @model_validator(mode="after")
    def _ship_to_or_address(self) -> "SalesOrderCreate":
        # ADM-13: 배송지는 등록 배송지(address_id) 또는 직접 입력(ship_to) 둘 중 하나
        if self.ship_to is None and self.address_id is None:
            raise ValueError("ship_to 또는 address_id 중 하나는 필요합니다")
        return self


class SalesOrderUpdate(ApiModel):
    _read_only = read_only_fields(
        "id",
        "code",
        "customer_id",
        "order_date",
        "status",
        "progress_pct",
        "confirmed_at",
        "shipped_at",
        "created_by",
        "created_at",
        "updated_at",
        "cancel_reason",
        "cancelled_at",
        "cancelled_by",
        "line_count",
        "wo_count",
        "delay_risk",
    )
    due_date: date | None = None
    ship_to: ShipTo | None = None
    memo: str | None = None
    lines: list[SalesOrderLineInput] | None = Field(default=None, min_length=1)


class ReasonRequest(ApiModel):
    reason: str = Field(min_length=1, max_length=200)


# ---- WO 제안·발행 ----
class WoDraft(ApiModel):
    so_line_id: int
    item_id: int
    print_method: CodeStr = Field(min_length=1, max_length=20)
    qty: int = Field(gt=0)
    routing_id: int
    steps: list[RoutingStepInput]


class WoProposal(ApiModel):
    items: list[WoDraft]


class IssueWoRequest(ApiModel):
    drafts: list[WoDraft] = Field(min_length=1)


# ---- WO ----
class StepWork(ApiModel):
    id: int
    seq: int
    equipment: IdRef
    worker: UserSummary
    started_at: KstDateTime | None
    done_at: KstDateTime | None
    qty_good: int | None
    qty_bad: int | None


class RouteStep(ApiModel):
    id: int
    seq: int
    process_code: str
    process_name: str
    std_lead_hours: float
    tolerance_pct: float
    status: StepStatus
    started_at: KstDateTime | None
    done_at: KstDateTime | None
    qty_in: int | None
    qty_good: int | None
    qty_bad: int | None
    equipment: IdRef | None
    worker: UserSummary | None
    is_estimated: bool
    approved_by: UserSummary | None
    variance_reason: str | None
    works: list[StepWork]


class WorkOrderSummary(ApiModel):
    id: int
    code: str
    so_code: str
    customer_name: str
    item: ItemRef
    print_method: str
    qty_ordered: int
    qty_received: int
    qty_good: int
    qty_bad: int
    qty_packed: int
    qty_shipped: int
    receipt_status: ReceiptStatus
    status: WoStatus
    current_step_seq: int | None
    current_process_code: str | None
    due_date: date
    delay_risk: bool
    design_version: int | None
    design_thumbnail_url: str | None
    parent_wo_code: str | None
    split_suffix: str | None
    issued_at: KstDateTime | None


class WorkOrder(WorkOrderSummary):
    steps: list[RouteStep]
    hold_reason: str | None
    closed_at: KstDateTime | None


class WorkOrderDetail(WorkOrder):
    recent_events: list[ScanEventSummary]
    boxes: list[PackBoxSummary]
    receipts: list[ReceiptSummary]
    children: list[WorkOrderSummary]


class SalesOrderDetail(SalesOrder):
    work_orders: list[WorkOrderSummary]
    current_processes: list[str]
    est_complete_at: KstDateTime | None


class IssueWoResponse(ApiModel):
    work_orders: list[WorkOrder]
    pdf_url: str


# ---- 분할 (B4-04, api-contract §7.3 · §13.4 shopfloor ⑱ [S3]) ----
class SplitRequest(ApiModel):
    qty: int = Field(gt=0)
    reason: str = Field(min_length=1, max_length=200)
    # STATION 호출 전용 (§13.4 shopfloor ⑱ · §14.1 「승인 PIN」 — /auth/worker 와 같은 verify_pin)
    approver_card: str | None = None
    pin: str | None = None


class SplitResponse(ApiModel):
    parent: WorkOrder
    child: WorkOrder


# ---- 출하 박스 상세 (ts-types §8 PackBoxDetail — WorkOrderSummary 참조 때문에 여기 둔다,
# ---- shipping.py 는 order.py 를 임포트할 수 없다: order.py 가 이미 shipping.py 를 임포트한다) ----
class PackBoxDetail(PackBoxSummary):
    wo: WorkOrderSummary
    worker: UserSummary
    shipment: ShipmentSummary | None


# ---- 협력업체 바코드 조회 (ts-types §7 VendorBarcodeLookup — WorkOrderSummary 참조) ----
class VendorBarcodeLookup(ApiModel):
    mapping: VendorBarcodeMap | None
    wo: WorkOrderSummary | None


class SoCancelResponse(ApiModel):
    """admin #27 [S1]. pending_wo 는 착수된 WO (별도 ``/wo/{id}/cancel`` 필요)."""

    so: SalesOrder
    cancelled_wo: list[str]
    pending_wo: list[WorkOrderSummary]


# ---- 스캔 대기열 (ts-types §6 QueueItem/QueueResponse — WorkOrderSummary 참조 때문에 여기 둔다,
# ---- scan.py 는 order.py 를 임포트할 수 없다: order.py 가 이미 scan.py 를 임포트한다 §7.6) ----
class QueueItem(ApiModel):
    wo: WorkOrderSummary
    step_status: StepStatus
    qty_in: int
    waiting_hours: float
    due_date: date
    delay_risk: bool


class QueueResponse(ApiModel):
    process_code: str
    process_name: str
    items: list[QueueItem]
    pending_approvals: int


# ---- QR 착지 (api-contract §10 · §13.4 admin #30/#31) ----
class QrLanding(ApiModel):
    """summary 는 type 별 SalesOrderSummary | WorkOrderSummary | PackBoxSummary | InboundLot |
    UserSummary 의 직렬화 결과. 비로그인은 #30 제외 필드를 뺀다 (US 는 name·role·card_code 만).
    """

    type: QrTargetType
    code: str
    summary: dict[str, Any]
    allowed_actions: list[AllowedAction]

"""출하 (ts-types §8 · api-contract §7.5). S3 출하 웨이브가 채운다.

``event_uuid`` 는 STATION 필수, JWT/관리자 웹은 선택(§13.6).

``PackBoxDetail`` (``wo: WorkOrderSummary`` 참조)은 순환 임포트를 피해 ``order.py`` 에 둔다
(scan.py 의 ``QueueItem``/``QueueResponse`` 와 같은 이유 — order.py 가 이미 이 모듈을 가져온다).
"""

import uuid
from typing import Literal

from pydantic import Field

from app.api.v1.schemas.common import ApiModel, CodeStr, KstDateTime
from app.api.v1.schemas.label_job import LabelJob
from app.api.v1.schemas.master import UserSummary

ShipmentStatus = Literal["READY", "SHIPPED", "DELIVERED"]


class PackBoxSummary(ApiModel):
    kind: Literal["PACK"] = "PACK"
    id: int
    code: str
    wo_code: str
    box_no: int
    qty: int
    packed_at: KstDateTime
    shipment_id: int | None


class BoxCreate(ApiModel):
    """POST /boxes (스캔 PACK 과 같은 서비스, api-contract §7.5)."""

    event_uuid: uuid.UUID | None = None
    wo_code: CodeStr = Field(min_length=1, max_length=24)
    qty: int = Field(gt=0)
    printer_id: CodeStr | None = Field(default=None, max_length=20)
    worker_card: CodeStr | None = Field(default=None, max_length=10)


class PackBox(PackBoxSummary):
    label_job: LabelJob | None
    wo_qty_packed: int
    wo_status: str


class ShipmentCreate(ApiModel):
    """POST /shipments (스캔 SHIP 과 같은 서비스, api-contract §7.5).

    ``box_codes`` 는 박스 LT 코드 목록(REST 는 항상 명시 선택 — WO 와일드카드는 스캔 전용).
    """

    event_uuid: uuid.UUID | None = None
    so_code: CodeStr | None = Field(default=None, max_length=20)
    box_codes: list[str] = Field(min_length=1)
    tracking_no: str = Field(min_length=1, max_length=40)
    carrier: str | None = Field(default=None, max_length=20)
    worker_card: CodeStr | None = Field(default=None, max_length=10)
    confirm: bool = True


class ShipmentSummary(ApiModel):
    id: int
    so_code: str
    customer_name: str
    carrier: str | None
    tracking_no: str | None
    status: ShipmentStatus
    shipped_at: KstDateTime | None
    qty_total: int
    box_count: int


class ShipmentDetail(ShipmentSummary):
    boxes: list[PackBoxSummary]
    worker: UserSummary | None
    so_remaining_qty: int


Shipment = ShipmentDetail


class DailyShipmentRow(ApiModel):
    so_code: str
    customer_name: str
    item_name: str
    qty: int
    tracking_no: str | None
    shipped_at: KstDateTime | None
    overdue: bool


class DailyShipmentTotals(ApiModel):
    shipments: int
    boxes: int
    qty: int


class DailyShipmentReport(ApiModel):
    date: str
    rows: list[DailyShipmentRow]
    totals: DailyShipmentTotals

"""자재 (ts-types §7 · api-contract §7.4). S3 자재 웨이브가 채운다.

``event_uuid`` 는 STATION 필수, JWT/관리자 웹은 선택(§13.6).
"""

import uuid
from typing import Literal

from pydantic import Field, field_validator

from app.api.v1.schemas.common import ApiModel, CodeStr, IdRef, KstDateTime
from app.api.v1.schemas.master import UserSummary

Inspection = Literal["PASS", "COND", "FAIL"]
LotStatus = Literal["OK", "QUARANTINE"]
StockTxnType = Literal["MIGRATE", "RECEIVE", "SHIP", "ADJUST", "REWORK"]
StockSource = Literal["IMS_XLS", "NEW", "COUNT"]
ReceiptStatus = Literal["NONE", "PARTIAL", "FULL", "OVER"]


class InboundLot(ApiModel):
    kind: Literal["INBOUND"] = "INBOUND"
    id: int
    code: str
    item: IdRef
    vendor: str | None
    received_at: KstDateTime
    qty: int
    status: LotStatus
    quarantine_memo: str | None


class ReceiptCreate(ApiModel):
    """POST /receipts (스캔 RECEIVE 와 같은 서비스, api-contract §7.4).

    ``wo_code`` 없이 비수주 입고(A3-09)는 [확장] — S3 는 ``wo_code`` 를 요구한다.
    """

    event_uuid: uuid.UUID | None = None
    wo_code: CodeStr | None = Field(default=None, max_length=24)
    item_id: int | None = None
    qty: int = Field(gt=0)
    box_count: int | None = Field(default=None, ge=0)
    inspection: Inspection
    vendor: str | None = Field(default=None, max_length=100)
    vendor_barcode: str | None = Field(default=None, max_length=64)
    received_at: KstDateTime | None = None
    worker_card: CodeStr | None = Field(default=None, max_length=10)


class ReceiptSummary(ApiModel):
    id: int
    wo_code: str | None
    item: IdRef
    lot_code: str
    qty: int
    box_count: int | None
    inspection: Inspection
    received_at: KstDateTime
    worker: UserSummary


class Receipt(ReceiptSummary):
    lot: InboundLot
    wo_receipt_status: ReceiptStatus | None
    remaining_qty: int | None
    vendor_barcode: str | None


class VendorBarcodeMapCreate(ApiModel):
    """POST /vendor-barcodes/map (스캔 MAP 과 같은 서비스)."""

    vendor_barcode: str = Field(min_length=1, max_length=64)
    wo_code: CodeStr = Field(min_length=1, max_length=24)
    worker_card: CodeStr | None = Field(default=None, max_length=10)


class VendorBarcodeMap(ApiModel):
    id: int
    vendor_barcode: str
    wo_code: str
    item: IdRef
    mapped_at: KstDateTime
    mapped_by: UserSummary
    active: bool


class QuarantineRequest(ApiModel):
    memo: str = Field(min_length=1, max_length=300)


class StockRow(ApiModel):
    item_id: int
    item_code: str
    item_name: str
    spec: str | None
    color: str | None
    qty_on_hand: int
    updated_at: KstDateTime | None
    last_receive_at: KstDateTime | None
    last_ship_at: KstDateTime | None


class StockAdjust(ApiModel):
    item_id: int
    qty_delta: int
    reason: str = Field(min_length=1, max_length=200)
    source: StockSource | None = "NEW"

    @field_validator("qty_delta")
    @classmethod
    def _qty_delta_nonzero(cls, v: int) -> int:
        if v == 0:
            raise ValueError("qty_delta 는 0 일 수 없습니다")
        return v


class StockTxn(ApiModel):
    id: int
    item: IdRef
    txn_type: StockTxnType
    qty: int
    ref_type: str | None
    ref_id: int | None
    reason: str | None
    source: StockSource
    created_by: UserSummary | None
    created_at: KstDateTime


"""자재 (ts-types §7). S1 은 WorkOrderDetail.receipts 가 참조하는 요약형만 둔다 — S3 자재 웨이브가
Receipt·VendorBarcodeMap·StockRow 등을 채운다.
"""

from typing import Literal

from app.api.v1.schemas.common import ApiModel, IdRef, KstDateTime
from app.api.v1.schemas.master import UserSummary

Inspection = Literal["PASS", "COND", "FAIL"]
LotStatus = Literal["OK", "QUARANTINE"]


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

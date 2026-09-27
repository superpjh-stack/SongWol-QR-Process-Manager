"""출하 (ts-types §8). S1 은 WorkOrderDetail.boxes 가 참조하는 요약형만 둔다 — S3 출하 웨이브가
PackBoxDetail·Shipment* 를 채운다.
"""

from typing import Literal

from app.api.v1.schemas.common import ApiModel, KstDateTime


class PackBoxSummary(ApiModel):
    kind: Literal["PACK"] = "PACK"
    id: int
    code: str
    wo_code: str
    box_no: int
    qty: int
    packed_at: KstDateTime
    shipment_id: int | None

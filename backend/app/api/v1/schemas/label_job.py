"""``LabelJob`` (ts-types §5). 다른 스키마 모듈이 의존하지 않는 잎 모듈.

master(IssueCardResponse) · order · label 이 모두 쓰는데 order ↔ master 가 서로 import 하므로
순환을 끊기 위해 여기 둔다. ``app.api.v1.schemas.order`` 가 같은 이름으로 다시 내보낸다.
"""

from typing import Literal

from app.api.v1.schemas.common import ApiModel, KstDateTime

LabelType = Literal["WORK_ORDER_PDF", "WO_LABEL", "BOX_LABEL", "WORKER_CARD"]


class LabelJob(ApiModel):
    issue_no: int
    label_type: LabelType
    printer_id: str | None
    copies: int
    sent_at: KstDateTime | None
    pdf_url: str | None
    zpl_sent: bool
    error: str | None  # 'PRINTER_UNREACHABLE' | 'NO_PRINTER' (api-contract §13.7)

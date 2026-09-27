"""수주·WO (ts-types §5). S0 에서는 LabelJob 만 쓴다 (issue-card 응답). 나머지는 S1."""

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

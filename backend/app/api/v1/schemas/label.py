"""라벨 · 프린터 (ts-types §4 Printer/LabelTemplate · §5 LabelPrintRequest/LabelJob/LabelIssue)."""

from typing import Literal

from pydantic import AliasChoices, ConfigDict, Field

from app.api.v1.schemas.common import ApiModel, CodeStr, KstDateTime, read_only_fields
from app.api.v1.schemas.master import UserSummary
from app.api.v1.schemas.order import LabelJob, LabelType

PrinterPurpose = Literal["PRODUCTION", "PACKING"]
LabelFormat = Literal["ZPL", "HTML"]


# ---- 프린터 (ADM-09 탭 1) ----
class Printer(ApiModel):
    id: str
    name: str
    host: str
    port: int
    purpose: PrinterPurpose
    location: str | None
    active: bool


class PrinterCreate(ApiModel):
    id: CodeStr = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=50)
    host: str = Field(min_length=1, max_length=100)
    port: int = Field(default=9100, ge=1, le=65535)
    purpose: PrinterPurpose
    location: str | None = Field(default=None, max_length=100)


class PrinterUpdate(ApiModel):
    """독립 정의 (ts-types §13 CD-2). PATCH 는 보낸 필드만."""

    _read_only = read_only_fields("id", "active")

    name: str | None = Field(default=None, min_length=1, max_length=50)
    host: str | None = Field(default=None, min_length=1, max_length=100)
    port: int | None = Field(default=None, ge=1, le=65535)
    purpose: PrinterPurpose | None = None
    location: str | None = Field(default=None, max_length=100)


class PrinterTestResult(ApiModel):
    """``POST /printers/{id}/test``. 실패도 200 — ``zpl_sent=false, error=PRINTER_UNREACHABLE``
    (§13.7 원칙을 테스트 출력에도 적용. 계약 원문의 503 은 쓰지 않는다 — 보고 항목)."""

    printer_id: str
    host: str
    port: int
    zpl_sent: bool
    sent_at: KstDateTime | None
    error: str | None
    zpl: str  # 보낸 ZPL 원문 (미리보기·문제 추적용)


# ---- 라벨 양식 (ADM-09 탭 2) ----
class LabelTemplate(ApiModel):
    label_type: LabelType
    format: LabelFormat
    body: str
    version: int
    placeholders: list[str]
    updated_at: KstDateTime
    updated_by: UserSummary | None


class LabelTemplateUpdate(ApiModel):
    _read_only = read_only_fields("label_type", "format", "version", "updated_at", "updated_by")
    body: str = Field(min_length=1)


class LabelPreviewRequest(ApiModel):
    """``target`` 이 있으면 실제 데이터, 없으면 예시 값으로 렌더 (§11-7: 텍스트만)."""

    target: CodeStr | None = Field(default=None, max_length=30)
    printer_id: CodeStr | None = Field(default=None, max_length=20)


class LabelPreview(ApiModel):
    label_type: LabelType
    format: LabelFormat
    target: str | None
    body: str  # 렌더된 ZPL 또는 HTML 텍스트


# ---- 출력 ----
class LabelPrintRequest(ApiModel):
    """spec §8.6 글자 그대로 ``printer`` (= printer.id). ``printer_id`` 도 같은 뜻으로 받는다.

    프린터 선택 순서(§13.7 ②): 본문 printer → 단말 station.printer_id → 활성 PACKING 이 정확히
    1대 → 없으면 200 + ``zpl_sent=false, error=NO_PRINTER``.
    """

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    target: CodeStr = Field(min_length=1, max_length=30)
    label_type: Literal["WO_LABEL", "BOX_LABEL", "WORKER_CARD"]
    printer: CodeStr | None = Field(
        default=None, max_length=20, validation_alias=AliasChoices("printer", "printer_id")
    )
    copies: int = Field(default=1, ge=1, le=20)


class LabelIssue(LabelJob):
    id: int
    target_type: Literal["SO", "WO", "LT", "US"]
    target_code: str
    issued_at: KstDateTime
    issued_by: UserSummary | None
    station_id: str | None

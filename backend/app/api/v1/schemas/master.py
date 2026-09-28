"""기준정보 (ts-types §4). ``?`` 는 기본값 있는 선택, ``| null`` 은 필수이되 null 허용 (§11)."""

from typing import Any, Literal

from pydantic import Field

from app.api.v1.schemas.common import (
    ApiModel,
    CodeStr,
    KstDateTime,
    LoginIdStr,
    Page,
    read_only_fields,
)
from app.api.v1.schemas.label_job import LabelJob

PrintMethodCode = (
    str  # 시드 6종이 기본이나 기준정보 등록만으로 추가 가능 (db-schema §2.6 CHECK 없음)
)
EquipType = Literal["PRINT", "TRANSFER", "DTF", "EMB"]
StationType = Literal["KIOSK", "PDA", "TOUCHPC", "BOARD", "ADMIN"]
Role = Literal["ADMIN", "MANAGER", "SALES", "WORKER", "VIEWER"]
RequiredInput = Literal[
    "qty", "box_count", "inspection", "equipment", "qty_good", "qty_bad", "qty_box", "tracking_no"
]
OfflineState = Literal["ONLINE", "WARN", "ERROR"]
ImportEntity = Literal["customer", "item", "stock"]
MigrationSource = Literal["IMS_XLS", "COUNT"]
MergePolicy = Literal["SKIP", "UPDATE"]


# ---- 거래처 ----
class CustomerAddress(ApiModel):
    id: int
    customer_id: int
    label: str
    receiver: str | None
    phone: str | None
    postal_code: str | None
    address1: str
    address2: str | None
    is_default: bool
    active: bool


class CustomerAddressInput(ApiModel):
    label: str = Field(min_length=1, max_length=50)
    receiver: str | None = Field(default=None, max_length=50)
    phone: str | None = Field(default=None, max_length=30)
    postal_code: str | None = Field(default=None, max_length=10)
    address1: str = Field(min_length=1, max_length=200)
    address2: str | None = Field(default=None, max_length=200)
    is_default: bool = False


class CustomerAddressUpdate(ApiModel):
    """PATCH 용 (보낸 필드만). ts-types 에 별도 이름 없음 → Partial<CustomerAddressInput>."""

    _read_only = read_only_fields("id", "customer_id")

    label: str | None = Field(default=None, min_length=1, max_length=50)
    receiver: str | None = Field(default=None, max_length=50)
    phone: str | None = Field(default=None, max_length=30)
    postal_code: str | None = Field(default=None, max_length=10)
    address1: str | None = Field(default=None, min_length=1, max_length=200)
    address2: str | None = Field(default=None, max_length=200)
    is_default: bool | None = None


class Customer(ApiModel):
    id: int
    code: str
    name: str
    contact_name: str | None
    phone: str | None
    email: str | None
    default_carrier: str | None
    legacy_id: str | None
    active: bool
    created_at: KstDateTime
    updated_at: KstDateTime
    addresses: list[CustomerAddress] | None = None


class CustomerCreate(ApiModel):
    code: CodeStr = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=100)
    contact_name: str | None = Field(default=None, max_length=50)
    phone: str | None = Field(default=None, max_length=30)
    email: str | None = Field(default=None, max_length=100)
    default_carrier: str | None = Field(default=None, max_length=20)
    legacy_id: str | None = Field(default=None, max_length=50)


class CustomerUpdate(ApiModel):
    _read_only = read_only_fields("id", "code", "active", "created_at", "updated_at")
    name: str | None = Field(default=None, min_length=1, max_length=100)
    contact_name: str | None = Field(default=None, max_length=50)
    phone: str | None = Field(default=None, max_length=30)
    email: str | None = Field(default=None, max_length=100)
    default_carrier: str | None = Field(default=None, max_length=20)
    legacy_id: str | None = Field(default=None, max_length=50)


# ---- 품목 · 품목군 ----
class Item(ApiModel):
    id: int
    code: str
    name: str
    item_group: str
    spec: str | None
    color: str | None
    weight_g: int | None
    vendor_item_code: str | None
    vendor_barcode: str | None
    qty_tolerance_pct: float
    legacy_id: str | None
    active: bool
    created_at: KstDateTime
    updated_at: KstDateTime


class ItemCreate(ApiModel):
    code: CodeStr = Field(min_length=1, max_length=30)
    name: str = Field(min_length=1, max_length=100)
    item_group: CodeStr = Field(min_length=1, max_length=30)
    spec: str | None = Field(default=None, max_length=50)
    color: str | None = Field(default=None, max_length=30)
    weight_g: int | None = Field(default=None, ge=0)
    vendor_item_code: str | None = Field(default=None, max_length=50)
    vendor_barcode: str | None = Field(default=None, max_length=64)
    qty_tolerance_pct: float | None = Field(default=None, ge=0, le=50)
    legacy_id: str | None = Field(default=None, max_length=50)


class ItemUpdate(ApiModel):
    _read_only = read_only_fields("id", "code", "active", "created_at", "updated_at")
    name: str | None = Field(default=None, min_length=1, max_length=100)
    item_group: CodeStr | None = Field(default=None, min_length=1, max_length=30)
    spec: str | None = Field(default=None, max_length=50)
    color: str | None = Field(default=None, max_length=30)
    weight_g: int | None = Field(default=None, ge=0)
    vendor_item_code: str | None = Field(default=None, max_length=50)
    vendor_barcode: str | None = Field(default=None, max_length=64)
    qty_tolerance_pct: float | None = Field(default=None, ge=0, le=50)
    legacy_id: str | None = Field(default=None, max_length=50)


class ItemGroup(ApiModel):
    code: str
    name: str
    active: bool


class ItemGroupCreate(ApiModel):
    code: CodeStr = Field(min_length=1, max_length=30)
    name: str = Field(min_length=1, max_length=50)


class ItemGroupUpdate(ApiModel):
    """PATCH /item-groups/{code} (admin #9). ts-types 에 이름 없음 → 보고."""

    _read_only = read_only_fields("code", "active")

    name: str | None = Field(default=None, min_length=1, max_length=50)


# ---- 공정 · 가공방식 · 설비 ----
class Process(ApiModel):
    code: str
    name: str
    seq: int
    requires_equipment: bool
    required_inputs: list[str]
    active: bool


class ProcessCreate(ApiModel):
    code: CodeStr = Field(min_length=1, max_length=3)
    name: str = Field(min_length=1, max_length=30)
    seq: int = Field(ge=0, le=32767)
    requires_equipment: bool = False
    required_inputs: list[str] = Field(
        default_factory=list
    )  # 허용값 검사는 서비스 (422 BAD_REQUIRED_INPUT)


class ProcessUpdate(ApiModel):
    _read_only = read_only_fields("code", "active")
    name: str | None = Field(default=None, min_length=1, max_length=30)
    seq: int | None = Field(default=None, ge=0, le=32767)
    requires_equipment: bool | None = None
    required_inputs: list[str] | None = None


class ProcessReorderRequest(ApiModel):
    codes: list[CodeStr] = Field(min_length=1)


class PrintMethod(ApiModel):
    code: str
    name: str
    equip_types: list[str]
    skips_p30: bool
    active: bool


class PrintMethodCreate(ApiModel):
    """POST /print-methods (CRUD 공통형). ts-types 에 이름 없음 → 보고."""

    code: CodeStr = Field(min_length=1, max_length=20, pattern=r"^[A-Z][A-Z0-9_]*$")
    name: str = Field(min_length=1, max_length=30)
    equip_types: list[EquipType] = Field(default_factory=list)
    skips_p30: bool = False


class PrintMethodUpdate(ApiModel):
    _read_only = read_only_fields("code", "skips_p30", "active")
    name: str | None = Field(default=None, min_length=1, max_length=30)
    equip_types: list[EquipType] | None = None


class Equipment(ApiModel):
    id: int
    code: str
    name: str
    process_code: str
    equip_type: str
    active: bool


class EquipmentCreate(ApiModel):
    code: CodeStr = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=50)
    process_code: CodeStr = Field(default="P30", min_length=1, max_length=3)
    equip_type: EquipType


class EquipmentUpdate(ApiModel):
    _read_only = read_only_fields("id", "code", "active")
    name: str | None = Field(default=None, min_length=1, max_length=50)
    process_code: CodeStr | None = Field(default=None, min_length=1, max_length=3)
    equip_type: EquipType | None = None


# ---- 라우팅 ----
class RoutingStep(ApiModel):
    id: int | None = None
    seq: int
    process_code: str
    std_lead_hours: float
    tolerance_pct: float | None


class RoutingStepInput(ApiModel):
    seq: int = Field(ge=0, le=32767)
    process_code: CodeStr = Field(min_length=1, max_length=3)
    std_lead_hours: float = Field(ge=0)
    tolerance_pct: float | None = Field(default=None, ge=0, le=50)


class Routing(ApiModel):
    id: int
    item_group: str
    print_method: PrintMethodCode
    active: bool
    steps: list[RoutingStep]


class RoutingCreate(ApiModel):
    item_group: CodeStr = Field(min_length=1, max_length=30)
    print_method: CodeStr = Field(min_length=1, max_length=20)
    steps: list[RoutingStepInput] = Field(min_length=1)


class RoutingUpdate(ApiModel):
    _read_only = read_only_fields("id", "item_group", "print_method", "steps")
    active: bool | None = None


class RoutingStepsPut(ApiModel):
    """PUT /routings/{id}/steps 본문 ``{steps:[RoutingStepInput]}``."""

    steps: list[RoutingStepInput] = Field(min_length=1)


# ---- 단말 ----
class Station(ApiModel):
    id: str
    type: StationType
    process_code: str | None
    location: str | None
    api_key_prefix: str
    last_seen_at: KstDateTime | None
    active: bool
    printer_id: str | None
    offline_state: OfflineState


class StationCreate(ApiModel):
    id: CodeStr = Field(min_length=1, max_length=20)
    type: StationType
    process_code: CodeStr | None = Field(default=None, max_length=3)
    location: str | None = Field(default=None, max_length=100)
    printer_id: CodeStr | None = Field(default=None, max_length=20)


class StationUpdate(ApiModel):
    _read_only = read_only_fields("id", "api_key_prefix", "last_seen_at", "active", "offline_state")
    type: StationType | None = None
    process_code: CodeStr | None = Field(default=None, max_length=3)
    location: str | None = Field(default=None, max_length=100)
    printer_id: CodeStr | None = Field(default=None, max_length=20)


class StationCreated(Station):
    api_key: str
    setup_url: str
    setup_qr_png: str


class StationKeyRotated(ApiModel):
    api_key: str
    setup_url: str
    setup_qr_png: str


# ---- 사용자 ----
class UserSummary(ApiModel):
    id: int
    login_id: str
    name: str
    role: Role
    card_code: str | None


class User(UserSummary):
    active: bool
    has_pin: bool
    has_password: bool
    created_at: KstDateTime


class UserCreate(ApiModel):
    login_id: LoginIdStr = Field(min_length=1, max_length=30)
    name: str = Field(min_length=1, max_length=50)
    role: Role
    password: str | None = None
    pin: str | None = None
    issue_card: bool | None = None  # 기본: role ∈ {WORKER, MANAGER} 이면 true (shopfloor ⑥)


class UserUpdate(ApiModel):
    _read_only = read_only_fields(
        "id", "login_id", "card_code", "active", "has_pin", "has_password", "created_at"
    )
    name: str | None = Field(default=None, min_length=1, max_length=50)
    role: Role | None = None


class SetPinRequest(ApiModel):
    pin: str


class SetPasswordRequest(ApiModel):
    password: str


class IssueCardRequest(ApiModel):
    reissue: bool | None = None
    printer_id: CodeStr | None = None


class IssueCardResponse(ApiModel):
    card_code: str
    label_job: LabelJob | None


# ---- 설정 ----
class CodePrefixes(ApiModel):
    SO: str = Field(min_length=1, max_length=4, pattern=r"^[A-Z]+$")
    WO: str = Field(min_length=1, max_length=4, pattern=r"^[A-Z]+$")
    LT: str = Field(min_length=1, max_length=4, pattern=r"^[A-Z]+$")
    US: str = Field(min_length=1, max_length=4, pattern=r"^[A-Z]+$")


class CodeSettings(ApiModel):
    prefixes: CodePrefixes
    seq_digits: Literal[4, 5]
    checkcode_key_generation: int


# ---- 엑셀 일괄 등록 ----
class ImportError(ApiModel):  # noqa: A001 — TS 이름 ``ImportError`` 와 1:1 (OpenAPI 컴포넌트명)
    row: int
    col: str
    msg: str


class ImportDuplicate(ApiModel):
    row: int
    existing_code: str
    reason: Literal["CODE", "NAME_PHONE"]


class ImportPreview(ApiModel):
    batch_id: int
    entity: ImportEntity
    source: MigrationSource
    row_count: int
    valid: int
    ignored: int  # 첫 열이 '#' 로 시작하는 행(템플릿 예시 등) — 데이터로 세지 않음 (D29)
    errors: list[ImportError]
    duplicates: list[ImportDuplicate]
    rows_sample: list[dict[str, Any]]


class ImportCommitRequest(ApiModel):
    # CODE·NAME_PHONE 공통. NAME_PHONE 은 SKIP 이 기본 처리, UPDATE 는 명시 선택 시에만 (D31)
    merge_policy: MergePolicy
    skip_invalid: bool | None = None


class ImportResult(ApiModel):
    batch_id: int
    loaded: int
    merged: int
    skipped: int
    failed: int


# ---- 마이그레이션 배치 (ts-types §9 board.ts 에 있으나 S0 는 임포트 API 가 쓴다) ----
class MigrationBatch(ApiModel):
    id: int
    source: MigrationSource
    entity: str
    source_file: str
    source_hash: str
    extracted_at: KstDateTime
    row_count_src: int
    row_count_loaded: int
    row_count_merged: int
    row_count_skipped: int
    row_count_failed: int
    row_count_ignored: int
    status: Literal["PREVIEW", "LOADED", "FAILED", "ROLLED_BACK"]
    merge_policy: MergePolicy | None
    created_by: UserSummary
    created_at: KstDateTime


class MigrationMap(ApiModel):
    id: int
    entity: str
    legacy_id: str
    new_id: int
    note: str | None


class MigrationBatchDetail(MigrationBatch):
    errors: list[ImportError]
    duplicates: list[ImportDuplicate]
    maps: Page[MigrationMap]

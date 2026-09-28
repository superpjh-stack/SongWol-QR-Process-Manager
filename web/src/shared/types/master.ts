/** 기준정보 — contracts/ts-types.md §4 (+§12 델타) */
import type { EquipType, ImportEntity, LabelType, MigrationSource, OfflineState, PrintMethodCode, ProcessCode, RequiredInput, Role, StationType } from './enums'
import type { LabelJob } from './order'

export interface Customer {
  id: number
  code: string
  name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  default_carrier: string | null
  legacy_id: string | null
  active: boolean
  created_at: string
  updated_at: string
  addresses?: CustomerAddress[]
}
export interface CustomerCreate {
  code: string
  name: string
  contact_name?: string
  phone?: string
  email?: string
  default_carrier?: string
  legacy_id?: string
}
/** 독립 정의 (CD-2). code 불변 → 422 READ_ONLY_FIELD. `?: T | null` = PATCH 로 비울 수 있음 */
export interface CustomerUpdate {
  name?: string
  contact_name?: string | null
  phone?: string | null
  email?: string | null
  default_carrier?: string | null
  legacy_id?: string | null
}
export interface CustomerAddress {
  id: number
  customer_id: number
  label: string
  receiver: string | null
  phone: string | null
  postal_code: string | null
  address1: string
  address2: string | null
  is_default: boolean
  active: boolean
}
/** 독립 정의 (CD-2, DEF-QA1-006 ×5). is_default 기본 false */
export interface CustomerAddressInput {
  label: string
  receiver?: string | null
  phone?: string | null
  postal_code?: string | null
  address1: string
  address2?: string | null
  is_default?: boolean
}
/** F26 — PATCH /customers/{id}/addresses/{addr_id} */
export interface CustomerAddressUpdate {
  label?: string
  receiver?: string | null
  phone?: string | null
  postal_code?: string | null
  address1?: string
  address2?: string | null
  is_default?: boolean
}

export interface Item {
  id: number
  code: string
  name: string
  item_group: string
  spec: string | null
  color: string | null
  weight_g: number | null
  vendor_item_code: string | null
  vendor_barcode: string | null
  qty_tolerance_pct: number
  legacy_id: string | null
  active: boolean
  created_at: string
  updated_at: string
}
export interface ItemCreate {
  code: string
  name: string
  item_group: string
  spec?: string
  color?: string
  weight_g?: number
  vendor_item_code?: string
  vendor_barcode?: string
  qty_tolerance_pct?: number
  legacy_id?: string
}
/** 독립 정의 (CD-2) */
export interface ItemUpdate {
  name?: string
  item_group?: string
  spec?: string | null
  color?: string | null
  weight_g?: number | null
  vendor_item_code?: string | null
  vendor_barcode?: string | null
  qty_tolerance_pct?: number | null
  legacy_id?: string | null
}

export interface Process {
  code: ProcessCode | string
  name: string
  seq: number
  requires_equipment: boolean
  required_inputs: string[]
  active: boolean
}
export interface PrintMethod {
  code: PrintMethodCode
  name: string
  equip_types: EquipType[]
  skips_p30: boolean
  active: boolean
}
export interface PrintMethodUpdate {
  name?: string
  equip_types?: EquipType[]
}
/** F26 — POST /print-methods. code `^[A-Z][A-Z0-9_]*$`, 기본 [] / false */
export interface PrintMethodCreate {
  code: string
  name: string
  equip_types?: EquipType[]
  skips_p30?: boolean
}
/** 기본 false / [] (DEF-QA1-006 ×2) */
export interface ProcessCreate {
  code: string
  name: string
  seq: number
  requires_equipment?: boolean
  required_inputs?: RequiredInput[]
}
export interface ProcessUpdate {
  name?: string
  seq?: number
  requires_equipment?: boolean
  required_inputs?: RequiredInput[]
}
/** POST /processes/reorder (백엔드 추가) */
export interface ProcessReorderRequest {
  codes: string[]
}
export interface Equipment {
  id: number
  code: string
  name: string
  process_code: string
  equip_type: EquipType
  active: boolean
}
/** process_code 기본 'P30' (DEF-QA1-006) */
export interface EquipmentCreate {
  code: string
  name: string
  process_code?: string
  equip_type: EquipType
}
export interface EquipmentUpdate {
  name?: string
  process_code?: string
  equip_type?: EquipType
}
export interface ItemGroup {
  code: string
  name: string
  active: boolean
} // admin #9
export interface ItemGroupCreate {
  code: string
  name: string
}
/** PATCH /item-groups/{code} (백엔드 추가) */
export interface ItemGroupUpdate {
  name?: string
}
export interface Carrier {
  code: string
  name: string
  active: boolean
} // admin #6 [S3]
export interface CarrierCreate {
  code: string
  name: string
}

export interface RoutingStep {
  id?: number
  seq: number
  process_code: string
  std_lead_hours: number
  tolerance_pct: number | null
}
/** 독립 정의 (DEF-QA1-006). tolerance_pct 빈칸 = 품목 qty_tolerance_pct */
export interface RoutingStepInput {
  seq: number
  process_code: string
  std_lead_hours: number
  tolerance_pct?: number | null
}
export interface Routing {
  id: number
  item_group: string
  print_method: PrintMethodCode
  active: boolean
  steps: RoutingStep[]
}
export interface RoutingCreate {
  item_group: string
  print_method: PrintMethodCode
  steps: RoutingStepInput[]
}
export interface RoutingUpdate {
  active?: boolean
} // 헤더 키 불변 (admin #10)
/** PUT /routings/{id}/steps 본문 (백엔드 추가) */
export interface RoutingStepsPut {
  steps: RoutingStepInput[]
}

export interface Station {
  id: string
  type: StationType
  process_code: string | null
  location: string | null
  api_key_prefix: string
  last_seen_at: string | null
  active: boolean
  printer_id: string | null
  offline_state: OfflineState
} // printer_id ②, offline_state #14
export interface StationCreate {
  id: string
  type: StationType
  process_code?: string
  location?: string
  printer_id?: string
}
export interface StationUpdate {
  type?: StationType
  process_code?: string | null
  location?: string | null
  printer_id?: string | null
}
export interface StationCreated extends Station {
  api_key: string
  setup_url: string
  setup_qr_png: string
} // 평문 1회 (#15 ①)
export interface StationKeyRotated {
  api_key: string
  setup_url: string
  setup_qr_png: string
}

export interface UserSummary {
  id: number
  login_id: string
  name: string
  role: Role
  card_code: string | null
}
export interface User extends UserSummary {
  active: boolean
  has_pin: boolean
  has_password: boolean
  created_at: string
}
export interface UserCreate {
  login_id: string
  name: string
  role: Role
  password?: string
  pin?: string
  issue_card?: boolean
} // issue_card 기본: role∈{WORKER,MANAGER} 이면 true (⑥)
/** 독립 정의 */
export interface UserUpdate {
  name?: string
  role?: Role
}
/** POST /users/{id}/set-pin · set-password (백엔드 추가) */
export interface SetPinRequest {
  pin: string
}
export interface SetPasswordRequest {
  password: string
}
export interface IssueCardRequest {
  reissue?: boolean
  printer_id?: string
}
export interface IssueCardResponse {
  card_code: string
  label_job: LabelJob | null
}

export interface Printer {
  id: string
  name: string
  host: string
  port: number
  purpose: 'PRODUCTION' | 'PACKING'
  location: string | null
  active: boolean
}
export interface PrinterCreate {
  id: string
  name: string
  host: string
  port?: number
  purpose: 'PRODUCTION' | 'PACKING'
  location?: string
}
/** 독립 정의 */
export interface PrinterUpdate {
  name?: string
  host?: string
  port?: number
  purpose?: 'PRODUCTION' | 'PACKING'
  location?: string | null
}
export interface LabelTemplate {
  label_type: LabelType
  format: 'ZPL' | 'HTML'
  body: string
  version: number
  placeholders: string[]
  updated_at: string
  updated_by: UserSummary | null
}
export interface LabelTemplateUpdate {
  body: string
}
/** F26. S0 고정 — 다른 값 PUT 시 422 PREFIX_FIXED (api §14.4 F25) */
export interface CodePrefixes {
  SO: string
  WO: string
  LT: string
  US: string
}
export interface CodeSettings {
  prefixes: CodePrefixes
  seq_digits: 4 | 5
  checkcode_key_generation: number
} // seq_digits = 최소 자릿수 (admin #21). 저장처 app_setting.CODE_SETTINGS
export interface StationOfflineThreshold {
  warn_minutes: number
  error_minutes: number
} // app_setting [S4]

export interface ImportError {
  row: number
  col: string
  msg: string
}
export interface ImportDuplicate {
  row: number
  existing_code: string
  reason: 'CODE' | 'NAME_PHONE'
}
export interface ImportPreview {
  batch_id: number
  entity: ImportEntity
  source: MigrationSource
  row_count: number
  valid: number
  errors: ImportError[]
  duplicates: ImportDuplicate[]
  rows_sample: Record<string, unknown>[]
  /** `#` 로 시작하는 예시 행 무시 건수 (D29, ts-types v0.3 필수). 백엔드 S0 fix 커밋 전 응답에는 없을 수 있어 화면은 `?? 0` 으로 읽는다 */
  ignored: number
}
export interface ImportCommitRequest {
  merge_policy: 'SKIP' | 'UPDATE'
  skip_invalid?: boolean
}
export interface ImportResult {
  batch_id: number
  loaded: number
  merged: number
  skipped: number
  failed: number
}

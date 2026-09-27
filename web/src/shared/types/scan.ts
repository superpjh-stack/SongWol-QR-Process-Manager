/** 스캔 — contracts/ts-types.md §6 */
import type {
  AllowedAction,
  ApprovalStatus,
  DefectType,
  EquipType,
  Inspection,
  LabelType,
  LoginVia,
  PrintMethodCode,
  ReceiptStatus,
  ScanAction,
  ScanResult,
  StepStatus,
  TargetType,
  VarianceReasonCode,
  WoStatus,
} from './enums'
import type { IdRef } from './common'
import type { UserSummary } from './master'
import type { LabelJob, SalesOrderSummary, WorkOrderSummary } from './order'
import type { InboundLot, Receipt } from './material'
import type { PackBoxSummary, ShipmentDetail } from './shipping'

export interface ScanExtra {
  // api-contract §5.4
  defect_type?: DefectType
  variance_reason?: string
  inspection?: Inspection
  vendor?: string
  tracking_no?: string
  carrier?: string
  box_codes?: string[]
  wo_code?: string
  cancel_event_uuid?: string
  label_type?: LabelType
  printer_id?: string
  variance_reason_code?: VarianceReasonCode // §13.5 ⑨
  offline_seq?: number // §13.7 ⑬ PACK
}

export interface ScanRequest {
  // spec §8.1 그대로 + 추가 2필드
  event_uuid: string
  scanned_at: string
  station_id: string
  worker_card: string
  code: string
  check?: string | null
  action: ScanAction
  qty_good?: number
  qty_bad?: number
  equipment_code?: string
  extra?: ScanExtra
  qty_box?: number // 추가
  client_seq?: number // 추가
}

export interface ScanWoSummary {
  code: string
  so_code: string
  customer_name: string
  item_name: string
  spec: string | null
  color: string | null
  print_method: PrintMethodCode
  qty_ordered: number
  qty_received: number
  qty_good: number
  qty_packed: number
  qty_shipped: number // ⑯ 추가 3
  receipt_status: ReceiptStatus
  qty_tolerance_pct: number // ⑯ 추가
  status: WoStatus
  current_step_seq: number | null
  design_thumbnail_url: string | null
  due_date: string
}
export interface ScanStep {
  process_code: string
  status: StepStatus
  qty_in: number | null
  qty_good: number | null
  qty_bad: number | null
  tolerance_pct: number
  remaining_equip_types?: EquipType[]
} // ⑯ tolerance_pct · ㉕ [S6] remaining_equip_types (파일럿 [])

export interface ScanResponse {
  // spec §8.1 의 7필드 + 추가
  result: ScanResult
  message: string
  wo: ScanWoSummary | null
  next_process: string | null
  remaining_qty: number | null
  requires_approval: boolean
  approval_token: string | null
  warnings: string[]
  step: ScanStep | null
  event_uuid: string | null
  duplicate: boolean // 추가 (event_uuid 는 배치 형식오류 건만 null, ⑦)
  code?: string // REJECT 기계 코드 (§13 ⑦)
  label_job?: LabelJob
  worker?: UserSummary
  box?: PackBoxSummary
  receipt?: Receipt
  shipment?: ShipmentDetail // 액션별 부가 (⑰ receipt, ㉑ ShipmentDetail)
}

export interface ScanBatchRequest {
  events: ScanRequest[]
}
export interface ScanBatchResponse {
  results: Array<{ event_uuid: string; response: ScanResponse }>
}

export interface ApproveRequest {
  approver_card?: string
  pin?: string
  decision: 'APPROVE' | 'DENY'
  note?: string
  note_code?: VarianceReasonCode
} // ㉔ note → variance_reason

export interface PendingScan {
  event_uuid: string
  scanned_at: string
  station_id: string
  worker: UserSummary | null
  wo: ScanWoSummary | null
  action: ScanAction
  process_code: string | null
  message: string
  approval_token: string
}

export interface ScanEventSummary {
  event_uuid: string
  scanned_at: string
  received_at: string
  station_id: string
  process_code: string | null
  worker: UserSummary | null
  target_type: TargetType
  target_code: string
  action: ScanAction
  qty_good: number | null
  qty_bad: number | null
  qty_box: number | null
  equipment: IdRef | null
  result: ScanResult
  result_msg: string | null
  approval_status: ApprovalStatus | null
  compensates_uuid: string | null
  payload: Record<string, unknown>
}

export interface PendingScanRecord {
  // 오프라인 큐 (IndexedDB 'pending_scans', plan §5.2)
  event_uuid: string // keyPath
  payload: ScanRequest
  created_at: string
  attempts: number
  last_error: string | null
  client_seq: number
}

export interface QueueItem {
  wo: WorkOrderSummary
  step_status: StepStatus
  qty_in: number
  waiting_hours: number
  due_date: string
  delay_risk: boolean
}
export interface QueueResponse {
  process_code: string
  process_name: string
  items: QueueItem[]
  pending_approvals: number
}

export interface WorkerLoginRequest {
  card_code?: string
  login_id?: string
  pin?: string
}
export interface WorkerLoginResponse {
  worker: UserSummary
  login_via: LoginVia
}
export interface OfflineWorkerCache {
  fetched_at: string
  workers: UserSummary[]
} // GET /stations/{id}/workers 캐시 (§13.2 ④) [S4]
export interface LoginRequest {
  login_id: string
  password: string
}
export interface LoginResponse {
  access_token: string
  token_type?: 'bearer' // Pydantic 기본값 있음 → 선택 (DEF-QA1-006)
  expires_in: number
  user: UserSummary
}
export interface QrLanding {
  type: TargetType
  code: string
  summary: SalesOrderSummary | WorkOrderSummary | PackBoxSummary | InboundLot | UserSummary
  allowed_actions: AllowedAction[]
}

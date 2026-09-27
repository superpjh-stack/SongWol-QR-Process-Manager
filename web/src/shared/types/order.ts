/** 수주 · WO — contracts/ts-types.md §5 */
import type { LabelType, PrintMethodCode, ReceiptStatus, SoStatus, StepStatus, TargetType, WoStatus } from './enums'
import type { IdRef } from './common'
import type { RoutingStepInput, UserSummary } from './master'
import type { InboundLot, ReceiptSummary } from './material'
import type { ScanEventSummary } from './scan'
import type { PackBoxSummary } from './shipping'

export interface ShipTo {
  receiver: string | null
  phone: string | null
  postal_code: string | null
  address1: string
  address2: string | null
}

export interface Design {
  id: number
  so_line_id: number
  version: number
  file_url: string
  thumbnail_url: string | null
  confirmed_at: string | null
  is_current: boolean
  created_at: string
}

export interface SalesOrderLine {
  id: number
  line_no: number
  item: IdRef & { spec: string | null; color: string | null }
  print_method: PrintMethodCode
  qty: number
  unit_price: number | null
  design: Design | null
  design_confirmed: boolean
}
export interface SalesOrderLineInput {
  id?: number
  item_id: number
  print_method: PrintMethodCode
  qty: number
  unit_price?: number
}

export interface SalesOrderSummary {
  id: number
  code: string
  customer: IdRef
  order_date: string
  due_date: string
  status: SoStatus
  progress_pct: number
  delay_risk: boolean
  line_count: number
  wo_count: number
  confirmed_at: string | null
  shipped_at: string | null
}
export interface SalesOrder extends SalesOrderSummary {
  ship_to: ShipTo
  memo: string | null
  lines: SalesOrderLine[]
  created_by: UserSummary
  created_at: string
  updated_at: string
}
export interface SalesOrderDetail extends SalesOrder {
  work_orders: WorkOrderSummary[]
  current_processes: string[]
  est_complete_at: string | null
}
export interface SalesOrderCreate {
  customer_id: number
  order_date: string
  due_date: string
  ship_to?: ShipTo
  address_id?: number
  memo?: string
  lines: SalesOrderLineInput[]
}
export interface SalesOrderUpdate {
  due_date?: string
  ship_to?: ShipTo
  memo?: string
  lines?: SalesOrderLineInput[]
}

export interface WoDraft {
  so_line_id: number
  item_id: number
  print_method: PrintMethodCode
  qty: number
  routing_id: number
  steps: RoutingStepInput[]
}
export interface WoProposal {
  items: WoDraft[]
}
export interface IssueWoRequest {
  drafts: WoDraft[]
}
export interface IssueWoResponse {
  work_orders: WorkOrder[]
  pdf_url: string
}

export interface StepWork {
  id: number
  seq: number
  equipment: IdRef
  worker: UserSummary
  started_at: string | null
  done_at: string | null
  qty_good: number | null
  qty_bad: number | null
}
export interface RouteStep {
  id: number
  seq: number
  process_code: string
  process_name: string
  std_lead_hours: number
  tolerance_pct: number
  status: StepStatus
  started_at: string | null
  done_at: string | null
  qty_in: number | null
  qty_good: number | null
  qty_bad: number | null
  equipment: IdRef | null
  worker: UserSummary | null
  is_estimated: boolean
  approved_by: UserSummary | null
  variance_reason: string | null
  works: StepWork[]
}

export interface WorkOrderSummary {
  id: number
  code: string
  so_code: string
  customer_name: string
  item: IdRef & { spec: string | null; color: string | null }
  print_method: PrintMethodCode
  qty_ordered: number
  qty_received: number
  qty_good: number
  qty_bad: number
  qty_packed: number
  qty_shipped: number
  receipt_status: ReceiptStatus
  status: WoStatus
  current_step_seq: number | null
  current_process_code: string | null
  due_date: string
  delay_risk: boolean
  design_version: number | null
  design_thumbnail_url: string | null
  parent_wo_code: string | null
  split_suffix: string | null
  issued_at: string | null
}
export interface WorkOrder extends WorkOrderSummary {
  steps: RouteStep[]
  hold_reason: string | null
  closed_at: string | null
}
export interface WorkOrderDetail extends WorkOrder {
  recent_events: ScanEventSummary[]
  boxes: PackBoxSummary[]
  receipts: ReceiptSummary[]
  children: WorkOrderSummary[]
}

export interface SplitRequest {
  qty: number
  reason: string
}
export interface SplitResponse {
  parent: WorkOrder
  child: WorkOrder
}
export interface ReworkRequest {
  qty: number
  reason: string
  reinsert_p30: boolean
}
export interface ReworkResponse {
  child: WorkOrder
  lot: InboundLot | null
}
export interface ReasonRequest {
  reason: string
}
export interface SoCancelResponse {
  so: SalesOrder
  cancelled_wo: string[]
  pending_wo: WorkOrderSummary[]
} // admin #27 [S1]
export interface SplitRequestStation extends SplitRequest {
  approver_card: string
  pin: string
} // shopfloor ⑱ [S3]
export interface ReprintRequest {
  label_type: 'WORK_ORDER_PDF' | 'WO_LABEL'
  printer_id?: string
}
export interface LabelPrintRequest {
  target: string
  label_type: LabelType
  printer: string
  copies?: number
} // spec §8.6 글자 그대로 (printer = printer.id)
export interface LabelJob {
  issue_no: number
  label_type: LabelType
  printer_id: string | null
  copies: number
  sent_at: string | null
  pdf_url: string | null
  zpl_sent: boolean
  error: string | null
} // error: 'PRINTER_UNREACHABLE' | 'NO_PRINTER' (§13.7)
export interface LabelIssue extends LabelJob {
  id: number
  target_type: Exclude<TargetType, 'VB'>
  target_code: string
  issued_at: string
  issued_by: UserSummary | null
  station_id: string | null
}

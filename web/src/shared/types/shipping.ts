/** 출하 — contracts/ts-types.md §8 */
import type { ShipmentStatus, TargetType, WoStatus } from './enums'
import type { UserSummary } from './master'
import type { LabelJob, WorkOrderSummary } from './order'

export interface PackBoxSummary {
  kind: 'PACK'
  id: number
  code: string
  wo_code: string
  box_no: number
  qty: number
  packed_at: string
  shipment_id: number | null
}
export interface PackBoxDetail extends PackBoxSummary {
  wo: WorkOrderSummary
  worker: UserSummary
  shipment: ShipmentSummary | null
}
export interface BoxCreate {
  event_uuid?: string
  wo_code: string
  qty: number
  printer_id?: string
  worker_card?: string
} // event_uuid: STATION 필수 (§13.6)
export interface PackBox extends PackBoxSummary {
  label_job: LabelJob | null
  wo_qty_packed: number
  wo_status: WoStatus
}
export interface ShipmentCreate {
  event_uuid?: string
  so_code?: string
  box_codes: string[]
  tracking_no: string
  carrier?: string
  worker_card?: string
  confirm: boolean
} // event_uuid: STATION 필수 (§13.6)
export interface ShipmentSummary {
  id: number
  so_code: string
  customer_name: string
  carrier: string | null
  tracking_no: string | null
  status: ShipmentStatus
  shipped_at: string | null
  qty_total: number
  box_count: number
}
export interface ShipmentDetail extends ShipmentSummary {
  boxes: PackBoxSummary[]
  worker: UserSummary | null
  so_remaining_qty: number
}
export type Shipment = ShipmentDetail
export interface DailyShipmentReport {
  date: string
  rows: Array<{
    so_code: string
    customer_name: string
    item_name: string
    qty: number
    tracking_no: string | null
    shipped_at: string | null
    overdue: boolean
  }>
  totals: { shipments: number; boxes: number; qty: number }
}
export interface TraceTree {
  root: { type: TargetType; code: string }
  nodes: Array<{ type: 'SHIPMENT' | 'BOX' | 'WO' | 'STEP' | 'LOT'; code: string; label: string; at: string | null; children: number[] }>
} // [확장]

/** 자재 — contracts/ts-types.md §7 */
import type { Inspection, LotStatus, ReceiptStatus, StockSource, StockTxnType } from './enums'
import type { IdRef } from './common'
import type { UserSummary } from './master'
import type { WorkOrderSummary } from './order'

export interface InboundLot {
  kind: 'INBOUND'
  id: number
  code: string
  item: IdRef
  vendor: string | null
  received_at: string
  qty: number
  status: LotStatus
  quarantine_memo: string | null
}
export interface ReceiptCreate {
  event_uuid?: string
  wo_code?: string
  item_id?: number
  qty: number
  box_count?: number
  inspection: Inspection
  vendor?: string
  vendor_barcode?: string
  received_at?: string
  worker_card?: string
  quarantine_memo?: string // S3 수정: DEF-QA2-S3-002
} // event_uuid: STATION 필수 (§13.6)
export interface ReceiptSummary {
  id: number
  wo_code: string | null
  item: IdRef
  lot_code: string
  qty: number
  box_count: number | null
  inspection: Inspection
  received_at: string
  worker: UserSummary
}
export interface Receipt extends ReceiptSummary {
  lot: InboundLot
  wo_receipt_status: ReceiptStatus | null
  remaining_qty: number | null
  vendor_barcode: string | null
}
export interface VendorBarcodeMap {
  id: number
  vendor_barcode: string
  wo_code: string
  item: IdRef
  mapped_at: string
  mapped_by: UserSummary
  active: boolean
}
export interface VendorBarcodeLookup {
  mapping: VendorBarcodeMap | null
  wo: WorkOrderSummary | null
}
export interface StockRow {
  item_id: number
  item_code: string
  item_name: string
  spec: string | null
  color: string | null
  qty_on_hand: number
  updated_at: string | null
  last_receive_at: string | null
  last_ship_at: string | null
}
export interface StockAdjust {
  item_id: number
  qty_delta: number
  reason: string
  source?: 'NEW' | 'COUNT'
} // admin #12
export interface StockTxn {
  id: number
  item: IdRef
  txn_type: StockTxnType
  qty: number
  ref_type: string | null
  ref_id: number | null
  reason: string | null
  source: StockSource
  created_by: UserSummary | null
  created_at: string
}

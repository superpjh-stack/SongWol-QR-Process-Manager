/** 현황판 · 집계 · 알림 · 운영 · WebSocket — contracts/ts-types.md §9 · §10 */
import type { EquipType, MigrationSource, MigrationStatus, NotificationChannel, NotificationType, SoStatus } from './enums'
import type { Page } from './common'
import type { ImportDuplicate, ImportError, UserSummary } from './master'
import type { WorkOrderSummary } from './order'
import type { PendingScan } from './scan'

export interface SoProgress {
  so_id: number
  so_code: string
  customer_name: string
  due_date: string
  status: SoStatus
  progress_pct: number
  current_processes: string[]
  delay_risk: boolean
  est_complete_at: string | null
}
export interface ProcessQueueRow {
  process_code: string
  process_name: string
  wo_count: number
  qty_total: number
  max_wait_hours: number
}
export interface DashboardSummary {
  today_due: SoProgress[]
  delay_risk: SoProgress[]
  process_queue: ProcessQueueRow[]
  today_shipments: { planned: number; done: number; overdue: number }
  output_per_hour_today: number
  pending_approvals: number
  offline_backlog: Array<{ station_id: string; count: number }>
  generated_at: string
}
export interface OutputReportRow {
  period: string
  process_code: string
  equipment_code: string | null
  equip_type: EquipType | null
  worker_name: string | null
  qty_good: number
  qty_bad: number
  wo_count: number
  output_per_hour: number | null
}
export interface OutputReport {
  from: string
  to: string
  group: 'day' | 'week' | 'month'
  rows: OutputReportRow[]
  totals: { qty_good: number; qty_bad: number; output_per_hour: number | null }
}
export interface Notification {
  id: number
  type: NotificationType
  target_code: string
  message: string
  channel: NotificationChannel
  created_at: string
  sent_at: string | null
  ack_by: UserSummary | null
  ack_at: string | null
}
export interface AuditLog {
  id: number
  table_name: string
  row_id: number
  action: 'INSERT' | 'UPDATE' | 'DELETE' | 'APPROVE'
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  user: UserSummary | null
  at: string
  request_id: string | null
}
export interface MigrationBatch {
  id: number
  source: MigrationSource
  entity: string
  source_file: string
  source_hash: string
  extracted_at: string
  row_count_src: number
  row_count_loaded: number
  row_count_merged: number
  status: MigrationStatus
  merge_policy: 'SKIP' | 'UPDATE' | null
  created_by: UserSummary
  created_at: string
}
export interface MigrationMap {
  id: number
  entity: string
  legacy_id: string
  new_id: number
  note: string | null
}
export interface MigrationBatchDetail extends MigrationBatch {
  errors: ImportError[]
  duplicates: ImportDuplicate[]
  maps: Page<MigrationMap>
}
export interface HealthResponse {
  status: 'ok' | 'degraded'
  db: 'ok' | 'error'
  version: string
  time: string
}

export type BoardMessage =
  | { type: 'snapshot'; at: string; summary: DashboardSummary }
  | { type: 'wo_updated'; at: string; wo: WorkOrderSummary; so: SoProgress; process_queue_delta: Array<Pick<ProcessQueueRow, 'process_code' | 'wo_count'>> }
  | { type: 'notification'; at: string; notification: Notification }
  | { type: 'approval_pending'; at: string; pending: PendingScan }
  | { type: 'ping'; at: string }
export type BoardClientMessage = { type: 'pong' }

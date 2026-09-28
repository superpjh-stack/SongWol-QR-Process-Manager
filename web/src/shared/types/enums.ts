/**
 * Enum — contracts/ts-types.md §2 (+§12 델타). 값은 spec §2.3·db-schema CHECK 와 동일 문자열.
 * 한국어 표시명은 shared/labels.ts. 백엔드는 표시명을 내려주지 않는다.
 */
export const ProcessCode = { P10: 'P10', P20: 'P20', P30: 'P30', P50: 'P50', P60: 'P60' } as const
export type ProcessCode = (typeof ProcessCode)[keyof typeof ProcessCode] // P40 없음

export type PrintMethodCode = 'SCREEN' | 'TRANSFER' | 'DTF' | 'EMB' | 'PRINT_EMB' | 'NONE'
export type EquipType = 'PRINT' | 'TRANSFER' | 'DTF' | 'EMB'
export type StationType = 'KIOSK' | 'PDA' | 'TOUCHPC' | 'BOARD' | 'ADMIN'
export type Role = 'ADMIN' | 'MANAGER' | 'SALES' | 'WORKER' | 'VIEWER'

export type SoStatus = 'OPEN' | 'IN_PROGRESS' | 'PARTIAL_SHIPPED' | 'SHIPPED' | 'CLOSED' | 'CANCELLED'
export type WoStatus = 'DRAFT' | 'ISSUED' | 'IN_PROGRESS' | 'PACKED' | 'SHIPPED' | 'CLOSED' | 'ON_HOLD' | 'CANCELLED'
export type StepStatus = 'WAITING' | 'STARTED' | 'DONE' | 'DONE_ESTIMATED' | 'PARTIAL' | 'SKIPPED'
export type ReceiptStatus = 'NONE' | 'PARTIAL' | 'FULL' | 'OVER'
export type Inspection = 'PASS' | 'COND' | 'FAIL'
export type LotStatus = 'OK' | 'QUARANTINE'
export type ShipmentStatus = 'READY' | 'SHIPPED' | 'DELIVERED'
export type StockTxnType = 'MIGRATE' | 'RECEIVE' | 'SHIP' | 'ADJUST' | 'REWORK'
export type StockSource = 'IMS_XLS' | 'NEW' | 'COUNT'

export type TargetType = 'SO' | 'WO' | 'LT' | 'US' | 'VB'
export type ScanAction = 'START' | 'DONE' | 'RECEIVE' | 'PACK' | 'SHIP' | 'LOGIN' | 'CANCEL' | 'REPRINT' | 'APPROVE' | 'MAP'
export type ScanResult = 'OK' | 'WARN' | 'REJECT'
/** api-contract §16.1 (B2-09). 생략 시 서버가 HID 로 간주 */
export type InputVia = 'HID' | 'CAMERA' | 'MANUAL' | 'URL'
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'DENIED'
export type DefectType = 'COLOR' | 'POSITION' | 'STAIN' | 'EMB_LOOSE' | 'OTHER' // [확장]
export type VarianceReasonCode = 'SHORT_INPUT' | 'MISCOUNT' | 'DEFECT_EXTRA' | 'SPLIT_MOVED' | 'OTHER' // E2 사유 (§13.5 ⑨)
export type AllowedAction = 'VIEW_DETAIL' | 'REPRINT' | 'HOLD' | 'SPLIT' | 'APPROVE_PENDING' | 'QUARANTINE' | 'SHIP' // QrLanding (admin #31)
export type LoginVia = 'CARD' | 'PIN' | 'OFFLINE_CACHE'

export type LabelType = 'WORK_ORDER_PDF' | 'WO_LABEL' | 'BOX_LABEL' | 'WORKER_CARD'
export type NotificationType = 'DELAY' | 'DEFECT' | 'RECEIPT_SHORT' | 'QTY_VARIANCE' | 'APPROVAL_REQUEST' | 'OFFLINE_BACKLOG'
export type NotificationChannel = 'KAKAO' | 'SMS' | 'PUSH' | 'EMAIL' | 'INAPP'
export type MigrationSource = 'IMS_XLS' | 'COUNT'
export type MigrationStatus = 'PREVIEW' | 'LOADED' | 'FAILED' | 'ROLLED_BACK'
export type ImportEntity = 'customer' | 'item' | 'stock'
/** admin #14 [S4] — station.offline_state (`GET/PUT /settings/station-offline` 임계값 기반) */
export type OfflineState = 'ONLINE' | 'WARN' | 'ERROR'
/** ADM-30 감사 로그 action */
export type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE' | 'APPROVE'

/** admin #11 — process.required_inputs 허용 값 */
export type RequiredInput = 'qty' | 'box_count' | 'inspection' | 'equipment' | 'qty_good' | 'qty_bad' | 'qty_box' | 'tracking_no'

/* 값 목록 (셀렉트·검증에 쓴다). 순서는 계약 표기 순 */
export const PRINT_METHOD_CODES: readonly PrintMethodCode[] = ['SCREEN', 'TRANSFER', 'DTF', 'EMB', 'PRINT_EMB', 'NONE']
export const EQUIP_TYPES: readonly EquipType[] = ['PRINT', 'TRANSFER', 'DTF', 'EMB']
export const STATION_TYPES: readonly StationType[] = ['KIOSK', 'PDA', 'TOUCHPC', 'BOARD', 'ADMIN']
export const ROLES: readonly Role[] = ['ADMIN', 'MANAGER', 'SALES', 'WORKER', 'VIEWER']
export const MIGRATION_STATUSES: readonly MigrationStatus[] = ['PREVIEW', 'LOADED', 'FAILED', 'ROLLED_BACK']
export const MIGRATION_SOURCES: readonly MigrationSource[] = ['IMS_XLS', 'COUNT']
export const IMPORT_ENTITIES: readonly ImportEntity[] = ['customer', 'item', 'stock']
export const STOCK_TXN_TYPES: readonly StockTxnType[] = ['MIGRATE', 'RECEIVE', 'SHIP', 'ADJUST', 'REWORK']
export const STOCK_SOURCES: readonly StockSource[] = ['IMS_XLS', 'NEW', 'COUNT']
export const REQUIRED_INPUTS: readonly RequiredInput[] = ['qty', 'box_count', 'inspection', 'equipment', 'qty_good', 'qty_bad', 'qty_box', 'tracking_no']
export const NOTIFICATION_TYPES: readonly NotificationType[] = ['DELAY', 'DEFECT', 'RECEIPT_SHORT', 'QTY_VARIANCE', 'APPROVAL_REQUEST', 'OFFLINE_BACKLOG']
export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ['KAKAO', 'SMS', 'PUSH', 'EMAIL', 'INAPP']
export const OFFLINE_STATES: readonly OfflineState[] = ['ONLINE', 'WARN', 'ERROR']
export const AUDIT_ACTIONS: readonly AuditAction[] = ['INSERT', 'UPDATE', 'DELETE', 'APPROVE']
/** ADM-30 필터 셀렉트 (screens-admin §2 훅 대상 목록, db §7.2) */
export const AUDIT_TABLES: readonly string[] = [
  'customer',
  'customer_address',
  'item',
  'process',
  'equipment',
  'print_method',
  'item_routing',
  'routing_step',
  'station',
  'app_user',
  'printer',
  'sales_order',
  'sales_order_line',
  'design',
  'stock_txn',
]

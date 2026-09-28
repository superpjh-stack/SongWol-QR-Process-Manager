/**
 * 상태값 → 의미색·아이콘·문구 매핑. 값은 spec §2.3 (와 contracts/db-schema.md CHECK 제약) 그대로.
 *
 * WoStatus·StepStatus·ReceiptStatus 등 타입은 shared/types (ts-types.md) 를 re-export 한다.
 * 문구: spec §2.3 상태값에 대한 「기본값」(design-tokens §5.3). 역할·이관 관련 문구는 shared/labels.ts.
 * 화면 코드는 이 파일의 문구·색을 직접 참조하지 말고 <StatusBadge> 를 쓴다.
 */
import type { ComponentType } from 'react'
import {
  IconUser,
  IconInbox,
  IconRefresh,
  IconImage,
  IconBox,
  IconCheck,
  IconCheckDashed,
  IconClock,
  IconDraft,
  IconHalf,
  IconLock,
  IconPause,
  IconPlay,
  IconSkip,
  IconTag,
  IconTruck,
  IconWarning,
  IconX,
  IconKey,
} from './icons'

/** 상태 타입은 contracts/ts-types.md (shared/types) 의 것을 그대로 re-export 한다 (값 동일). */
export type {
  WoStatus,
  StepStatus,
  ReceiptStatus,
  MigrationStatus,
  MigrationSource,
  StockSource,
  Role,
  SoStatus,
  ScanResult,
  ApprovalStatus,
  LotStatus,
  Inspection,
  ShipmentStatus,
  OfflineState,
} from '../types'
import type {
  ApprovalStatus,
  Inspection,
  LotStatus,
  MigrationStatus,
  OfflineState,
  ReceiptStatus,
  Role,
  ScanResult,
  ShipmentStatus,
  SoStatus,
  StepStatus,
  StockSource,
  WoStatus,
} from '../types'
import { ApprovalStatusLabel, InspectionLabel, LotStatusLabel, MigrationSourceLabel, MigrationStatusLabel, OfflineStateLabel, RoleLabel, ScanResultLabel, ShipmentStatusLabel, SoStatusLabel } from '../labels'

/** 의미색 키. tokens.css 의 --color-status-<tone>-* 와 1:1 */
export type StatusTone =
  | 'waiting'
  | 'progress'
  | 'done'
  | 'estimated'
  | 'partial'
  | 'warn'
  | 'error'
  | 'offline'
  | 'skipped'

export type StatusMeta = {
  label: string
  tone: StatusTone
  Icon: ComponentType<{ size?: number | string; className?: string }>
}

/** tone → Tailwind 클래스 (bg·text·border). 토큰이 바뀌면 여기만 바뀐다. */
export const TONE_CLASS: Record<StatusTone, string> = {
  waiting: 'bg-status-waiting-bg text-status-waiting-fg border-status-waiting-line',
  progress: 'bg-status-progress-bg text-status-progress-fg border-status-progress-line',
  done: 'bg-status-done-bg text-status-done-fg border-status-done-line',
  estimated: 'bg-status-estimated-bg text-status-estimated-fg border-status-estimated-line',
  partial: 'bg-status-partial-bg text-status-partial-fg border-status-partial-line',
  warn: 'bg-status-warn-bg text-status-warn-fg border-status-warn-line',
  error: 'bg-status-error-bg text-status-error-fg border-status-error-line',
  offline: 'bg-status-offline-bg text-status-offline-fg border-status-offline-line',
  skipped: 'bg-status-skipped-bg text-status-skipped-fg border-status-skipped-line',
}

export const WO_STATUS: Record<WoStatus, StatusMeta> = {
  DRAFT: { label: '임시', tone: 'waiting', Icon: IconDraft },
  ISSUED: { label: '발행', tone: 'progress', Icon: IconTag },
  IN_PROGRESS: { label: '진행 중', tone: 'progress', Icon: IconPlay },
  PACKED: { label: '포장 완료', tone: 'done', Icon: IconBox },
  SHIPPED: { label: '발송 완료', tone: 'done', Icon: IconTruck },
  CLOSED: { label: '종결', tone: 'done', Icon: IconLock },
  ON_HOLD: { label: '보류', tone: 'warn', Icon: IconPause },
  CANCELLED: { label: '취소', tone: 'error', Icon: IconX },
}

export const STEP_STATUS: Record<StepStatus, StatusMeta> = {
  WAITING: { label: '대기', tone: 'waiting', Icon: IconClock },
  STARTED: { label: '진행 중', tone: 'progress', Icon: IconPlay },
  DONE: { label: '완료', tone: 'done', Icon: IconCheck },
  DONE_ESTIMATED: { label: '추정 완료', tone: 'estimated', Icon: IconCheckDashed },
  PARTIAL: { label: '부분 완료', tone: 'partial', Icon: IconHalf },
  SKIPPED: { label: '생략', tone: 'skipped', Icon: IconSkip },
}

export const RECEIPT_STATUS: Record<ReceiptStatus, StatusMeta> = {
  NONE: { label: '미입고', tone: 'waiting', Icon: IconClock },
  PARTIAL: { label: '부분 입고', tone: 'partial', Icon: IconHalf },
  FULL: { label: '입고 완료', tone: 'done', Icon: IconCheck },
  OVER: { label: '초과 입고', tone: 'warn', Icon: IconWarning },
}

export const WO_STATUS_VALUES = Object.keys(WO_STATUS) as WoStatus[]
export const STEP_STATUS_VALUES = Object.keys(STEP_STATUS) as StepStatus[]
export const RECEIPT_STATUS_VALUES = Object.keys(RECEIPT_STATUS) as ReceiptStatus[]

/** 활성/비활성 (기준정보 공통, screens-admin §0.6) */
export const ACTIVE_STATUS: Record<'true' | 'false', StatusMeta> = {
  true: { label: '활성', tone: 'done', Icon: IconCheck },
  false: { label: '비활성', tone: 'skipped', Icon: IconPause },
}

/** 마이그레이션 배치 상태 (screens-admin ADM-31, §2 #1) */
export const MIGRATION_STATUS: Record<MigrationStatus, StatusMeta> = {
  PREVIEW: { label: MigrationStatusLabel.PREVIEW, tone: 'waiting', Icon: IconImage },
  LOADED: { label: MigrationStatusLabel.LOADED, tone: 'done', Icon: IconCheck },
  FAILED: { label: MigrationStatusLabel.FAILED, tone: 'error', Icon: IconX },
  ROLLED_BACK: { label: MigrationStatusLabel.ROLLED_BACK, tone: 'skipped', Icon: IconRefresh },
}

/** 이관·재고 출처 (screens-admin ADM-31·ADM-21). ADM-21 stock_txn.source 는 NEW 도 쓴다 (StockSource 가 상위집합) */
export const MIGRATION_SOURCE: Record<StockSource, StatusMeta> = {
  IMS_XLS: { label: MigrationSourceLabel.IMS_XLS, tone: 'progress', Icon: IconInbox },
  COUNT: { label: MigrationSourceLabel.COUNT, tone: 'partial', Icon: IconTag },
  NEW: { label: MigrationSourceLabel.NEW, tone: 'done', Icon: IconCheck },
}

/** 역할 (spec §3). 색은 구분용 기본값 */
export const ROLE_STATUS: Record<Role, StatusMeta> = {
  ADMIN: { label: RoleLabel.ADMIN, tone: 'error', Icon: IconUser },
  MANAGER: { label: RoleLabel.MANAGER, tone: 'progress', Icon: IconUser },
  SALES: { label: RoleLabel.SALES, tone: 'partial', Icon: IconUser },
  WORKER: { label: RoleLabel.WORKER, tone: 'done', Icon: IconUser },
  VIEWER: { label: RoleLabel.VIEWER, tone: 'waiting', Icon: IconUser },
}

/** 수주 상태 (screens-admin §2 #1 `so`). 문구 shared/labels SoStatusLabel */
export const SO_STATUS: Record<SoStatus, StatusMeta> = {
  OPEN: { label: SoStatusLabel.OPEN, tone: 'waiting', Icon: IconInbox },
  IN_PROGRESS: { label: SoStatusLabel.IN_PROGRESS, tone: 'progress', Icon: IconPlay },
  PARTIAL_SHIPPED: { label: SoStatusLabel.PARTIAL_SHIPPED, tone: 'partial', Icon: IconHalf },
  SHIPPED: { label: SoStatusLabel.SHIPPED, tone: 'done', Icon: IconTruck },
  CLOSED: { label: SoStatusLabel.CLOSED, tone: 'done', Icon: IconLock },
  CANCELLED: { label: SoStatusLabel.CANCELLED, tone: 'error', Icon: IconX },
}
export const SO_STATUS_VALUES = Object.keys(SO_STATUS) as SoStatus[]

/** 스캔 결과 (api-contract §3.3) */
export const SCAN_RESULT: Record<ScanResult, StatusMeta> = {
  OK: { label: ScanResultLabel.OK, tone: 'done', Icon: IconCheck },
  WARN: { label: ScanResultLabel.WARN, tone: 'warn', Icon: IconWarning },
  REJECT: { label: ScanResultLabel.REJECT, tone: 'error', Icon: IconX },
}

/** 승인 상태 (scan_event.approval_status) */
export const APPROVAL_STATUS: Record<ApprovalStatus, StatusMeta> = {
  PENDING: { label: ApprovalStatusLabel.PENDING, tone: 'warn', Icon: IconKey },
  APPROVED: { label: ApprovalStatusLabel.APPROVED, tone: 'done', Icon: IconCheck },
  DENIED: { label: ApprovalStatusLabel.DENIED, tone: 'error', Icon: IconX },
}

/** 입고 LOT 상태 (spec A3-08) */
export const LOT_STATUS: Record<LotStatus, StatusMeta> = {
  OK: { label: LotStatusLabel.OK, tone: 'done', Icon: IconCheck },
  QUARANTINE: { label: LotStatusLabel.QUARANTINE, tone: 'error', Icon: IconLock },
}

/** 지연 위험 (delay_risk) — 배지 하나로 표시 */
export const DELAY_RISK: StatusMeta = { label: '지연 위험', tone: 'warn', Icon: IconWarning }

/** 검수결과 (spec §2.2 P20 「합격 PASS / 조건부 COND / 불합격 FAIL」, PDA-12 TriChoice) */
export const INSPECTION_STATUS: Record<Inspection, StatusMeta> = {
  PASS: { label: InspectionLabel.PASS, tone: 'done', Icon: IconCheck },
  COND: { label: InspectionLabel.COND, tone: 'partial', Icon: IconHalf },
  FAIL: { label: InspectionLabel.FAIL, tone: 'error', Icon: IconX },
}
export const INSPECTION_STATUS_VALUES = Object.keys(INSPECTION_STATUS) as Inspection[]

/** 발송 상태 (ts-types §8 ShipmentStatus). ※ 색·문구는 기본값 — spec 은 정하지 않음 */
export const SHIPMENT_STATUS: Record<ShipmentStatus, StatusMeta> = {
  READY: { label: ShipmentStatusLabel.READY, tone: 'waiting', Icon: IconBox },
  SHIPPED: { label: ShipmentStatusLabel.SHIPPED, tone: 'done', Icon: IconTruck },
  DELIVERED: { label: ShipmentStatusLabel.DELIVERED, tone: 'done', Icon: IconCheck },
}

/** 단말 미접속 상태 (admin #14 [S4], ADM-07 단말 목록). tone 'offline' 은 이 상태 전용으로 예약돼 있었다 */
export const OFFLINE_STATE: Record<OfflineState, StatusMeta> = {
  ONLINE: { label: OfflineStateLabel.ONLINE, tone: 'done', Icon: IconCheck },
  WARN: { label: OfflineStateLabel.WARN, tone: 'warn', Icon: IconWarning },
  ERROR: { label: OfflineStateLabel.ERROR, tone: 'offline', Icon: IconX },
}

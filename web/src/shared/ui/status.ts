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
} from './icons'

/** 상태 타입은 contracts/ts-types.md (shared/types) 의 것을 그대로 re-export 한다 (값 동일). */
export type { WoStatus, StepStatus, ReceiptStatus, MigrationStatus, MigrationSource, Role } from '../types'
import type { MigrationSource, MigrationStatus, ReceiptStatus, Role, StepStatus, WoStatus } from '../types'
import { MigrationSourceLabel, MigrationStatusLabel, RoleLabel } from '../labels'

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

/** 이관 출처 (screens-admin ADM-31) */
export const MIGRATION_SOURCE: Record<MigrationSource, StatusMeta> = {
  IMS_XLS: { label: MigrationSourceLabel.IMS_XLS, tone: 'progress', Icon: IconInbox },
  COUNT: { label: MigrationSourceLabel.COUNT, tone: 'partial', Icon: IconTag },
}

/** 역할 (spec §3). 색은 구분용 기본값 */
export const ROLE_STATUS: Record<Role, StatusMeta> = {
  ADMIN: { label: RoleLabel.ADMIN, tone: 'error', Icon: IconUser },
  MANAGER: { label: RoleLabel.MANAGER, tone: 'progress', Icon: IconUser },
  SALES: { label: RoleLabel.SALES, tone: 'partial', Icon: IconUser },
  WORKER: { label: RoleLabel.WORKER, tone: 'done', Icon: IconUser },
  VIEWER: { label: RoleLabel.VIEWER, tone: 'waiting', Icon: IconUser },
}

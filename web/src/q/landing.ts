/**
 * QRL-01 순수 로직 — summary 판별(type + LT kind), allowed_action → 관리자 화면 링크, S1 에서 동작하는 액션 집합.
 * 값 출처: api-contract §10·§13.4 admin #30·#31, screens-admin QRL-01 「로그인 시 액션」 기본 매핑
 */
import type { AllowedAction, InboundLot, PackBoxSummary, QrLanding, SalesOrderSummary, UserSummary, WorkOrderSummary } from '@/shared/types'

export type LandingView =
  | { kind: 'SO'; summary: SalesOrderSummary }
  | { kind: 'WO'; summary: WorkOrderSummary }
  | { kind: 'LT_PACK'; summary: PackBoxSummary }
  | { kind: 'LT_INBOUND'; summary: InboundLot }
  | { kind: 'US'; summary: UserSummary }
  | { kind: 'UNKNOWN'; summary: unknown }

export function classifyLanding(l: Pick<QrLanding, 'type' | 'summary'>): LandingView {
  const s = l.summary as unknown as Record<string, unknown>
  switch (l.type) {
    case 'SO':
      return { kind: 'SO', summary: l.summary as SalesOrderSummary }
    case 'WO':
      return { kind: 'WO', summary: l.summary as WorkOrderSummary }
    case 'LT':
      if (s && s.kind === 'INBOUND') return { kind: 'LT_INBOUND', summary: l.summary as InboundLot }
      if (s && (s.kind === 'PACK' || 'box_no' in s)) return { kind: 'LT_PACK', summary: l.summary as PackBoxSummary }
      return { kind: 'UNKNOWN', summary: l.summary }
    case 'US':
      return { kind: 'US', summary: l.summary as UserSummary }
    default:
      return { kind: 'UNKNOWN', summary: l.summary }
  }
}

/** VIEW_DETAIL → 관리자 화면 경로 (screens-admin §0.1 URL 표) */
export function detailPathOf(v: LandingView, code: string): string {
  switch (v.kind) {
    case 'SO':
      return `/admin/so/${encodeURIComponent(code)}`
    case 'WO':
      return `/admin/wo/${encodeURIComponent(code)}`
    case 'LT_PACK':
      return '/admin/shipping'
    case 'LT_INBOUND':
      return '/admin/material/receipts'
    case 'US':
      return '/admin/master/users'
    default:
      return '/admin'
  }
}

/** S1 에서 동작하는 액션. 나머지는 disabled + 스프린트 태그 (키오스크·승인·출하는 S2~S4) */
export const ACTION_SPRINT: Record<AllowedAction, string | null> = {
  VIEW_DETAIL: null,
  REPRINT: '[S2]',
  HOLD: '[S4-7]',
  SPLIT: '[S3-3]',
  APPROVE_PENDING: '[S2-3]',
  QUARANTINE: '[S3-4]',
  SHIP: '[S3-7]',
}
export const isActionEnabledInS1 = (a: AllowedAction) => ACTION_SPRINT[a] === null

/** PDF 는 allowed_actions 값이 아니다 — 로그인 + SO/WO 이면 노출 (S1 「PDF」 동작 대상) */
export const hasPdf = (v: LandingView) => v.kind === 'SO' || v.kind === 'WO'

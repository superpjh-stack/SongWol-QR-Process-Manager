/**
 * 스캔 이벤트 공통 유틸 — KST 시각 문자열 · `event_uuid` 생성 · 결과 변형 판정 (api-contract §5.1
 * `scanned_at`/`event_uuid`, §3.3·§0.7 result 분기). 키오스크(`kiosk/kioskLogic.ts`)와
 * PDA(`pda/pdaLogic.ts`)가 함께 쓴다 — 원래 kioskLogic.ts 에만 있던 것을 여기로 옮기고 kioskLogic.ts 는
 * 재수출만 한다(기존 import 경로·테스트를 깨지 않는다).
 */
import type { ScanResponse } from './types'
import type { ScanResultVariant } from './ui/shopfloor'

/** 현재 시각을 `+09:00` 오프셋의 ISO 8601 로 (KST 는 DST 없음) */
export function nowKstIso(d: Date = new Date()): string {
  const shifted = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return shifted.toISOString().replace('Z', '+09:00')
}

/** event_uuid 생성 — `crypto.randomUUID` 없는 매우 구형 환경 대비 폴백 포함 */
export function newEventUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // RFC4122 v4 폴백 (테스트·구형 WebView 전용, 암호학적 강도는 필요 없다 — 멱등키 용도)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** api-contract §3.3 result × requires_approval → ScanResultCard variant (§0.7). 모든 액션(DONE·PACK·RECEIVE·SHIP)에 공통 */
export function scanResultVariant(res: Pick<ScanResponse, 'result' | 'requires_approval'>): ScanResultVariant {
  if (res.result === 'REJECT') return 'reject'
  if (res.result === 'WARN' && res.requires_approval) return 'approval'
  if (res.result === 'WARN') return 'warn'
  return 'ok'
}

/** OK·저장됨(saved) 만 2초 자동 닫힘, 그 외(WARN·승인·REJECT)는 탭까지 유지 (§0.7) */
export function autoDismissMsFor(variant: ScanResultVariant | 'saved'): number | undefined {
  return variant === 'ok' || variant === 'saved' ? 2000 : undefined
}

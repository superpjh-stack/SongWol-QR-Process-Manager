/**
 * ADM-16 이벤트 로그 탭의 행별 [취소](E6, admin #28) 표시 로직. 이미 취소(보상)된 이벤트는 다시 취소 버튼을
 * 보여주지 않는다 — CANCEL 이벤트의 `compensates_uuid` 가 원본 이벤트의 `event_uuid` 를 가리킨다.
 */
import type { ScanEventSummary } from '@/shared/types'

/** 현재 로드된 이벤트 목록에서 이미 취소(보상)된 원본 event_uuid 집합을 뽑는다 */
export function cancelledEventUuids(events: readonly Pick<ScanEventSummary, 'action' | 'compensates_uuid'>[]): Set<string> {
  return new Set(events.filter((e) => e.action === 'CANCEL' && e.compensates_uuid).map((e) => e.compensates_uuid as string))
}

/** 행에 [취소] 버튼을 보여줄지 — CANCEL 이벤트 자신은 다시 취소할 수 없고, 이미 보상된 이벤트도 제외한다 */
export function canCancelEvent(row: Pick<ScanEventSummary, 'event_uuid' | 'action'>, cancelledUuids: ReadonlySet<string>): boolean {
  return row.action !== 'CANCEL' && !cancelledUuids.has(row.event_uuid)
}

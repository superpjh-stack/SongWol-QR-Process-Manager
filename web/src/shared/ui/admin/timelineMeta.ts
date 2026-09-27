/**
 * WO 단계 타임라인 상태 판정 (순수 함수, 화면·테스트 공용).
 * - 현재 단계(STARTED)의 대기시간 = now − started_at. std_lead_hours 초과면 경고 (api-contract §6.5 (a))
 * - is_estimated → 「추정 완료」 + approved_by (DONE_ESTIMATED)
 * - 값·문구는 status.ts / StatusBadge 가 가진다. 여기서는 판정만
 */
import type { RouteStep, StepStatus } from '../../types'

export type StepTimelineMeta = {
  status: StepStatus
  /** 진행 중이고 표준 리드타임을 넘긴 경우 */
  overdue: boolean
  /** 진행 중(STARTED) 단계의 경과 시간 (시간, 소수 1자리). 아니면 null */
  elapsedHours: number | null
  /** 세로선·마커를 "지나간 단계" 로 그릴지 (DONE·DONE_ESTIMATED·SKIPPED) */
  passed: boolean
  /** 현재 단계(STARTED·PARTIAL) */
  current: boolean
}

export function stepTimelineMeta(step: Pick<RouteStep, 'status' | 'started_at' | 'std_lead_hours' | 'is_estimated'>, now: Date = new Date()): StepTimelineMeta {
  const status: StepStatus = step.is_estimated && step.status === 'DONE' ? 'DONE_ESTIMATED' : step.status
  const current = status === 'STARTED' || status === 'PARTIAL'
  let elapsedHours: number | null = null
  if (current && step.started_at) {
    const t = new Date(step.started_at).getTime()
    if (!Number.isNaN(t)) elapsedHours = Math.round(Math.max(0, now.getTime() - t) / 360_000) / 10
  }
  const overdue = elapsedHours !== null && step.std_lead_hours > 0 && elapsedHours > step.std_lead_hours
  const passed = status === 'DONE' || status === 'DONE_ESTIMATED' || status === 'SKIPPED'
  return { status, overdue, elapsedHours, passed, current }
}

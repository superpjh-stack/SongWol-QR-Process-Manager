/** Timeline 상태 매핑 — DONE_ESTIMATED 승격 · 표준 리드타임 초과 경고 · 현재/지나간 단계 */
import { describe, expect, it } from 'vitest'
import { stepTimelineMeta } from './timelineMeta'

const now = new Date('2026-10-02T09:00:00+09:00')

describe('stepTimelineMeta', () => {
  it('is_estimated + DONE → DONE_ESTIMATED, passed', () => {
    const m = stepTimelineMeta({ status: 'DONE', started_at: '2026-10-01T09:00:00+09:00', std_lead_hours: 8, is_estimated: true }, now)
    expect(m.status).toBe('DONE_ESTIMATED')
    expect(m.passed).toBe(true)
    expect(m.current).toBe(false)
    expect(m.overdue).toBe(false)
  })
  it('STARTED 이고 경과 > std_lead_hours 이면 overdue, elapsedHours 소수 1자리', () => {
    const m = stepTimelineMeta({ status: 'STARTED', started_at: '2026-10-01T20:30:00+09:00', std_lead_hours: 8, is_estimated: false }, now)
    expect(m.current).toBe(true)
    expect(m.elapsedHours).toBe(12.5)
    expect(m.overdue).toBe(true)
  })
  it('STARTED 이고 경과 ≤ std → overdue 아님', () => {
    const m = stepTimelineMeta({ status: 'STARTED', started_at: '2026-10-02T05:00:00+09:00', std_lead_hours: 8, is_estimated: false }, now)
    expect(m.elapsedHours).toBe(4)
    expect(m.overdue).toBe(false)
  })
  it('WAITING·SKIPPED — 경과 없음, SKIPPED 는 passed', () => {
    expect(stepTimelineMeta({ status: 'WAITING', started_at: null, std_lead_hours: 8, is_estimated: false }, now)).toMatchObject({ status: 'WAITING', elapsedHours: null, overdue: false, passed: false, current: false })
    expect(stepTimelineMeta({ status: 'SKIPPED', started_at: null, std_lead_hours: 0, is_estimated: false }, now).passed).toBe(true)
  })
  it('PARTIAL 은 현재 단계로 본다', () => {
    const m = stepTimelineMeta({ status: 'PARTIAL', started_at: '2026-10-02T08:00:00+09:00', std_lead_hours: 0, is_estimated: false }, now)
    expect(m.current).toBe(true)
    expect(m.overdue).toBe(false) // std 0 이면 경고 없음
  })
})

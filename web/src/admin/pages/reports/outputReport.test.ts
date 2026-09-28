import { describe, expect, it } from 'vitest'
import { badRate, thisWeekMonday } from './outputReport'

describe('badRate', () => {
  it('양품+불량 합계 대비 불량 비율을 백분율로 계산한다', () => {
    expect(badRate({ qty_good: 90, qty_bad: 10 })).toBe(10)
  })
  it('불량이 0이면 0%', () => {
    expect(badRate({ qty_good: 100, qty_bad: 0 })).toBe(0)
  })
  it('합계가 0이면 계산 불가(null)', () => {
    expect(badRate({ qty_good: 0, qty_bad: 0 })).toBeNull()
  })
})

describe('thisWeekMonday', () => {
  it('수요일 기준 이번 주 월요일을 돌려준다', () => {
    // 2026-09-30 은 수요일
    expect(thisWeekMonday(new Date('2026-09-30T09:00:00'))).toBe('2026-09-28')
  })
  it('월요일 자신을 넣으면 그대로 돌려준다', () => {
    expect(thisWeekMonday(new Date('2026-09-28T09:00:00'))).toBe('2026-09-28')
  })
  it('일요일이면 전주 월요일을 돌려준다', () => {
    expect(thisWeekMonday(new Date('2026-10-04T09:00:00'))).toBe('2026-09-28')
  })
})

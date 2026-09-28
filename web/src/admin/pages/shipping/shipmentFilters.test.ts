import { describe, expect, it } from 'vitest'
import { shipmentDateParams } from './shipmentFilters'

describe('shipmentDateParams', () => {
  it('from/to 가 있으면 기간 필터만 보낸다 (date 는 뺀다)', () => {
    expect(shipmentDateParams('2026-09-28', '2026-09-01', '2026-09-30')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
  })
  it('from 만 있어도 기간 모드로 본다', () => {
    expect(shipmentDateParams('2026-09-28', '2026-09-01', '')).toEqual({ from: '2026-09-01', to: undefined })
  })
  it('to 만 있어도 기간 모드로 본다', () => {
    expect(shipmentDateParams('2026-09-28', '', '2026-09-30')).toEqual({ from: undefined, to: '2026-09-30' })
  })
  it('from/to 가 없으면 date 를 쓴다', () => {
    expect(shipmentDateParams('2026-09-28', '', '')).toEqual({ date: '2026-09-28' })
  })
  it('아무 것도 없으면 date 도 undefined (호출부가 오늘 기본값을 채운다)', () => {
    expect(shipmentDateParams('', '', '')).toEqual({ date: undefined })
  })
})

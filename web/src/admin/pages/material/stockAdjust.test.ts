import { describe, expect, it } from 'vitest'
import { previewStock } from './stockAdjust'

describe('previewStock', () => {
  it('현재고 + delta (양수)', () => {
    expect(previewStock(100, 20)).toBe(120)
  })
  it('현재고 + delta (음수)', () => {
    expect(previewStock(100, -30)).toBe(70)
  })
  it('현재고를 아직 모르면 null', () => {
    expect(previewStock(null, 10)).toBeNull()
    expect(previewStock(undefined, 10)).toBeNull()
  })
  it('delta 를 아직 입력하지 않았으면 null', () => {
    expect(previewStock(100, null)).toBeNull()
    expect(previewStock(100, undefined)).toBeNull()
    expect(previewStock(100, NaN)).toBeNull()
  })
})

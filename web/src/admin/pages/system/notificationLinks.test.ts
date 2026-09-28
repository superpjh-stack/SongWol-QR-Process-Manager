import { describe, expect, it } from 'vitest'
import { targetLink } from './notificationLinks'

describe('targetLink', () => {
  it('SO 코드는 수주 상세로 링크한다', () => {
    expect(targetLink('SO-2601-0001')).toBe('/admin/so/SO-2601-0001')
  })
  it('WO 코드는 작업지시 상세로 링크한다', () => {
    expect(targetLink('WO-2601-0001-A1')).toBe('/admin/wo/WO-2601-0001-A1')
  })
  it('그 외 접두사(LT·US·VB)는 링크가 없다', () => {
    expect(targetLink('LT-2601-0001')).toBeNull()
  })
  it('target_code 가 없으면 null', () => {
    expect(targetLink(null)).toBeNull()
    expect(targetLink('')).toBeNull()
  })
})

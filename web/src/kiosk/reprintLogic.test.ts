/** reprintLogic — KSK-70 순수 로직 */
import { describe, expect, it } from 'vitest'
import { buildWoLabelReprintRequest, shouldSearch } from './reprintLogic'

describe('shouldSearch', () => {
  it('2자 미만이면 false', () => {
    expect(shouldSearch('')).toBe(false)
    expect(shouldSearch('가')).toBe(false)
    expect(shouldSearch(' 가 ')).toBe(false) // 공백 트림 후 판정
  })
  it('2자 이상이면 true', () => {
    expect(shouldSearch('대한')).toBe(true)
    expect(shouldSearch('WO-260929')).toBe(true)
  })
})

describe('buildWoLabelReprintRequest', () => {
  it('WO_LABEL·copies 1 로 고정한다 (PDF 재발행 경로와 분리, §5 ⑫)', () => {
    const req = buildWoLabelReprintRequest({ code: 'WO-260929-00001' }, 'PRT-01')
    expect(req).toEqual({ target: 'WO-260929-00001', label_type: 'WO_LABEL', printer: 'PRT-01', copies: 1 })
  })
})

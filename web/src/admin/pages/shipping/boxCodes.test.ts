import { describe, expect, it } from 'vitest'
import { addBoxCode, removeBoxCode } from './boxCodes'

describe('addBoxCode', () => {
  it('trim + 대문자로 정규화한다', () => {
    expect(addBoxCode([], ' lt-261001-0001 ')).toEqual(['LT-261001-0001'])
  })
  it('중복은 추가하지 않는다', () => {
    expect(addBoxCode(['LT-261001-0001'], 'lt-261001-0001')).toEqual(['LT-261001-0001'])
  })
  it('빈 문자열은 무시한다', () => {
    expect(addBoxCode(['LT-261001-0001'], '   ')).toEqual(['LT-261001-0001'])
  })
  it('새 코드는 뒤에 추가한다', () => {
    expect(addBoxCode(['LT-261001-0001'], 'LT-261001-0002')).toEqual(['LT-261001-0001', 'LT-261001-0002'])
  })
})

describe('removeBoxCode', () => {
  it('지정한 코드만 제거한다', () => {
    expect(removeBoxCode(['LT-1', 'LT-2', 'LT-3'], 'LT-2')).toEqual(['LT-1', 'LT-3'])
  })
  it('없는 코드는 그대로 둔다', () => {
    const list = ['LT-1']
    expect(removeBoxCode(list, 'LT-9')).toEqual(list)
  })
})

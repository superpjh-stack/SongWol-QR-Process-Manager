/** ReasonInput — isReasonComplete: required(KSK-31)/optional(KSK-60 note) 검증, OTHER 는 텍스트 필수 */
import { describe, expect, it } from 'vitest'
import { isReasonComplete } from './ReasonInput'

describe('isReasonComplete', () => {
  it('optional 모드는 사유가 없어도 항상 완료로 본다 (KSK-60 note)', () => {
    expect(isReasonComplete('optional', { code: null, text: '' })).toBe(true)
    expect(isReasonComplete('optional', { code: 'OTHER', text: '' })).toBe(true)
  })

  it('required 모드는 사유를 고르지 않으면 미완료 (KSK-31)', () => {
    expect(isReasonComplete('required', { code: null, text: '' })).toBe(false)
  })

  it('required 모드에서 프리셋(OTHER 아님)을 고르면 텍스트 없이도 완료', () => {
    expect(isReasonComplete('required', { code: 'SHORT_INPUT', text: '' })).toBe(true)
    expect(isReasonComplete('required', { code: 'MISCOUNT', text: '' })).toBe(true)
    expect(isReasonComplete('required', { code: 'DEFECT_EXTRA', text: '' })).toBe(true)
    expect(isReasonComplete('required', { code: 'SPLIT_MOVED', text: '' })).toBe(true)
  })

  it('required 모드에서 OTHER 는 자유 입력 텍스트가 있어야 완료 (공백만은 미완료)', () => {
    expect(isReasonComplete('required', { code: 'OTHER', text: '' })).toBe(false)
    expect(isReasonComplete('required', { code: 'OTHER', text: '   ' })).toBe(false)
    expect(isReasonComplete('required', { code: 'OTHER', text: '재단 손실 20장' })).toBe(true)
  })
})

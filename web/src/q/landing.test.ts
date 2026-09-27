/** QRL-01 summary 판별 · 액션 → 링크 · S1 동작 액션 */
import { describe, expect, it } from 'vitest'
import type { QrLanding } from '@/shared/types'
import { ACTION_SPRINT, classifyLanding, detailPathOf, hasPdf, isActionEnabledInS1 } from './landing'

describe('landing', () => {
  it('type + LT kind 로 5가지 뷰를 가른다', () => {
    expect(classifyLanding({ type: 'SO', summary: { code: 'SO-261001-0001' } as QrLanding['summary'] }).kind).toBe('SO')
    expect(classifyLanding({ type: 'WO', summary: {} as QrLanding['summary'] }).kind).toBe('WO')
    expect(classifyLanding({ type: 'LT', summary: { kind: 'PACK', box_no: 1 } as QrLanding['summary'] }).kind).toBe('LT_PACK')
    expect(classifyLanding({ type: 'LT', summary: { kind: 'INBOUND' } as QrLanding['summary'] }).kind).toBe('LT_INBOUND')
    expect(classifyLanding({ type: 'US', summary: { role: 'WORKER' } as QrLanding['summary'] }).kind).toBe('US')
    expect(classifyLanding({ type: 'VB', summary: {} as QrLanding['summary'] }).kind).toBe('UNKNOWN')
  })
  it('VIEW_DETAIL 링크는 screens-admin §0.1 URL 표', () => {
    expect(detailPathOf(classifyLanding({ type: 'SO', summary: {} as QrLanding['summary'] }), 'SO-261001-0001')).toBe('/admin/so/SO-261001-0001')
    expect(detailPathOf(classifyLanding({ type: 'WO', summary: {} as QrLanding['summary'] }), 'WO-261001-0012-A')).toBe('/admin/wo/WO-261001-0012-A')
    expect(detailPathOf(classifyLanding({ type: 'LT', summary: { kind: 'INBOUND' } as QrLanding['summary'] }), 'LT-1')).toBe('/admin/material/receipts')
  })
  it('S1 은 VIEW_DETAIL 만 동작, 나머지는 스프린트 태그. PDF 는 SO/WO 만', () => {
    expect(isActionEnabledInS1('VIEW_DETAIL')).toBe(true)
    for (const a of ['REPRINT', 'HOLD', 'SPLIT', 'APPROVE_PENDING', 'QUARANTINE', 'SHIP'] as const) {
      expect(isActionEnabledInS1(a)).toBe(false)
      expect(ACTION_SPRINT[a]).toMatch(/^\[S\d/)
    }
    expect(hasPdf(classifyLanding({ type: 'WO', summary: {} as QrLanding['summary'] }))).toBe(true)
    expect(hasPdf(classifyLanding({ type: 'US', summary: {} as QrLanding['summary'] }))).toBe(false)
  })
})

/** ADM-14 WO 제안 초안 조정 — 분리만 허용(admin #26), 합계 유지, 라인 qty 대조 */
import { describe, expect, it } from 'vitest'
import type { WoDraft } from '@/shared/types'
import { draftQtyMismatch, mergeDraftsOfLine, splitDraft } from './woProposal'

const d = (so_line_id: number, qty: number): WoDraft => ({ so_line_id, item_id: 10, print_method: 'SCREEN', qty, routing_id: 3, steps: [{ seq: 1, process_code: 'P30', std_lead_hours: 8 }] })

describe('woProposal', () => {
  it('splitDraft: 한 행을 두 행으로, 합계 유지, steps 복사', () => {
    const out = splitDraft([d(1, 500), d(2, 100)], 0, 200)
    expect(out.map((x) => x.qty)).toEqual([200, 300, 100])
    expect(out[0]!.steps).not.toBe(out[1]!.steps)
    expect(draftQtyMismatch(out, [{ id: 1, qty: 500 }, { id: 2, qty: 100 }])).toEqual([])
  })
  it('splitDraft: 범위 밖(0, ≥qty, 소수) 은 무시', () => {
    const src = [d(1, 500)]
    expect(splitDraft(src, 0, 0)).toBe(src)
    expect(splitDraft(src, 0, 500)).toBe(src)
    expect(splitDraft(src, 0, 12.5)).toBe(src)
    expect(splitDraft(src, 5, 1)).toBe(src)
  })
  it('mergeDraftsOfLine: 같은 라인만 합친다, 다른 라인은 그대로', () => {
    const out = mergeDraftsOfLine([d(1, 200), d(2, 100), d(1, 300)], 1)
    expect(out.map((x) => [x.so_line_id, x.qty])).toEqual([[1, 500], [2, 100]])
  })
  it('draftQtyMismatch: 합이 다른 라인·없는 라인을 보고', () => {
    expect(draftQtyMismatch([d(1, 200), d(1, 200), d(3, 5)], [{ id: 1, qty: 500 }, { id: 2, qty: 100 }])).toEqual([1, 3])
  })
})

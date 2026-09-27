/** ADM-14 WO 제안 초안 조정 — 분리만 허용 (api-contract §13.4 admin #26). 순수 함수, 테스트 대상 */
import type { SalesOrderLine, WoDraft } from '@/shared/types'

/** 초안 한 행을 qty1 + (qty − qty1) 두 행으로 나눈다. 합계 유지. 범위 밖이면 그대로 */
export function splitDraft(drafts: WoDraft[], index: number, qty1: number): WoDraft[] {
  const d = drafts[index]
  if (!d || !Number.isInteger(qty1) || qty1 < 1 || qty1 >= d.qty) return drafts
  const a: WoDraft = { ...d, qty: qty1, steps: d.steps.map((s) => ({ ...s })) }
  const b: WoDraft = { ...d, qty: d.qty - qty1, steps: d.steps.map((s) => ({ ...s })) }
  return [...drafts.slice(0, index), a, b, ...drafts.slice(index + 1)]
}

/** 같은 라인의 초안을 다시 하나로 합친다 (분리 취소). 라인 간 병합은 불가 */
export function mergeDraftsOfLine(drafts: WoDraft[], soLineId: number): WoDraft[] {
  const mine = drafts.filter((d) => d.so_line_id === soLineId)
  if (mine.length <= 1) return drafts
  const first = mine[0]!
  const merged: WoDraft = { ...first, qty: mine.reduce((s, d) => s + d.qty, 0) }
  let placed = false
  const out: WoDraft[] = []
  for (const d of drafts) {
    if (d.so_line_id !== soLineId) out.push(d)
    else if (!placed) {
      out.push(merged)
      placed = true
    }
  }
  return out
}

/** 라인 qty 와 초안 qty 합 대조 (issue-wo 전 클라이언트 검사, 서버는 422). 불일치 라인 id 목록 */
export function draftQtyMismatch(drafts: WoDraft[], lines: Pick<SalesOrderLine, 'id' | 'qty'>[]): number[] {
  const sums = new Map<number, number>()
  for (const d of drafts) sums.set(d.so_line_id, (sums.get(d.so_line_id) ?? 0) + d.qty)
  const out: number[] = []
  for (const [lineId, sum] of sums) {
    const line = lines.find((l) => l.id === lineId)
    if (!line || line.qty !== sum) out.push(lineId)
  }
  return out
}

/** ADM-20 재고 조정 미리보기 — 「조정 후 재고 = 현재고 + delta 미리보기」(screens-admin ADM-20 검증 표) */
export function previewStock(current: number | null | undefined, delta: number | null | undefined): number | null {
  if (current === null || current === undefined) return null
  if (delta === null || delta === undefined || Number.isNaN(delta)) return null
  return current + delta
}

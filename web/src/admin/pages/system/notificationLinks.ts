/**
 * ADM-29 알림 이력의 대상(target_code) → 화면 링크. SO/WO 접두사는 코드 체계상 고정(admin #21)이라
 * target_code 의 접두사만으로 안전하게 구분할 수 있다 (spec §2.1). 링크가 없는 유형(LT·US·VB)은 null.
 */
export function targetLink(targetCode: string | null): string | null {
  if (!targetCode) return null
  if (/^SO/i.test(targetCode)) return `/admin/so/${encodeURIComponent(targetCode)}`
  if (/^WO/i.test(targetCode)) return `/admin/wo/${encodeURIComponent(targetCode)}`
  return null
}

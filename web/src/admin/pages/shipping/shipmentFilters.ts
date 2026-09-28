/**
 * ADM-22 출하 목록 날짜 필터 — 「date(오늘 기본) 또는 from/to」(screens-admin ADM-22). 서버에 둘 다 보내지 않는다:
 * from/to 중 하나라도 있으면 기간 필터를, 없으면 date(기본 오늘)를 쓴다.
 */
export function shipmentDateParams(date: string, from: string, to: string): { date?: string; from?: string; to?: string } {
  if (from || to) {
    const out: { from?: string; to?: string } = {}
    if (from) out.from = from
    if (to) out.to = to
    return out
  }
  return date ? { date } : {}
}

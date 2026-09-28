/** ADM-25 실적 집계 순수 로직 — 불량률 계산 · 기본 기간(이번 주) 산정. 화면(OutputReportPage.tsx)에서 분리해 단위 테스트한다. */
import type { OutputReportRow } from '@/shared/types'

/** 불량률 = bad/(good+bad) · 백분율. 합계가 0 이면 계산 불가(null) — screens-admin ADM-25 「불량률 클라이언트 계산」 */
export function badRate(row: Pick<OutputReportRow, 'qty_good' | 'qty_bad'>): number | null {
  const total = row.qty_good + row.qty_bad
  return total > 0 ? (row.qty_bad / total) * 100 : null
}

/** 이번 주 월요일 (YYYY-MM-DD, 로컬 기준). 「기본 이번 주」— from/to 기본값(spec 정의 없음, §3 #). */
export function thisWeekMonday(now = new Date()): string {
  const day = now.getDay() // 0=Sun..6=Sat
  const diff = day === 0 ? 6 : day - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - diff)
  return monday.toISOString().slice(0, 10)
}

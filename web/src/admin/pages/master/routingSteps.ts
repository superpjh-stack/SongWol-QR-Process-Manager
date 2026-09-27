/** ADM-06 라우팅 단계 편집 — 행 모델·기본 단계·검증 (순수 함수) */
import type { PrintMethod, PrintMethodCode, Routing, RoutingStepInput } from '@/shared/types'

export type StepRow = { key: number; process_code: string; std_lead_hours: string; tolerance_pct: string }

let keySeq = 1
export const newRow = (process_code = ''): StepRow => ({ key: keySeq++, process_code, std_lead_hours: '', tolerance_pct: '' })
export const rowsFrom = (steps: RoutingStepInput[]): StepRow[] =>
  steps.map((s) => ({ key: keySeq++, process_code: s.process_code, std_lead_hours: String(s.std_lead_hours), tolerance_pct: s.tolerance_pct === null ? '' : String(s.tolerance_pct) }))

/** spec §4.2 기본 순서 P20→P30→P50→P60. 무가공(skips_p30) 은 P30 제외. 리드타임은 비워 둔다([확인] 제안값은 넣지 않는다) */
export function defaultRows(pm: PrintMethod | undefined): StepRow[] {
  const codes = ['P20', 'P30', 'P50', 'P60'].filter((c) => !(pm?.skips_p30 && c === 'P30'))
  return codes.map((c) => newRow(c))
}

export type StepErrors = Record<number, { process_code?: string; std_lead_hours?: string; tolerance_pct?: string }>

export function validateRows(rows: StepRow[]): { errors: StepErrors; steps: RoutingStepInput[]; ok: boolean } {
  const errors: StepErrors = {}
  const seen = new Set<string>()
  const steps: RoutingStepInput[] = []
  rows.forEach((r, i) => {
    const e: StepErrors[number] = {}
    if (!r.process_code) e.process_code = '공정을 선택하세요'
    else if (seen.has(r.process_code)) e.process_code = '같은 공정은 한 번만 (UK routing_id, process_code)'
    seen.add(r.process_code)
    const lead = Number(r.std_lead_hours)
    if (r.std_lead_hours.trim() === '' || Number.isNaN(lead)) e.std_lead_hours = '표준 리드타임(h)을 입력하세요'
    else if (lead < 0) e.std_lead_hours = '0 이상'
    else if (Math.round(lead * 10) !== lead * 10) e.std_lead_hours = '소수 1자리까지'
    let tol: number | null = null
    if (r.tolerance_pct.trim() !== '') {
      tol = Number(r.tolerance_pct)
      if (Number.isNaN(tol)) e.tolerance_pct = '숫자'
      else if (tol < 0) e.tolerance_pct = '0 이상'
      else if (Math.round(tol * 10) !== tol * 10) e.tolerance_pct = '소수 1자리까지'
    }
    if (Object.keys(e).length) errors[r.key] = e
    steps.push({ seq: (i + 1) * 10, process_code: r.process_code, std_lead_hours: lead, tolerance_pct: tol })
  })
  return { errors, steps, ok: Object.keys(errors).length === 0 && rows.length > 0 }
}


export const stepsText = (r: Routing) => [...r.steps].sort((a, b) => a.seq - b.seq).map((s) => s.process_code).join(' → ')
export const leadSum = (r: Routing) => r.steps.reduce((acc, s) => acc + Number(s.std_lead_hours), 0)
export type { PrintMethodCode }

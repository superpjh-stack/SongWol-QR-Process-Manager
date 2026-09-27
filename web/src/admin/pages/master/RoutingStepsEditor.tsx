/** ADM-06 라우팅 단계 편집 표 — 행 추가/삭제/위아래, seq 자동(10·20·30…), 같은 공정 2번 불가(클라이언트 선검사) */
import { useMemo } from 'react'
import { Button, NumberInput, Select } from '@/shared/ui/admin'
import type { Process } from '@/shared/types'
import { newRow, type StepErrors, type StepRow } from './routingSteps'

export function RoutingStepsEditor({
  rows,
  onChange,
  processes,
  errors,
  disabled,
  onFillDefault,
}: {
  rows: StepRow[]
  onChange: (rows: StepRow[]) => void
  processes: Process[]
  errors: StepErrors
  disabled?: boolean
  onFillDefault?: () => void
}) {
  const options = useMemo(() => processes.filter((p) => p.active).sort((a, b) => a.seq - b.seq).map((p) => ({ value: p.code, label: `${p.code} ${p.name}` })), [processes])
  const set = (i: number, patch: Partial<StepRow>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= rows.length) return
    const next = [...rows]
    const t = next[i]!
    next[i] = next[j]!
    next[j] = t
    onChange(next)
  }
  return (
    <div className="rounded-ad border border-line bg-surface">
      <table className="w-full text-ad-body">
        <thead className="bg-surface-2 text-ad-xs font-semibold text-ink-muted">
          <tr>
            <th className="px-3 py-2 text-left">seq</th>
            <th className="px-3 py-2 text-left">공정 *</th>
            <th className="px-3 py-2 text-left">표준 리드타임(h) *</th>
            <th className="px-3 py-2 text-left">허용오차(%)</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-ink-muted">
                단계가 없습니다 — [행 추가] 또는 [기본 단계 채우기]
              </td>
            </tr>
          ) : null}
          {rows.map((r, i) => {
            const e = errors[r.key] ?? {}
            return (
              <tr key={r.key} className="border-t border-line align-top">
                <td className="px-3 py-2 tabular-nums text-ink-muted">{(i + 1) * 10}</td>
                <td className="px-3 py-2">
                  <Select aria-label="공정" options={options} placeholder="선택" value={r.process_code} disabled={disabled} error={e.process_code} onChange={(ev) => set(i, { process_code: ev.target.value })} wrapperClassName="w-48" />
                </td>
                <td className="px-3 py-2">
                  <NumberInput aria-label="표준 리드타임" unit="h" min={0} step={0.1} value={r.std_lead_hours} disabled={disabled} error={e.std_lead_hours} onChange={(ev) => set(i, { std_lead_hours: ev.target.value })} wrapperClassName="w-40" />
                </td>
                <td className="px-3 py-2">
                  <NumberInput aria-label="허용오차" unit="%" min={0} step={0.1} value={r.tolerance_pct} disabled={disabled} placeholder="품목 값" error={e.tolerance_pct} onChange={(ev) => set(i, { tolerance_pct: ev.target.value })} wrapperClassName="w-40" />
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label="위로">
                      ↑
                    </Button>
                    <Button size="sm" variant="ghost" disabled={disabled || i === rows.length - 1} onClick={() => move(i, 1)} aria-label="아래로">
                      ↓
                    </Button>
                    <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(rows.filter((_, idx) => idx !== i))}>
                      삭제
                    </Button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="flex gap-2 border-t border-line px-3 py-2">
        <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onChange([...rows, newRow()])}>
          행 추가
        </Button>
        {onFillDefault ? (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={onFillDefault}>
            기본 단계 채우기
          </Button>
        ) : null}
        <span className="ml-auto self-center text-ad-xs text-ink-muted">허용오차 빈칸 = 품목 qty_tolerance_pct 사용 (db §2.8)</span>
      </div>
    </div>
  )
}

/**
 * WO 단계 타임라인 (screens-admin §2 #4, ADM-16 탭 1). 세로 배치.
 * 행: 순서·공정 · StepStatus 배지(추정 완료 + 승인자) · 시각(started_at → done_at) · 수량(qty_in → 양품/불량, variance_reason)
 *     · 표준·허용(std_lead_hours · tolerance_pct, 초과 경고) · 설비·작업자 · works[] 펼침 (설비 작업, 파일럿 1행)
 * 색·문구는 StatusBadge/TONE_CLASS 만 쓴다.
 */
import { useState } from 'react'
import { cn } from '../cn'
import { IconWarning } from '../icons'
import { StatusBadge } from '../StatusBadge'
import { STEP_STATUS, TONE_CLASS } from '../status'
import type { RouteStep, StepWork } from '../../types'
import { stepTimelineMeta } from './timelineMeta'

export type TimelineProps = {
  steps: RouteStep[]
  /** 시각·수량 표기 함수 (관리자 format.ts 를 넘긴다) */
  formatDateTime: (iso: string | null | undefined) => string
  formatQty: (n: number | null | undefined) => string
  now?: Date | undefined
  className?: string | undefined
  emptyText?: string | undefined
}

function Works({ works, formatDateTime, formatQty }: { works: StepWork[]; formatDateTime: TimelineProps['formatDateTime']; formatQty: TimelineProps['formatQty'] }) {
  const [open, setOpen] = useState(false)
  if (works.length === 0) return null
  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-ad-xs font-medium text-brand-700 hover:underline">
        설비 작업 {works.length}건 {open ? '접기' : '펼치기'}
      </button>
      {open ? (
        <table className="mt-1 w-full border-collapse text-ad-xs">
          <thead className="text-ink-muted">
            <tr>
              <th className="px-2 py-1 text-left font-semibold">#</th>
              <th className="px-2 py-1 text-left font-semibold">설비</th>
              <th className="px-2 py-1 text-left font-semibold">작업자</th>
              <th className="px-2 py-1 text-left font-semibold">착수</th>
              <th className="px-2 py-1 text-left font-semibold">완료</th>
              <th className="px-2 py-1 text-right font-semibold">양품</th>
              <th className="px-2 py-1 text-right font-semibold">불량</th>
            </tr>
          </thead>
          <tbody>
            {works.map((w) => (
              <tr key={w.id} className="border-t border-line">
                <td className="px-2 py-1 tabular-nums">{w.seq}</td>
                <td className="px-2 py-1">
                  <span className="font-mono">{w.equipment.code}</span> {w.equipment.name ?? ''}
                </td>
                <td className="px-2 py-1">{w.worker.name}</td>
                <td className="px-2 py-1 tabular-nums">{formatDateTime(w.started_at)}</td>
                <td className="px-2 py-1 tabular-nums">{formatDateTime(w.done_at)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{formatQty(w.qty_good)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{formatQty(w.qty_bad)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}

export function Timeline({ steps, formatDateTime, formatQty, now, className, emptyText = '라우팅 단계가 없습니다' }: TimelineProps) {
  if (steps.length === 0) return <p className="py-6 text-center text-ink-muted">{emptyText}</p>
  const sorted = [...steps].sort((a, b) => a.seq - b.seq)
  return (
    <ol className={cn('relative ml-3 border-l-2 border-line', className)} data-component="Timeline">
      {sorted.map((s) => {
        const m = stepTimelineMeta(s, now)
        const tone = STEP_STATUS[m.status].tone
        return (
          <li key={s.id} className="relative pb-6 pl-6 last:pb-0" data-step-status={m.status} data-overdue={m.overdue || undefined}>
            <span
              aria-hidden="true"
              className={cn('absolute -left-[9px] top-1 flex h-4 w-4 items-center justify-center rounded-full border-2', TONE_CLASS[tone], m.current && 'ring-4 ring-brand-100')}
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-ad-xs font-semibold tabular-nums text-ink-muted">{s.seq}</span>
              <span className="font-mono">{s.process_code}</span>
              <span className="font-semibold">{s.process_name}</span>
              <StatusBadge kind="step" status={m.status} />
              {m.status === 'DONE_ESTIMATED' && s.approved_by ? <span className="text-ad-xs text-ink-muted">승인 {s.approved_by.name}</span> : null}
              {m.overdue ? (
                <span className={cn('inline-flex h-6 items-center gap-1 rounded-full border px-2 text-ad-xs font-semibold', TONE_CLASS.warn)}>
                  <IconWarning size={14} /> 표준 리드타임 초과 ({m.elapsedHours}h / {s.std_lead_hours}h)
                </span>
              ) : null}
            </div>
            <dl className="mt-1 grid grid-cols-1 gap-x-6 gap-y-1 text-ad-xs text-ink-muted sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="inline font-semibold">시각 </dt>
                <dd className="inline tabular-nums">
                  {formatDateTime(s.started_at)} → {formatDateTime(s.done_at)}
                </dd>
              </div>
              <div>
                <dt className="inline font-semibold">수량 </dt>
                <dd className="inline tabular-nums">
                  {formatQty(s.qty_in)} → 양품 {formatQty(s.qty_good)} / 불량 {formatQty(s.qty_bad)}
                  {s.variance_reason ? <span className="ml-1 text-status-warn-fg">({s.variance_reason})</span> : null}
                </dd>
              </div>
              <div>
                <dt className="inline font-semibold">표준·허용 </dt>
                <dd className="inline tabular-nums">
                  {s.std_lead_hours}h · ±{s.tolerance_pct}%{m.elapsedHours !== null && !m.overdue ? ` · 경과 ${m.elapsedHours}h` : ''}
                </dd>
              </div>
              <div>
                <dt className="inline font-semibold">설비·작업자 </dt>
                <dd className="inline">
                  {s.equipment ? (
                    <>
                      <span className="font-mono">{s.equipment.code}</span> {s.equipment.name ?? ''}
                    </>
                  ) : (
                    '—'
                  )}
                  {' · '}
                  {s.worker?.name ?? '—'}
                </dd>
              </div>
            </dl>
            <Works works={s.works} formatDateTime={formatDateTime} formatQty={formatQty} />
          </li>
        )
      })}
    </ol>
  )
}

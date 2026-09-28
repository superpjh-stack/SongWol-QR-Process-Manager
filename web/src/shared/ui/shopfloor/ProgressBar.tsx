/**
 * 현황판 진행 바 (BRD-01 SO 진행 현황판, screens-shopfloor §3·§4.2 A9).
 * admin/ProgressBar 는 관리자 밀도(`text-ad-xs`, 얇은 바)라 3m 거리에서 읽을 수 없다 — 이 컴포넌트는
 * 그 admin 버전과 별개로 현황판 전용 크기 토큰(`text-tv-*`, design-tokens.md §3 TV)을 쓴다.
 * `progress_pct` 100 은 done(초록 체크), 그 외는 progress(파랑) — screens-shopfloor §3 색 규칙.
 * `displayText` 를 주면 퍼센트 대신 문구를 보여준다(예: `status=PARTIAL_SHIPPED` → 「부분 발송」) —
 * 바 채움 자체는 항상 `value` 를 따른다. 애니메이션은 ≤300ms(spec §13·§15 갱신 게이트).
 */
import { cn } from '../cn'
import { IconCheck } from '../icons'

export type ProgressBarProps = {
  /** 0~100. null/undefined/NaN 은 0 으로 그린다 */
  value: number | null | undefined
  /** 퍼센트 텍스트 대신 보여줄 문구 (예: 「부분 발송」). 바 색은 여전히 value 기준 */
  displayText?: string | undefined
  /** aria-label. 기본 "진행률" */
  label?: string | undefined
  className?: string | undefined
}

export function ProgressBar({ value, displayText, label, className }: ProgressBarProps) {
  const v = value === null || value === undefined || Number.isNaN(value) ? 0 : Math.min(100, Math.max(0, value))
  const done = v >= 100
  return (
    <div className={cn('flex items-center gap-3', className)} data-component="ProgressBar">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v}
        aria-label={label ?? '진행률'}
        className="relative h-8 min-w-24 flex-1 overflow-hidden rounded-full bg-surface-3"
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-300 ease-out', done ? 'bg-status-done-fg' : 'bg-brand-600')}
          style={{ width: `${v}%` }}
        />
      </div>
      <span className={cn('flex shrink-0 items-center gap-1 text-tv-body font-bold tabular-nums', done ? 'text-status-done-fg' : 'text-ink')}>
        {done ? <IconCheck size={28} className="shrink-0" aria-hidden="true" /> : null}
        {displayText ?? `${Math.round(v)}%`}
      </span>
    </div>
  )
}

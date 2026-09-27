/** 진행률 바 (screens-admin §2 #13). 값 0~100, 소수 1자리 + % 병기 (§0.5). 100 은 done, 그 외 progress 톤 */
import { cn } from '../cn'

export type ProgressBarProps = { value: number | null | undefined; label?: string | undefined; className?: string | undefined; showText?: boolean | undefined; size?: 'sm' | 'md' | undefined }

export function ProgressBar({ value, label, className, showText = true, size = 'sm' }: ProgressBarProps) {
  const v = value === null || value === undefined || Number.isNaN(value) ? 0 : Math.min(100, Math.max(0, value))
  const done = v >= 100
  return (
    <div className={cn('flex items-center gap-2', className)} data-component="ProgressBar">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v}
        aria-label={label ?? '진행률'}
        className={cn('relative min-w-16 flex-1 overflow-hidden rounded-full bg-surface-3', size === 'md' ? 'h-3' : 'h-2')}
      >
        <div className={cn('h-full rounded-full', done ? 'bg-status-done-fg' : 'bg-brand-600')} style={{ width: `${v}%` }} />
      </div>
      {showText ? <span className="w-12 shrink-0 text-right text-ad-xs tabular-nums text-ink-muted">{v.toFixed(1)}%</span> : null}
    </div>
  )
}

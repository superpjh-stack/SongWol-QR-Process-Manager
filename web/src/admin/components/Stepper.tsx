/** 단계 표시 (screens-admin §2 #5, ADM-11 5단계). 지난 단계는 클릭으로 되돌아갈 수 있다 */
import { cn } from '@/shared/ui'

export function Stepper({ steps, current, onSelect }: { steps: string[]; current: number; onSelect?: (index: number) => void }) {
  return (
    <ol className="mb-5 flex flex-wrap items-center gap-2" aria-label="진행 단계">
      {steps.map((s, i) => {
        const done = i < current
        const active = i === current
        const clickable = done && onSelect
        return (
          <li key={s} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!clickable}
              onClick={clickable ? () => onSelect(i) : undefined}
              aria-current={active ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1 text-ad-xs font-semibold',
                active && 'border-brand-600 bg-brand-600 text-white',
                done && 'border-status-done-line bg-status-done-bg text-status-done-fg hover:brightness-95',
                !active && !done && 'border-line bg-surface text-ink-muted',
                !clickable && 'cursor-default',
              )}
            >
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/30 tabular-nums">{i + 1}</span>
              {s}
            </button>
            {i < steps.length - 1 ? <span className="text-ink-faint">›</span> : null}
          </li>
        )
      })}
    </ol>
  )
}

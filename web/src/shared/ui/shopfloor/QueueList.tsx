/**
 * 공정 대기 WO 목록 (spec §9.2 대기 화면 · B5-02). 납기순 정렬, 지연 강조, 상위 N건(기본 8).
 * 데이터는 화면이 `GET /stations/{id}/queue` 로 받아 넘긴다. 정렬만 여기서 한다.
 */
import { cn } from '../cn'
import { IconWarning } from '../icons'
import { StatusBadge } from '../StatusBadge'
import type { StepStatus } from '../status'

export type QueueItem = {
  code: string
  customerName: string
  itemName: string
  qty: number
  /** ISO 날짜 'YYYY-MM-DD' (Asia/Seoul 기준) */
  dueDate: string
  /** 서버가 계산한 지연 위험(delay_risk)·납기 초과. 없으면 dueDate < today 로 판단 */
  isLate?: boolean | undefined
  stepStatus?: StepStatus | undefined
}

export type QueueListProps = {
  items: QueueItem[]
  /** 기본값 8 */
  limit?: number
  /** 'YYYY-MM-DD'. 지연 판정 기준일. 기본값 오늘(Asia/Seoul) */
  today?: string
  onSelect?: (item: QueueItem) => void
  emptyText?: string
  className?: string
}

function todayKst(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())
}

export function QueueList({ items, limit = 8, today, onSelect, emptyText = '대기 중인 작업이 없습니다', className }: QueueListProps) {
  const base = today ?? todayKst()
  const sorted = [...items].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.code.localeCompare(b.code)).slice(0, limit)

  if (sorted.length === 0) {
    return (
      <div className={cn('rounded-sf border-2 border-dashed border-line p-6 text-center text-sf-lg text-ink-muted', className)}>
        {emptyText}
      </div>
    )
  }

  return (
    <ol className={cn('flex flex-col gap-2', className)} data-component="QueueList">
      {sorted.map((it, i) => {
        const late = it.isLate ?? it.dueDate < base
        const Tag = onSelect ? 'button' : 'div'
        return (
          <li key={it.code}>
            <Tag
              {...(onSelect ? { type: 'button' as const, onClick: () => onSelect(it) } : {})}
              className={cn(
                'flex w-full min-h-touch items-center gap-4 rounded-sf border-2 bg-surface px-4 py-2 text-left',
                late ? 'border-status-error-line bg-status-error-bg' : 'border-line',
                onSelect && 'active:bg-surface-3',
              )}
            >
              <span className="w-8 shrink-0 text-center text-sf-lg font-bold text-ink-muted tabular-nums">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-3">
                  <span className="font-mono text-sf-lg font-bold">{it.code}</span>
                  {late ? (
                    <span className="inline-flex items-center gap-1 text-sf-body font-bold text-status-error-fg">
                      <IconWarning size={20} /> 지연
                    </span>
                  ) : null}
                </span>
                <span className="block truncate text-sf-body text-ink-muted">
                  {it.customerName} · {it.itemName}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sf-lg font-bold tabular-nums">{it.qty.toLocaleString('ko-KR')}</span>
                <span className={cn('block text-sf-body tabular-nums', late ? 'font-bold text-status-error-fg' : 'text-ink-muted')}>
                  납기 {it.dueDate.slice(5).replace('-', '/')}
                </span>
              </span>
              {it.stepStatus ? <StatusBadge kind="step" status={it.stepStatus} density="shopfloor" /> : null}
            </Tag>
          </li>
        )
      })}
    </ol>
  )
}

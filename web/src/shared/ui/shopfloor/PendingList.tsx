/**
 * 승인 대기(KSK-61) · 오프라인 미전송(KSK-90) 공용 목록 (screens-shopfloor §4.2 A8).
 * 행 구성은 두 화면이 공유: 시각·코드·액션·메시지. 화면별로 더 필요한 값(재시도 횟수·8시간 초과·
 * 승인 배지 등)은 `attempts`/`stale`/`badge` 로 얹는다. 삭제 버튼은 두지 않는다(오프라인 큐 유실 금지,
 * metaprompt 절대 규칙 3) — 지우는 UI 는 이 컴포넌트 밖에서도 만들지 않는다.
 */
import type { ReactNode } from 'react'
import { cn } from '../cn'
import { IconWarning } from '../icons'

export type PendingListItem = {
  /** React key. event_uuid 등 고유값 */
  id: string
  /** ISO 시각 */
  at: string
  code: string
  /** 액션 표시명 — 화면이 ScanActionLabel 등으로 미리 계산해 넘긴다 */
  actionLabel: string
  message?: string
  /** KSK-90: 재전송 시도 횟수 */
  attempts?: number
  /** KSK-90: §0.6 8시간 보존 한도 초과 — 행 전체 빨간 테두리 */
  stale?: boolean
  /** 화면별 추가 배지 슬롯 (예: 승인 대기 N) */
  badge?: ReactNode
}

export type PendingListProps = {
  items: PendingListItem[]
  onSelect?: (item: PendingListItem) => void
  emptyText?: string
  className?: string
}

function fmtAt(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(
      new Date(iso),
    )
  } catch {
    return iso
  }
}

export function PendingList({ items, onSelect, emptyText = '대기 중인 건이 없습니다', className }: PendingListProps) {
  if (items.length === 0) {
    return (
      <div className={cn('rounded-sf border-2 border-dashed border-line p-6 text-center text-sf-lg text-ink-muted', className)} data-component="PendingList">
        {emptyText}
      </div>
    )
  }

  return (
    <ol className={cn('flex flex-col gap-2', className)} data-component="PendingList">
      {items.map((it) => {
        const Tag = onSelect ? 'button' : 'div'
        return (
          <li key={it.id}>
            <Tag
              {...(onSelect ? { type: 'button' as const, onClick: () => onSelect(it) } : {})}
              className={cn(
                'flex w-full min-h-touch flex-wrap items-center gap-3 rounded-sf border-2 bg-surface px-4 py-2 text-left',
                it.stale ? 'border-status-error-line bg-status-error-bg' : 'border-line',
                onSelect && 'active:bg-surface-3',
              )}
            >
              <span className="shrink-0 text-sf-body tabular-nums text-ink-muted">{fmtAt(it.at)}</span>
              <span className="shrink-0 font-mono text-sf-lg font-bold">{it.code}</span>
              <span className="shrink-0 text-sf-body font-semibold text-brand-700">{it.actionLabel}</span>
              {it.message ? <span className="min-w-0 flex-1 truncate text-sf-body text-ink-muted">{it.message}</span> : null}
              {it.attempts !== undefined && it.attempts > 0 ? (
                <span className="shrink-0 text-sf-body text-ink-muted">재시도 {it.attempts}회</span>
              ) : null}
              {it.stale ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-sf-body font-bold text-status-error-fg">
                  <IconWarning size={20} /> 8시간 초과
                </span>
              ) : null}
              {it.badge}
            </Tag>
          </li>
        )
      })}
    </ol>
  )
}

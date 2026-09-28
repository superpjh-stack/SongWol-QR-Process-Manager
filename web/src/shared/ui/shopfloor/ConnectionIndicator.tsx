/**
 * 상단 고정 연결 상태 표시 (screens-shopfloor §0.1·§0.6·§4.2 A7). 모든 단말 화면 상단에 붙는다.
 * 색만으로 구분하지 않는다 — 상태·미전송·8시간 초과 배지 각각 색+아이콘+문구를 함께 낸다(§0.9).
 */
import { cn } from '../cn'
import { IconRefresh, IconWarning, IconWifiOff } from '../icons'

export type ConnectionStatus = 'online' | 'offline' | 'syncing'

export type ConnectionIndicatorProps = {
  status: ConnectionStatus
  /** 미전송 건수 (§0.6). 0 이거나 생략하면 배지를 그리지 않는다 */
  pendingCount?: number
  /** 8시간 초과 보존 건수 (§0.6 보존 한도) */
  staleCount?: number
  className?: string
}

export function ConnectionIndicator({ status, pendingCount = 0, staleCount = 0, className }: ConnectionIndicatorProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} data-component="ConnectionIndicator" data-status={status}>
      {status === 'online' ? (
        <span className="inline-flex h-touch-min items-center gap-2 rounded-full border-2 border-status-done-line bg-status-done-bg px-4 text-sf-body font-bold text-status-done-fg">
          <span className="h-3 w-3 shrink-0 rounded-full bg-status-done-fg" aria-hidden="true" />
          연결됨
        </span>
      ) : status === 'syncing' ? (
        <span className="inline-flex h-touch-min items-center gap-2 rounded-full border-2 border-status-progress-line bg-status-progress-bg px-4 text-sf-body font-bold text-status-progress-fg">
          <IconRefresh size={20} className="animate-spin" />
          전송 중…
        </span>
      ) : (
        <span className="inline-flex h-touch-min items-center gap-2 rounded-full border-2 border-line-strong bg-surface-3 px-4 text-sf-body font-bold text-ink-muted">
          <IconWifiOff size={20} />
          오프라인
        </span>
      )}

      {pendingCount > 0 ? (
        <span className="inline-flex h-touch-min items-center gap-2 rounded-full border-2 border-status-warn-line bg-status-warn-bg px-4 text-sf-body font-bold text-status-warn-fg">
          <IconWarning size={20} /> 미전송 {pendingCount.toLocaleString('ko-KR')}건
        </span>
      ) : null}

      {staleCount > 0 ? (
        <span className="inline-flex h-touch-min items-center gap-2 rounded-full border-2 border-status-error-line bg-status-error-bg px-4 text-sf-body font-bold text-status-error-fg">
          <IconWarning size={20} /> 8시간 초과 {staleCount.toLocaleString('ko-KR')}건
        </span>
      ) : null}
    </div>
  )
}

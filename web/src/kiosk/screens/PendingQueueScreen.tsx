/**
 * KSK-90 오프라인 큐 상태·미전송 목록 (screens-shopfloor §1 KSK-90, [S4] 화면이나 큐 메커니즘은 S2 부터
 * 동작해야 하므로 최소 화면을 함께 만든다). 삭제 버튼 없음(유실 금지) — [지금 전송] 만.
 */
import { isStale } from '@/shared/offline'
import { BigButton, ConnectionIndicator, PendingList, type ConnectionStatus, type PendingListItem } from '@/shared/ui/shopfloor'
import { ScanActionLabel } from '@/shared/labels'
import type { PendingScanRecord } from '@/shared/types'

export type PendingQueueScreenProps = {
  status: ConnectionStatus
  pending: PendingScanRecord[]
  staleCount: number
  lastFlushAt: string | null
  onFlushNow: () => void
  onClose: () => void
}

function fmtAt(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date(iso))
  } catch {
    return iso
  }
}

export function PendingQueueScreen({ status, pending, staleCount, lastFlushAt, onFlushNow, onClose }: PendingQueueScreenProps) {
  const rows: PendingListItem[] = pending.map((r) => ({
    id: r.event_uuid,
    at: r.created_at,
    code: r.payload.code,
    actionLabel: ScanActionLabel[r.payload.action],
    message: r.last_error ?? undefined,
    attempts: r.attempts,
    stale: isStale(r),
  }))

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sf-xl font-bold">미전송 목록</h2>
        <ConnectionIndicator status={status} pendingCount={pending.length} staleCount={staleCount} />
      </div>
      <p className="text-sf-body text-ink-muted">{lastFlushAt ? `마지막 전송 시도 ${fmtAt(lastFlushAt)}` : '아직 전송을 시도하지 않았습니다'}</p>
      <PendingList items={rows} emptyText="미전송 건이 없습니다" />
      <div className="flex gap-touch-gap">
        <BigButton variant="secondary" onClick={onClose}>
          대기 화면으로
        </BigButton>
        <BigButton onClick={onFlushNow}>지금 전송</BigButton>
      </div>
    </div>
  )
}

/**
 * KSK-61 승인 대기 목록 (screens-shopfloor §1 KSK-61). `GET /scan/pending?station_id=` → 행 탭 → KSK-60.
 */
import { useEffect, useState } from 'react'
import { scanApi } from '@/shared/api'
import { isApiError } from '@/shared/api/client'
import { BigButton, PendingList, type PendingListItem } from '@/shared/ui/shopfloor'
import { ScanActionLabel } from '@/shared/labels'
import type { PendingScan } from '@/shared/types'

export type PendingApprovalsScreenProps = {
  stationId: string
  onSelect: (item: PendingScan) => void
  onClose: () => void
}

export function PendingApprovalsScreen({ stationId, onSelect, onClose }: PendingApprovalsScreenProps) {
  const [items, setItems] = useState<PendingScan[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    scanApi
      .pending(stationId)
      .then((res) => {
        if (!cancelled) setItems(res)
      })
      .catch((e) => {
        if (!cancelled) setError(isApiError(e) ? e.message : '승인 대기 목록을 불러오지 못했습니다')
      })
    return () => {
      cancelled = true
    }
  }, [stationId])

  const rows: PendingListItem[] =
    items?.map((p) => ({
      id: p.event_uuid,
      at: p.scanned_at,
      code: p.wo?.code ?? p.event_uuid,
      actionLabel: ScanActionLabel[p.action],
      message: p.message,
    })) ?? []

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h2 className="text-sf-xl font-bold">승인 대기 목록</h2>
      {error ? <p className="text-sf-lg font-bold text-status-error-fg">{error}</p> : null}
      {items === null && !error ? <p className="text-sf-lg text-ink-muted">불러오는 중…</p> : null}
      {items !== null ? (
        <PendingList
          items={rows}
          onSelect={(row) => {
            const found = items.find((p) => p.event_uuid === row.id)
            if (found) onSelect(found)
          }}
        />
      ) : null}
      <BigButton variant="secondary" onClick={onClose}>
        대기 화면으로
      </BigButton>
    </div>
  )
}

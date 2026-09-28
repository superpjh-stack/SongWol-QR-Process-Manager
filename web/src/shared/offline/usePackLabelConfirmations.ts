/**
 * `pack_confirmations` 스토어 반응형 훅 — KioskSession(P50) 이 [라벨 부착 확인 N] 배지·화면에 쓴다.
 * `useOfflineQueue` 와 달리 flush 트리거를 직접 걸지 않는다 — 새 확인 행은 KioskSession 이 flush 응답을
 * 받아 `recordPackConfirmations` 로 쓴 뒤 `refresh()` 를 불러 반영한다.
 */
import { useCallback, useEffect, useState } from 'react'
import type { LabelJob } from '../types'
import { ackPackConfirmations, listPackConfirmations, updatePackConfirmationLabel, type PackLabelConfirmation } from './packConfirmations'

export type UsePackLabelConfirmationsResult = {
  items: PackLabelConfirmation[]
  count: number
  refresh: () => void
  ackAll: () => Promise<void>
  updateLabel: (id: string, labelJob: LabelJob) => Promise<void>
}

export function usePackLabelConfirmations(): UsePackLabelConfirmationsResult {
  const [items, setItems] = useState<PackLabelConfirmation[]>([])

  const refresh = useCallback(() => {
    void listPackConfirmations().then(setItems)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const ackAll = useCallback(async () => {
    await ackPackConfirmations(items.map((it) => it.id))
    refresh()
  }, [items, refresh])

  const updateLabel = useCallback(
    async (id: string, labelJob: LabelJob) => {
      await updatePackConfirmationLabel(id, labelJob)
      refresh()
    },
    [refresh],
  )

  return { items, count: items.length, refresh, ackAll, updateLabel }
}

/**
 * 오프라인 큐 반응형 훅 — 화면은 이걸로 미전송 건수·연결 상태(ConnectionIndicator)·목록(KSK-90)을 읽는다.
 * flush 트리거 3종(§0.6): `online` 이벤트 · `visibilitychange` visible · 30초 주기. 키오스크 세션에
 * **한 번만** 마운트해서 쓴다(여러 곳에서 쓰면 인터벌·리스너가 중복 등록된다) — KioskSession 최상단 권장.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PendingScanRecord, ScanResponse } from '../types'
import { flushQueue, isStale, listAll, subscribe } from './offlineQueue'

export type OfflineConnStatus = 'online' | 'offline' | 'syncing'

export type FlushedEntry = { event_uuid: string; response: ScanResponse; at: string }

export type UseOfflineQueueResult = {
  status: OfflineConnStatus
  pending: PendingScanRecord[]
  pendingCount: number
  staleCount: number
  lastFlushAt: string | null
  /** [지금 전송] 버튼(KSK-90) */
  flushNow: () => void
  /** flush 로 들어온 WARN/REJECT 를 화면(WarnBanner 누적)이 소비할 수 있게 콜백으로 넘긴다 */
  onFlushed?: (entries: FlushedEntry[]) => void
}

const FLUSH_INTERVAL_MS = 30_000

export function useOfflineQueue(onFlushed?: (entries: FlushedEntry[]) => void): UseOfflineQueueResult {
  const [pending, setPending] = useState<PendingScanRecord[]>([])
  const [status, setStatus] = useState<OfflineConnStatus>(() => (typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online'))
  const [lastFlushAt, setLastFlushAt] = useState<string | null>(null)

  const refresh = useCallback(() => {
    void listAll().then(setPending)
  }, [])

  // ref 로 최신 콜백을 본다 — 매 렌더 새 함수가 와도 아래 effect(리스너·인터벌 등록)를 다시 걸지 않는다
  const onFlushedRef = useRef(onFlushed)
  onFlushedRef.current = onFlushed

  const runFlush = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    setStatus('syncing')
    try {
      const result = await flushQueue()
      setLastFlushAt(new Date().toISOString())
      if (result && result.responses.length > 0) {
        const at = new Date().toISOString()
        onFlushedRef.current?.(result.responses.map((r) => ({ ...r, at })))
      }
    } finally {
      setStatus(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online')
    }
  }, [])

  useEffect(() => {
    refresh()
    const unsub = subscribe(refresh)

    const onOnline = () => {
      setStatus('online')
      void runFlush()
    }
    const onOffline = () => setStatus('offline')
    const onVisible = () => {
      if (document.visibilityState === 'visible') void runFlush()
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisible)
    const interval = window.setInterval(() => void runFlush(), FLUSH_INTERVAL_MS)

    // 최초 마운트 시 한 번 시도 (앱 재시작 직후 밀린 큐가 있을 수 있다)
    void runFlush()

    return () => {
      unsub()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(interval)
    }
  }, [refresh, runFlush])

  const staleCount = useMemo(() => pending.filter((p) => isStale(p)).length, [pending])

  return {
    status,
    pending,
    pendingCount: pending.length,
    staleCount,
    lastFlushAt,
    flushNow: () => void runFlush(),
  }
}

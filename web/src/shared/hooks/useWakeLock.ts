/**
 * Screen Wake Lock. 키오스크·PDA·현황판의 화면 꺼짐 방지 (plan §5.2 PWA).
 * 미지원 브라우저(iOS Safari 구버전 등)는 no-op — `supported=false` 를 돌려주며 화면은 정상 동작한다.
 * 탭이 다시 보이면(visibilitychange) 락이 풀려 있으므로 재요청한다.
 */
import { useEffect, useState } from 'react'

type WakeLockSentinelLike = { release(): Promise<void>; addEventListener(type: 'release', cb: () => void): void }
type NavigatorWithWakeLock = Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } }

export type WakeLockState = { supported: boolean; active: boolean; error: string | null }

export function useWakeLock(enabled = true): WakeLockState {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!supported || !enabled) return
    const nav = navigator as NavigatorWithWakeLock
    let sentinel: WakeLockSentinelLike | null = null
    let cancelled = false

    const request = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const s = await nav.wakeLock!.request('screen')
        if (cancelled) {
          void s.release()
          return
        }
        sentinel = s
        setActive(true)
        setError(null)
        s.addEventListener('release', () => {
          sentinel = null
          setActive(false)
        })
      } catch (err) {
        // 저전력 모드 등에서 거부될 수 있다. 조용히 삼키지 않고 상태로 노출한다.
        setActive(false)
        setError(err instanceof Error ? err.message : String(err))
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !sentinel) void request()
    }

    void request()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      if (sentinel) void sentinel.release()
    }
  }, [supported, enabled])

  return { supported, active, error }
}

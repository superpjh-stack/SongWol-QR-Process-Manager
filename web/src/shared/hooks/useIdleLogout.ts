/**
 * 무동작 자동 로그아웃 타이머. spec §3 "30분 무동작 시 자동 로그아웃".
 * 포인터·키·터치·스크롤 활동이 있으면 타이머를 되돌린다. 스캐너 입력도 keydown 이므로 활동으로 잡힌다.
 * 남은 시간이 `warnBeforeMs`(기본 60초) 가 되면 `onWarn` 을 불러 예고 배너를 띄울 수 있게 한다
 * (screens-shopfloor §0.3 "1분 후 자동 로그아웃 — 화면을 터치하면 연장").
 */
import { useEffect, useRef } from 'react'

/** spec §3 기본값 30분 */
export const IDLE_LOGOUT_MS = 30 * 60 * 1000

/** screens-shopfloor §0.3 기본값 — 로그아웃 60초 전 예고 */
export const IDLE_WARN_BEFORE_MS = 60 * 1000

const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'wheel']

export type IdleLogoutOptions = {
  enabled?: boolean
  /** 로그아웃 `warnBeforeMs` 전에 한 번 불린다 (예고 배너용). 활동이 있으면 다시 예약된다 */
  onWarn?: () => void
  /** 기본값 60_000 (IDLE_WARN_BEFORE_MS) */
  warnBeforeMs?: number
}

export function useIdleLogout(ms: number, onIdle: () => void, options: boolean | IdleLogoutOptions = true): { reset: () => void } {
  const opts: IdleLogoutOptions = typeof options === 'boolean' ? { enabled: options } : options
  const { enabled = true, onWarn, warnBeforeMs = IDLE_WARN_BEFORE_MS } = opts

  const onIdleRef = useRef(onIdle)
  onIdleRef.current = onIdle
  const onWarnRef = useRef(onWarn)
  onWarnRef.current = onWarn

  const timerRef = useRef<number | null>(null)
  const warnTimerRef = useRef<number | null>(null)
  const resetRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!enabled) return
    const arm = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      if (warnTimerRef.current !== null) window.clearTimeout(warnTimerRef.current)

      const warnDelay = ms - warnBeforeMs
      if (onWarnRef.current && warnDelay > 0) {
        warnTimerRef.current = window.setTimeout(() => {
          warnTimerRef.current = null
          onWarnRef.current?.()
        }, warnDelay)
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        onIdleRef.current()
      }, ms)
    }
    resetRef.current = arm
    arm()
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, arm, { passive: true, capture: true })
    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, arm, { capture: true })
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      if (warnTimerRef.current !== null) window.clearTimeout(warnTimerRef.current)
      timerRef.current = null
      warnTimerRef.current = null
      resetRef.current = () => {}
    }
  }, [ms, enabled, warnBeforeMs])

  return { reset: () => resetRef.current() }
}

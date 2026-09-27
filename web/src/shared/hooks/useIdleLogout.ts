/**
 * 무동작 자동 로그아웃 타이머. spec §3 "30분 무동작 시 자동 로그아웃".
 * 포인터·키·터치·스크롤 활동이 있으면 타이머를 되돌린다. 스캐너 입력도 keydown 이므로 활동으로 잡힌다.
 */
import { useEffect, useRef } from 'react'

/** spec §3 기본값 30분 */
export const IDLE_LOGOUT_MS = 30 * 60 * 1000

const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'wheel']

export function useIdleLogout(ms: number, onIdle: () => void, enabled = true): { reset: () => void } {
  const onIdleRef = useRef(onIdle)
  onIdleRef.current = onIdle
  const timerRef = useRef<number | null>(null)

  const resetRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!enabled) return
    const arm = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
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
      timerRef.current = null
      resetRef.current = () => {}
    }
  }, [ms, enabled])

  return { reset: () => resetRef.current() }
}

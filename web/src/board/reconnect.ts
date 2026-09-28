/**
 * BRD-02 접속·재연결·단절 표시 — 타이밍 계산을 훅에서 떼어낸 순수 함수 (screens-shopfloor §3 BRD-02).
 * "1 → 2 → 4 → … 최대 30초 백오프", "90초 이상 끊기면 배너를 주황으로"를 실제 타이머 없이 테스트한다.
 */

export const BACKOFF_START_MS = 1_000
export const BACKOFF_CAP_MS = 30_000
/** 서버 ping 주기 60초(api-contract §8) — 이보다 오래 아무 메시지도 못 받으면 죽은 연결로 보고 재접속 */
export const STALE_CONNECTION_MS = 60_000
/** 배너가 회색(재연결 중)에서 주황(장기 단절)으로 바뀌는 기준 (§3 BRD-02) */
export const LONG_DISCONNECT_MS = 90_000

/** 다음 재시도까지의 대기(ms). 1000 → 2000 → 4000 → … → 30000(cap) 유지 */
export function nextBackoffMs(current: number): number {
  return Math.min(current * 2, BACKOFF_CAP_MS)
}

/** 재연결 시도 횟수(1부터) → 그 시도 전에 기다릴 ms. attempt=1 이면 최초 대기(1초) */
export function backoffForAttempt(attempt: number): number {
  let ms = BACKOFF_START_MS
  for (let i = 1; i < attempt; i++) ms = nextBackoffMs(ms)
  return ms
}

export type BoardConnectionStatus = 'connected' | 'reconnecting' | 'reconnecting_long' | 'key_error'

/** 재연결 중 배너 톤 — 끊긴 지 90초 미만이면 회색, 이상이면 주황(§3 BRD-02) */
export function disconnectStatus(msSinceDisconnect: number): 'reconnecting' | 'reconnecting_long' {
  return msSinceDisconnect >= LONG_DISCONNECT_MS ? 'reconnecting_long' : 'reconnecting'
}

/** 현황판 WS URL — 계약상 최상위 `/ws/board`(`/api/v1` 밖, backend/app/main.py 주석). 같은 오리진, 프로토콜만 http→ws 로 바꾼다 */
export function buildBoardWsUrl(key: string, location: Pick<Location, 'protocol' | 'host'> = window.location): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.host}/ws/board?key=${encodeURIComponent(key)}`
}

/** reconnect — BRD-02 재연결 백오프·장기 단절 판정 타이밍 (screens-shopfloor §3 BRD-02). 실제 타이머 없이 순수 함수만 검증한다 */
import { describe, expect, it } from 'vitest'
import { BACKOFF_CAP_MS, backoffForAttempt, buildBoardWsUrl, disconnectStatus, LONG_DISCONNECT_MS, nextBackoffMs } from './reconnect'

describe('nextBackoffMs', () => {
  it('두 배로 늘어나다가 30초에서 멈춘다', () => {
    let ms = 1000
    const seq = [ms]
    for (let i = 0; i < 8; i++) {
      ms = nextBackoffMs(ms)
      seq.push(ms)
    }
    expect(seq).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000])
  })

  it('cap 을 넘지 않는다', () => {
    expect(nextBackoffMs(29_000)).toBe(BACKOFF_CAP_MS)
    expect(nextBackoffMs(30_000)).toBe(BACKOFF_CAP_MS)
  })
})

describe('backoffForAttempt', () => {
  it('1 → 2 → 4 → … → 30(cap) 순서를 시도 횟수로 돌려준다', () => {
    expect(backoffForAttempt(1)).toBe(1000)
    expect(backoffForAttempt(2)).toBe(2000)
    expect(backoffForAttempt(3)).toBe(4000)
    expect(backoffForAttempt(4)).toBe(8000)
    expect(backoffForAttempt(5)).toBe(16000)
    expect(backoffForAttempt(6)).toBe(30000)
    expect(backoffForAttempt(7)).toBe(30000)
    expect(backoffForAttempt(20)).toBe(30000)
  })
})

describe('disconnectStatus', () => {
  it('90초 미만이면 reconnecting(회색)', () => {
    expect(disconnectStatus(0)).toBe('reconnecting')
    expect(disconnectStatus(LONG_DISCONNECT_MS - 1)).toBe('reconnecting')
  })
  it('90초 이상이면 reconnecting_long(주황)', () => {
    expect(disconnectStatus(LONG_DISCONNECT_MS)).toBe('reconnecting_long')
    expect(disconnectStatus(LONG_DISCONNECT_MS + 60_000)).toBe('reconnecting_long')
  })
})

describe('buildBoardWsUrl', () => {
  it('https 오리진은 wss, key 를 인코딩해 /ws/board 로 붙인다 (api-contract §8 — /api/v1 밖)', () => {
    const url = buildBoardWsUrl('a b&c', { protocol: 'https:', host: 'board.example.com' })
    expect(url).toBe('wss://board.example.com/ws/board?key=a%20b%26c')
  })
  it('http 오리진은 ws', () => {
    const url = buildBoardWsUrl('k', { protocol: 'http:', host: 'localhost:5173' })
    expect(url).toBe('ws://localhost:5173/ws/board?key=k')
  })
})

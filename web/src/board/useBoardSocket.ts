/**
 * BRD-01/BRD-02 소켓 훅 — `wss://{host}/ws/board?key=` 접속 · 초기 데이터(REST 경합) · 재연결
 * 백오프 · 60초 무응답 감지 · 단절 중 60초 폴링 대체 (screens-shopfloor §3). 메시지 반영은
 * `boardReducer`(순수 함수)에 위임하고, 이 훅은 소켓 생명주기·타이머만 다룬다.
 *
 * 함수 선언(`function connect() {}` 등)을 이펙트 본문 안에 그대로 두는 이유: `connect` ↔
 * `scheduleReconnect` 가 서로를 참조하는 순환 의존인데, `useCallback` 체인으로 쪼개면 의존성 배열이
 * 서로를 가리켜 정리가 지저분해진다. 함수 선언은 호이스팅되어 선언 순서와 무관하게 서로 참조할 수
 * 있고, 이펙트가 `key` 변경 시에만 다시 도니 매 렌더 재생성 걱정도 없다.
 */
import { useCallback, useEffect, useState } from 'react'
import { boardApi } from '@/shared/api'
import type { BoardMessage } from '@/shared/types'
import { backoffForAttempt, buildBoardWsUrl, LONG_DISCONNECT_MS, STALE_CONNECTION_MS, type BoardConnectionStatus } from './reconnect'
import { boardReducer, dismissTicker, initialBoardState, type BoardState } from './boardReducer'

const POLL_INTERVAL_MS = 60_000 // BRD-02 "WS 단절 중 60초마다 GET /dashboard/summary"

export type UseBoardSocketResult = {
  state: BoardState
  connection: BoardConnectionStatus
  /** connection 이 reconnecting* 인 동안 60초 폴링이 도는 중인지 — 배너 "폴링 갱신 중" 표시용 */
  polling: boolean
  dismissTickerItem: (id: string) => void
}

export function useBoardSocket(key: string | null): UseBoardSocketResult {
  const [state, setState] = useState<BoardState>(initialBoardState)
  const [connection, setConnection] = useState<BoardConnectionStatus>(key ? 'reconnecting' : 'key_error')
  const [polling, setPolling] = useState(false)

  // 초기 데이터: REST 를 WS 와 병행 요청 — snapshot 이 이미 왔으면(WS 가 더 빨랐으면) 버린다(§3 "둘 중 먼저 온 것")
  useEffect(() => {
    if (!key) return
    let cancelled = false
    void boardApi
      .summary()
      .then((summary) => {
        if (cancelled) return
        setState((s) => (s.summary ? s : boardReducer(s, { type: 'snapshot', at: summary.generated_at, summary })))
      })
      .catch(() => {
        /* WS snapshot 또는 재연결 폴링이 이어서 채운다 — 최초 REST 는 속도 최적화일 뿐 필수 경로가 아니다 */
      })
    return () => {
      cancelled = true
    }
  }, [key])

  useEffect(() => {
    if (!key) {
      setConnection('key_error')
      return
    }
    setConnection((c) => (c === 'connected' ? c : 'reconnecting'))
    // TS 는 클로저 안쪽 함수 선언까지 내로잉을 전파하지 않는다 — 지역 상수로 한 번 더 고정한다
    const boardKey = key

    let ws: WebSocket | null = null
    let attempt = 0
    let reconnectTimer: number | null = null
    let staleTimer: number | null = null
    let escalateTimer: number | null = null
    let pollTimer: number | null = null
    let stopped = false

    function clearReconnectTimer(): void {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
    }
    function clearStaleTimer(): void {
      if (staleTimer !== null) {
        window.clearTimeout(staleTimer)
        staleTimer = null
      }
    }
    function clearEscalateTimer(): void {
      if (escalateTimer !== null) {
        window.clearTimeout(escalateTimer)
        escalateTimer = null
      }
    }
    function startPolling(): void {
      if (pollTimer !== null) return
      setPolling(true)
      pollTimer = window.setInterval(() => {
        void boardApi
          .summary()
          .then((summary) => {
            if (stopped) return
            setState((s) => boardReducer(s, { type: 'snapshot', at: summary.generated_at, summary }))
          })
          .catch(() => {
            /* 폴링 실패는 다음 주기에 다시 시도 — 배너는 이미 끊김을 보여주고 있다(조용한 실패 아님) */
          })
      }, POLL_INTERVAL_MS)
    }
    function stopPolling(): void {
      if (pollTimer !== null) {
        window.clearInterval(pollTimer)
        pollTimer = null
      }
      setPolling(false)
    }
    function armStaleWatch(): void {
      clearStaleTimer()
      // 서버가 60초마다 ping/snapshot 을 보낸다 — 그만큼 아무 메시지도 못 받으면 죽은 연결로 보고 스스로 닫는다
      staleTimer = window.setTimeout(() => ws?.close(), STALE_CONNECTION_MS)
    }
    function onConnected(): void {
      attempt = 0
      clearEscalateTimer()
      stopPolling()
      setConnection('connected')
    }
    function scheduleReconnect(): void {
      if (stopped) return
      clearReconnectTimer()
      attempt += 1
      reconnectTimer = window.setTimeout(connect, backoffForAttempt(attempt))
    }
    function connect(): void {
      if (stopped) return
      let socket: WebSocket
      try {
        socket = new WebSocket(buildBoardWsUrl(boardKey))
      } catch {
        scheduleReconnect()
        return
      }
      ws = socket
      socket.onopen = () => armStaleWatch()
      socket.onmessage = (ev) => {
        armStaleWatch()
        onConnected()
        let msg: BoardMessage
        try {
          msg = JSON.parse(String(ev.data)) as BoardMessage
        } catch {
          return // 계약 밖 메시지 — 조용히 무시(연결은 끊지 않는다)
        }
        if (msg.type === 'ping') {
          try {
            socket.send(JSON.stringify({ type: 'pong' }))
          } catch {
            /* 소켓이 그 사이 닫혔으면 onclose 가 재접속을 예약한다 */
          }
        }
        setState((s) => boardReducer(s, msg))
      }
      socket.onclose = (ev) => {
        clearStaleTimer()
        ws = null
        if (stopped) return
        if (ev.code === 4401) {
          setConnection('key_error') // 단말 키 오류(§3 BRD-02) — 재연결하지 않는다
          return
        }
        setConnection((c) => (c === 'reconnecting_long' ? c : 'reconnecting'))
        if (escalateTimer === null) {
          escalateTimer = window.setTimeout(() => setConnection('reconnecting_long'), LONG_DISCONNECT_MS)
        }
        startPolling()
        scheduleReconnect()
      }
      socket.onerror = () => {
        /* onclose 가 뒤따라온다 — 여기서는 처리하지 않는다(중복 예약 방지) */
      }
    }

    connect()

    return () => {
      stopped = true
      clearReconnectTimer()
      clearStaleTimer()
      clearEscalateTimer()
      stopPolling()
      ws?.close()
    }
  }, [key])

  const dismissTickerItem = useCallback((id: string) => setState((s) => dismissTicker(s, id)), [])

  return { state, connection, polling, dismissTickerItem }
}

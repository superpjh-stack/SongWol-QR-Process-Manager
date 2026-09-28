/**
 * BRD-01 WS 메시지 반영 — 순수 리듀서 (screens-shopfloor §3 "BRD-01 WS 메시지별 반영" 표).
 * 소켓·타이머 등 부수효과는 `useBoardSocket.ts` 가 갖고, 이 파일은 `(state, message) -> state` 만
 * 한다 — 실제 소켓 없이 테스트할 수 있게 분리했다(과제 지시문 "WS 메시지 처리 로직 테스트").
 *
 * 반영 규칙(§3 표):
 * - `snapshot`  → summary 전체 교체
 * - `wo_updated` → `so.delay_risk` 로 delay_risk 목록 추가/제거, `so.due_date` 가 오늘이면 today_due
 *   유지/추가 아니면 제거, `process_queue_delta[].wo_count` 만 해당 공정 타일에 반영(qty_total ·
 *   max_wait_hours 는 델타에 없어 그대로 둔다 — 다음 snapshot 까지 유지, §5 ㉓). output_per_hour_today ·
 *   today_shipments 는 이 메시지로 갱신되지 않는다(서버가 5분마다 snapshot 을 재전송해 채운다,
 *   backend/app/ws/router.py `_snapshot_interval_sec`)
 * - `notification` → 티커 큐에 추가
 * - `approval_pending` → pending_approvals +1, 티커에 "승인 대기: {code}" 추가
 * - `ping` → 반영할 상태 없음(활동 시각 갱신은 훅이 한다)
 */
import type { BoardMessage, DashboardSummary, SoProgress } from '@/shared/types'
import type { TickerItem } from '@/shared/ui/shopfloor'

export type BoardState = {
  summary: DashboardSummary | null
  ticker: TickerItem[]
  /** 마지막으로 반영된 메시지의 `at` (snapshot·wo_updated) — "마지막 갱신 hh:mm:ss" 표시용 */
  updatedAt: string | null
}

export const initialBoardState: BoardState = { summary: null, ticker: [], updatedAt: null }

/** KstDateTime('...+09:00')·'YYYY-MM-DD' 어느 쪽이 와도 앞 10자(날짜부)만 비교한다 */
function dateOnly(s: string): string {
  return s.length >= 10 ? s.slice(0, 10) : s
}

export function todayKst(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(now)
}

function upsertSo(list: SoProgress[], so: SoProgress): SoProgress[] {
  const idx = list.findIndex((s) => s.so_code === so.so_code)
  const next = idx >= 0 ? [...list.slice(0, idx), so, ...list.slice(idx + 1)] : [...list, so]
  // §3 정렬: today_due·delay_risk 모두 due_date 오름차순(그 외 progress_pct 오름차순은 화면 표시 단계에서 today_due 에만 적용)
  return next.sort((a, b) => a.due_date.localeCompare(b.due_date) || a.so_code.localeCompare(b.so_code))
}

function removeSo(list: SoProgress[], soCode: string): SoProgress[] {
  return list.filter((s) => s.so_code !== soCode)
}

export function applyWoUpdated(summary: DashboardSummary, msg: Extract<BoardMessage, { type: 'wo_updated' }>, now: Date = new Date()): DashboardSummary {
  const so = msg.so
  const delay_risk = so.delay_risk ? upsertSo(summary.delay_risk, so) : removeSo(summary.delay_risk, so.so_code)
  const isToday = dateOnly(so.due_date) === todayKst(now)
  const today_due = isToday ? upsertSo(summary.today_due, so) : removeSo(summary.today_due, so.so_code)
  const process_queue = summary.process_queue.map((row) => {
    const delta = msg.process_queue_delta.find((d) => d.process_code === row.process_code)
    return delta ? { ...row, wo_count: delta.wo_count } : row
  })
  return { ...summary, today_due, delay_risk, process_queue }
}

let tickerSeq = 0
function tickerId(prefix: string, key: string | number): string {
  tickerSeq += 1
  return `${prefix}-${key}-${tickerSeq}`
}

export function boardReducer(state: BoardState, message: BoardMessage, now: Date = new Date()): BoardState {
  switch (message.type) {
    case 'snapshot':
      return { ...state, summary: message.summary, updatedAt: message.at }
    case 'wo_updated':
      // snapshot 이 먼저 온다는 전제(§3 "초기 데이터") — 아직 없으면 델타를 적용할 대상이 없어 무시한다
      if (!state.summary) return state
      return { ...state, summary: applyWoUpdated(state.summary, message, now), updatedAt: message.at }
    case 'notification': {
      const n = message.notification
      const item: TickerItem = { id: tickerId('n', n.id), type: n.type, targetCode: n.target_code, message: n.message }
      return { ...state, ticker: [...state.ticker, item] }
    }
    case 'approval_pending': {
      const p = message.pending
      const item: TickerItem = { id: tickerId('a', p.event_uuid), type: 'APPROVAL_REQUEST', targetCode: p.wo?.code ?? p.event_uuid, message: `승인 대기: ${p.wo?.code ?? p.event_uuid}` }
      const summary = state.summary ? { ...state.summary, pending_approvals: state.summary.pending_approvals + 1 } : state.summary
      return { ...state, summary, ticker: [...state.ticker, item] }
    }
    case 'ping':
      return state
    default:
      return state
  }
}

/** Ticker 컴포넌트는 제어형(onExpire) — dwellMs 뒤 화면이 큐에서 지운다 */
export function dismissTicker(state: BoardState, id: string): BoardState {
  return { ...state, ticker: state.ticker.filter((t) => t.id !== id) }
}

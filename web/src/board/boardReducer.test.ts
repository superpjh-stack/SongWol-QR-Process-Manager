/** boardReducer — BRD-01 WS 메시지별 반영 (screens-shopfloor §3 표). 실제 소켓 없이 순수 함수만 검증한다 */
import { describe, expect, it } from 'vitest'
import { applyWoUpdated, boardReducer, dismissTicker, initialBoardState, todayKst, type BoardState } from './boardReducer'
import type { BoardMessage, DashboardSummary, SoProgress } from '@/shared/types'

function makeSummary(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    today_due: [],
    delay_risk: [],
    process_queue: [
      { process_code: 'P20', process_name: '입고', wo_count: 1, qty_total: 100, max_wait_hours: 2 },
      { process_code: 'P30', process_name: '인쇄', wo_count: 2, qty_total: 200, max_wait_hours: 4 },
    ],
    today_shipments: { planned: 5, done: 2, overdue: 0 },
    output_per_hour_today: 120,
    pending_approvals: 0,
    offline_backlog: [],
    generated_at: '2026-09-29T09:00:00+09:00',
    ...overrides,
  }
}

function makeSo(overrides: Partial<SoProgress> = {}): SoProgress {
  return {
    so_id: 1,
    so_code: 'SO-260929-0001',
    customer_name: '대한타월',
    due_date: '2026-09-29',
    status: 'IN_PROGRESS',
    progress_pct: 50,
    current_processes: ['인쇄'],
    delay_risk: false,
    est_complete_at: null,
    ...overrides,
  }
}

describe('todayKst', () => {
  it('Asia/Seoul 기준 YYYY-MM-DD 를 돌려준다', () => {
    // KST 09:00 = UTC 00:00, 같은 날짜여야 한다
    expect(todayKst(new Date('2026-09-29T00:00:00Z'))).toBe('2026-09-29')
    // KST 자정 넘김: UTC 15:30(전날) = KST 00:30(다음날)
    expect(todayKst(new Date('2026-09-28T15:30:00Z'))).toBe('2026-09-29')
  })
})

describe('boardReducer — snapshot', () => {
  it('summary 전체를 교체한다', () => {
    const summary = makeSummary()
    const msg: BoardMessage = { type: 'snapshot', at: '2026-09-29T09:00:00+09:00', summary }
    const next = boardReducer(initialBoardState, msg)
    expect(next.summary).toBe(summary)
    expect(next.updatedAt).toBe('2026-09-29T09:00:00+09:00')
  })
})

describe('boardReducer — wo_updated', () => {
  it('snapshot 이 오기 전이면 무시한다(적용 대상 없음)', () => {
    const msg: BoardMessage = {
      type: 'wo_updated',
      at: '2026-09-29T09:01:00+09:00',
      wo: {} as never,
      so: makeSo(),
      process_queue_delta: [],
    }
    const next = boardReducer(initialBoardState, msg)
    expect(next).toBe(initialBoardState)
  })

  it('delay_risk=true 인 SO 를 delay_risk 목록에 추가한다', () => {
    const state: BoardState = { summary: makeSummary(), ticker: [], updatedAt: null }
    const so = makeSo({ so_code: 'SO-260929-0002', delay_risk: true })
    const msg: BoardMessage = { type: 'wo_updated', at: 't', wo: {} as never, so, process_queue_delta: [] }
    const next = boardReducer(state, msg)
    expect(next.summary!.delay_risk.map((s) => s.so_code)).toEqual(['SO-260929-0002'])
  })

  it('delay_risk=false 가 되면 delay_risk 목록에서 제거한다', () => {
    const so1 = makeSo({ so_code: 'SO-A', delay_risk: true })
    const state: BoardState = { summary: makeSummary({ delay_risk: [so1] }), ticker: [], updatedAt: null }
    const so1Resolved = { ...so1, delay_risk: false }
    const msg: BoardMessage = { type: 'wo_updated', at: 't', wo: {} as never, so: so1Resolved, process_queue_delta: [] }
    const next = boardReducer(state, msg)
    expect(next.summary!.delay_risk).toEqual([])
  })

  it('같은 so_code 는 갱신(upsert)하고 중복시키지 않는다', () => {
    const so1 = makeSo({ so_code: 'SO-A', delay_risk: true, progress_pct: 10 })
    const state: BoardState = { summary: makeSummary({ delay_risk: [so1] }), ticker: [], updatedAt: null }
    const updated = { ...so1, progress_pct: 40 }
    const msg: BoardMessage = { type: 'wo_updated', at: 't', wo: {} as never, so: updated, process_queue_delta: [] }
    const next = boardReducer(state, msg)
    expect(next.summary!.delay_risk).toHaveLength(1)
    expect(next.summary!.delay_risk[0]!.progress_pct).toBe(40)
  })

  it('due_date 가 오늘이면 today_due 에 유지/추가하고, 아니면 제거한다', () => {
    const now = new Date('2026-09-29T01:00:00Z') // KST 10:00, 2026-09-29
    const soToday = makeSo({ so_code: 'SO-TODAY', due_date: '2026-09-29' })
    const soFuture = makeSo({ so_code: 'SO-FUTURE', due_date: '2026-10-05' })

    const applied = applyWoUpdated(makeSummary(), { type: 'wo_updated', at: 't', wo: {} as never, so: soToday, process_queue_delta: [] }, now)
    expect(applied.today_due.map((s) => s.so_code)).toEqual(['SO-TODAY'])

    const appliedFuture = applyWoUpdated(makeSummary({ today_due: [soToday] }), { type: 'wo_updated', at: 't', wo: {} as never, so: soFuture, process_queue_delta: [] }, now)
    expect(appliedFuture.today_due.map((s) => s.so_code)).toEqual(['SO-TODAY']) // 미래 납기는 today_due 에 들어가지 않는다

    const appliedRemoved = applyWoUpdated(makeSummary({ today_due: [soToday] }), { type: 'wo_updated', at: 't', wo: {} as never, so: { ...soToday, due_date: '2026-10-01' }, process_queue_delta: [] }, now)
    expect(appliedRemoved.today_due).toEqual([]) // 오늘이 아니게 되면 제거된다
  })

  it('process_queue_delta 는 해당 공정의 wo_count 만 바꾸고 qty_total·max_wait_hours 는 유지한다', () => {
    const summary = makeSummary()
    const msg: Extract<BoardMessage, { type: 'wo_updated' }> = {
      type: 'wo_updated',
      at: 't',
      wo: {} as never,
      so: makeSo(),
      process_queue_delta: [{ process_code: 'P30', wo_count: 9 }],
    }
    const next = applyWoUpdated(summary, msg)
    const p30 = next.process_queue.find((r) => r.process_code === 'P30')!
    expect(p30.wo_count).toBe(9)
    expect(p30.qty_total).toBe(200) // 델타에 없는 필드는 그대로
    const p20 = next.process_queue.find((r) => r.process_code === 'P20')!
    expect(p20.wo_count).toBe(1) // 델타 없는 공정은 아예 건드리지 않는다
  })
})

describe('boardReducer — notification', () => {
  it('티커 큐에 추가한다', () => {
    const state: BoardState = { summary: makeSummary(), ticker: [], updatedAt: null }
    const msg: BoardMessage = {
      type: 'notification',
      at: 't',
      notification: { id: 1, type: 'DELAY', target_code: 'SO-0001', message: '납기 임박', channel: 'INAPP', created_at: 't', sent_at: null, ack_by: null, ack_at: null },
    }
    const next = boardReducer(state, msg)
    expect(next.ticker).toHaveLength(1)
    expect(next.ticker[0]!.type).toBe('DELAY')
    expect(next.ticker[0]!.targetCode).toBe('SO-0001')
    expect(next.ticker[0]!.message).toBe('납기 임박')
  })
})

describe('boardReducer — approval_pending', () => {
  it('pending_approvals 를 1 증가시키고 티커에 추가한다', () => {
    const state: BoardState = { summary: makeSummary({ pending_approvals: 2 }), ticker: [], updatedAt: null }
    const msg: BoardMessage = {
      type: 'approval_pending',
      at: 't',
      pending: {
        event_uuid: 'uuid-1',
        scanned_at: 't',
        station_id: 'K-P30-1',
        worker: null,
        wo: { code: 'WO-260929-00001' } as never,
        action: 'DONE',
        process_code: 'P30',
        message: '직전 공정 미완료',
        approval_token: 'tok',
      },
    }
    const next = boardReducer(state, msg)
    expect(next.summary!.pending_approvals).toBe(3)
    expect(next.ticker).toHaveLength(1)
    expect(next.ticker[0]!.type).toBe('APPROVAL_REQUEST')
    expect(next.ticker[0]!.targetCode).toBe('WO-260929-00001')
  })

  it('summary 가 아직 없으면 카운트는 건너뛰고 티커만 쌓는다', () => {
    const msg: BoardMessage = {
      type: 'approval_pending',
      at: 't',
      pending: { event_uuid: 'uuid-2', scanned_at: 't', station_id: 'K-P30-1', worker: null, wo: null, action: 'DONE', process_code: 'P30', message: 'm', approval_token: 'tok' },
    }
    const next = boardReducer(initialBoardState, msg)
    expect(next.summary).toBeNull()
    expect(next.ticker).toHaveLength(1)
  })
})

describe('boardReducer — ping', () => {
  it('상태를 바꾸지 않는다', () => {
    const state: BoardState = { summary: makeSummary(), ticker: [], updatedAt: 'x' }
    const next = boardReducer(state, { type: 'ping', at: 't' })
    expect(next).toBe(state)
  })
})

describe('dismissTicker', () => {
  it('id 로 티커 항목을 제거한다', () => {
    const state: BoardState = { summary: null, ticker: [{ id: 'a', type: 'DELAY', targetCode: 'X', message: 'm' }, { id: 'b', type: 'DEFECT', targetCode: 'Y', message: 'm2' }], updatedAt: null }
    const next = dismissTicker(state, 'a')
    expect(next.ticker.map((t) => t.id)).toEqual(['b'])
  })
})

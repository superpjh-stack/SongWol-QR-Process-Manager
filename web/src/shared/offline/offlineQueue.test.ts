/**
 * 오프라인 큐 — "저장 → 전송 → (200 이면) 삭제" 순서와 유지/삭제 규칙 (screens-shopfloor §0.6).
 * IndexedDB 는 jsdom 에 없어 fake-indexeddb 로 대체한다.
 */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScanRequest, ScanResponse } from '../types'

function makeReq(overrides: Partial<ScanRequest> = {}): ScanRequest {
  return {
    event_uuid: overrides.event_uuid ?? '11111111-1111-1111-1111-111111111111',
    scanned_at: '2026-10-01T09:00:00+09:00',
    station_id: 'K-P30-1',
    worker_card: 'US-0007',
    code: 'WO-261001-0012',
    check: '7K3F',
    action: 'DONE',
    qty_good: 480,
    qty_bad: 3,
    equipment_code: 'PRT-02',
    ...overrides,
  }
}

function okResponse(eventUuid: string): ScanResponse {
  return {
    result: 'OK',
    message: '인쇄 완료',
    wo: null,
    next_process: 'P50',
    remaining_qty: 0,
    requires_approval: false,
    approval_token: null,
    warnings: [],
    step: null,
    event_uuid: eventUuid,
    duplicate: false,
  }
}

describe('offlineQueue — write-then-send 순서', () => {
  beforeEach(async () => {
    vi.resetModules()
    // 매 테스트 새 인메모리 IndexedDB (fake-indexeddb/auto 가 전역을 깔아준다 — 여기서 리셋)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).indexedDB = new (await import('fake-indexeddb')).IDBFactory()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('submitScan 은 API 를 부르기 전에 이미 큐에 기록되어 있다 (저장 → 전송)', async () => {
    const order: string[] = []
    const { submitScan, listAll } = await import('./offlineQueue')
    const scan = await import('../api/scan')
    vi.spyOn(scan.scanApi, 'submit').mockImplementation(async () => {
      order.push('submit-called')
      const inQueueDuringSubmit = await listAll()
      expect(inQueueDuringSubmit).toHaveLength(1) // API 호출 시점에 이미 큐에 있어야 한다
      return okResponse(req.event_uuid)
    })
    const req = makeReq()
    order.push('before-submitScan')
    const outcome = await submitScan(req)
    order.push('after-submitScan')

    expect(order).toEqual(['before-submitScan', 'submit-called', 'after-submitScan'])
    expect(outcome.status).toBe('ok')
    expect(await listAll()).toHaveLength(0) // 200 응답 → 큐에서 삭제
  })

  it('result=REJECT 여도 HTTP 200 이면 큐에서 삭제한다 (업무 거부도 200)', async () => {
    const { submitScan, listAll } = await import('./offlineQueue')
    const scan = await import('../api/scan')
    const req = makeReq({ event_uuid: '22222222-2222-2222-2222-222222222222' })
    vi.spyOn(scan.scanApi, 'submit').mockResolvedValue({ ...okResponse(req.event_uuid), result: 'REJECT', message: '유효하지 않은 코드' })

    const outcome = await submitScan(req)
    expect(outcome).toMatchObject({ status: 'ok', response: { result: 'REJECT' } })
    expect(await listAll()).toHaveLength(0)
  })

  it('네트워크 오류(타임아웃 등)면 큐에 남기고 attempts 를 올린다', async () => {
    const { submitScan, listAll } = await import('./offlineQueue')
    const scan = await import('../api/scan')
    const req = makeReq({ event_uuid: '33333333-3333-3333-3333-333333333333' })
    vi.spyOn(scan.scanApi, 'submit').mockRejectedValue(new Error('network down'))

    const outcome = await submitScan(req)
    expect(outcome.status).toBe('queued')
    const all = await listAll()
    expect(all).toHaveLength(1)
    expect(all[0]?.attempts).toBe(1)
    expect(all[0]?.last_error).toBe('network down')
  })

  it('422 형식 오류는 큐에서 제거한다 (서버가 다시 받아줄 리 없다)', async () => {
    const { submitScan, listAll } = await import('./offlineQueue')
    const scan = await import('../api/scan')
    const { ApiError } = await import('../api/client')
    const req = makeReq({ event_uuid: '44444444-4444-4444-4444-444444444444' })
    vi.spyOn(scan.scanApi, 'submit').mockRejectedValue(new ApiError(422, 'VALIDATION_ERROR', '입력값을 확인하세요'))

    const outcome = await submitScan(req)
    expect(outcome.status).toBe('invalid')
    expect(await listAll()).toHaveLength(0)
  })

  it('flushQueue 는 client_seq 오름차순으로 배치 전송하고 응답에 실린 event_uuid 만 제거한다', async () => {
    const { enqueue, listAll, flushQueue } = await import('./offlineQueue')
    const scan = await import('../api/scan')

    const r1 = makeReq({ event_uuid: 'aaaaaaaa-0000-0000-0000-000000000001', client_seq: 5 })
    const r2 = makeReq({ event_uuid: 'aaaaaaaa-0000-0000-0000-000000000002', client_seq: 2 })
    await enqueue(r1)
    await enqueue(r2)

    const batchSpy = vi.spyOn(scan.scanApi, 'batch').mockImplementation(async (events) => {
      // 오름차순으로 전달돼야 한다: client_seq 2 (r2) 가 먼저
      expect(events.map((e) => e.event_uuid)).toEqual([r2.event_uuid, r1.event_uuid])
      return { results: [{ event_uuid: r2.event_uuid, response: okResponse(r2.event_uuid) }] }
    })

    const result = await flushQueue()
    expect(batchSpy).toHaveBeenCalledTimes(1)
    expect(result?.removed).toBe(1)
    const remaining = await listAll()
    expect(remaining.map((r) => r.event_uuid)).toEqual([r1.event_uuid]) // r2 만 제거됨
  })

  it('attempts >= 5 인 건은 flush 대상에서 제외하지만 큐에서 지우지 않는다', async () => {
    const { enqueue, listAll, flushQueue } = await import('./offlineQueue')
    const db = await import('./db')
    const scan = await import('../api/scan')

    const req = makeReq({ event_uuid: 'bbbbbbbb-0000-0000-0000-000000000001' })
    await enqueue(req)
    const handle = await db.getDb()
    const rec = await handle.get('pending_scans', req.event_uuid)
    if (rec) {
      rec.attempts = 5
      await handle.put('pending_scans', rec)
    }

    const batchSpy = vi.spyOn(scan.scanApi, 'batch').mockResolvedValue({ results: [] })
    const result = await flushQueue()
    expect(batchSpy).not.toHaveBeenCalled() // 보낼 활성 건이 없다
    expect(result?.attempted).toBe(0)
    expect(await listAll()).toHaveLength(1) // 그래도 지워지지 않는다 (유실 금지)
  })
})

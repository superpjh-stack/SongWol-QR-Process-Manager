import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildBoxRow,
  buildMapScanRequest,
  buildOfflineBoxRow,
  buildReceiveScanRequest,
  buildShipScanRequest,
  estimateReceiveReconcile,
  isBoxAlreadyShipped,
  isWoBlockedForReceive,
  readRecentCarriers,
  rememberCarrier,
} from './pdaLogic'
import type { PackBoxDetail } from '../shared/types'

describe('estimateReceiveReconcile (PDA-12 사전 판정, 오차 미적용)', () => {
  it('누계가 지시수량보다 적으면 PARTIAL', () => {
    expect(estimateReceiveReconcile(500, 0, 300)).toBe('PARTIAL')
  })
  it('누계가 지시수량과 같으면 FULL', () => {
    expect(estimateReceiveReconcile(500, 300, 200)).toBe('FULL')
  })
  it('누계가 지시수량을 넘으면 OVER', () => {
    expect(estimateReceiveReconcile(500, 480, 30)).toBe('OVER')
  })
})

describe('isWoBlockedForReceive (PDA-12)', () => {
  it('CANCELLED/CLOSED/ON_HOLD 는 막는다', () => {
    expect(isWoBlockedForReceive('CANCELLED')).toBe(true)
    expect(isWoBlockedForReceive('CLOSED')).toBe(true)
    expect(isWoBlockedForReceive('ON_HOLD')).toBe(true)
  })
  it('ISSUED/IN_PROGRESS 는 막지 않는다', () => {
    expect(isWoBlockedForReceive('ISSUED')).toBe(false)
    expect(isWoBlockedForReceive('IN_PROGRESS')).toBe(false)
  })
})

describe('buildReceiveScanRequest', () => {
  it('action=RECEIVE, qty_good=입고수량. 박스수 없으면 qty_box 를 싣지 않는다', () => {
    const req = buildReceiveScanRequest({
      stationId: 'K-P20-1',
      workerCard: 'US-0007',
      code: 'WO-261001-0012',
      check: '7K3F',
      qty: 300,
      boxCount: null,
      inspection: 'PASS',
      inputVia: 'HID',
      eventUuid: 'e1',
      clientSeq: 1,
      scannedAt: '2026-10-01T09:12:03+09:00',
    })
    expect(req.action).toBe('RECEIVE')
    expect(req.qty_good).toBe(300)
    expect(req.qty_box).toBeUndefined()
    expect(req.extra).toEqual({ inspection: 'PASS' })
  })

  it('박스수·협력업체명·사유가 있으면 함께 싣는다', () => {
    const req = buildReceiveScanRequest({
      stationId: 'K-P20-1',
      workerCard: 'US-0007',
      code: '8801234567890',
      check: null,
      qty: 520,
      boxCount: 10,
      inspection: 'COND',
      vendor: '협력사A',
      varianceReason: '지시수량 초과',
      inputVia: 'MANUAL',
      eventUuid: 'e2',
      clientSeq: 2,
    })
    expect(req.qty_box).toBe(10)
    expect(req.extra).toEqual({ inspection: 'COND', vendor: '협력사A', variance_reason: '지시수량 초과' })
  })
})

describe('buildMapScanRequest', () => {
  it('action=MAP, code=바코드(check 없음), extra.wo_code', () => {
    const req = buildMapScanRequest({
      stationId: 'K-P20-1',
      workerCard: 'US-0007',
      barcode: '8801234567890',
      woCode: 'WO-261001-0012',
      inputVia: 'HID',
      eventUuid: 'e3',
      clientSeq: 3,
    })
    expect(req.action).toBe('MAP')
    expect(req.code).toBe('8801234567890')
    expect(req.check).toBeNull()
    expect(req.extra).toEqual({ wo_code: 'WO-261001-0012' })
  })
})

describe('buildShipScanRequest', () => {
  it('action=SHIP, code=박스코드, extra.tracking_no', () => {
    const req = buildShipScanRequest({
      stationId: 'K-P60-1',
      workerCard: 'US-0007',
      boxCode: 'LT-261001-0003',
      check: '7K3F',
      trackingNo: '123456789012',
      carrier: 'CJ대한통운',
      inputVia: 'HID',
      eventUuid: 'e4',
      clientSeq: 4,
    })
    expect(req.action).toBe('SHIP')
    expect(req.code).toBe('LT-261001-0003')
    expect(req.extra).toEqual({ tracking_no: '123456789012', carrier: 'CJ대한통운' })
  })
})

function boxDetail(overrides: Partial<PackBoxDetail> = {}): PackBoxDetail {
  return {
    kind: 'PACK',
    id: 1,
    code: 'LT-261001-0003',
    wo_code: 'WO-261001-0012',
    box_no: 1,
    qty: 50,
    packed_at: '2026-10-01T09:00:00+09:00',
    shipment_id: null,
    wo: {
      id: 1,
      code: 'WO-261001-0012',
      so_code: 'SO-261001-0003',
      customer_name: '거래처',
      item: { id: 1, code: 'IT-1', name: '수건', spec: '40x80', color: '화이트' },
      print_method: 'SCREEN',
      qty_ordered: 500,
      qty_received: 500,
      qty_good: 480,
      qty_bad: 0,
      qty_packed: 480,
      qty_shipped: 0,
      receipt_status: 'FULL',
      status: 'PACKED',
      current_step_seq: 4,
      current_process_code: 'P60',
      due_date: '2026-10-05',
      delay_risk: false,
      design_version: 1,
      design_thumbnail_url: null,
      parent_wo_code: null,
      split_suffix: null,
      issued_at: '2026-09-25T00:00:00+09:00',
    },
    worker: { id: 1, login_id: 'w1', name: '작업자', role: 'WORKER', card_code: 'US-0007' },
    shipment: null,
    ...overrides,
  }
}

describe('buildBoxRow (PDA-20)', () => {
  it('같은 SO 면 status=ok', () => {
    const row = buildBoxRow(boxDetail(), 'SO-261001-0003')
    expect(row).toMatchObject({ id: 'LT-261001-0003', code: 'LT-261001-0003', woCode: 'WO-261001-0012', boxNo: 1, qty: 50, status: 'ok' })
  })
  it('다른 SO 면 status=warn + 안내 문구', () => {
    const row = buildBoxRow(boxDetail(), 'SO-261001-0099')
    expect(row.status).toBe('warn')
    expect(row.note).toContain('SO-261001-0003')
  })
  it('첫 스캔(currentSoCode=null)은 항상 ok', () => {
    expect(buildBoxRow(boxDetail(), null).status).toBe('ok')
  })
})

describe('buildOfflineBoxRow', () => {
  it('코드만 채우고 나머지는 null, status=offline', () => {
    expect(buildOfflineBoxRow('LT-261001-0003')).toEqual({
      id: 'LT-261001-0003',
      code: 'LT-261001-0003',
      woCode: null,
      boxNo: null,
      qty: null,
      customerName: null,
      status: 'offline',
    })
  })
})

describe('readRecentCarriers / rememberCarrier', () => {
  beforeEach(() => localStorage.clear())

  it('저장 전에는 빈 배열', () => {
    expect(readRecentCarriers()).toEqual([])
  })
  it('가장 최근 것이 앞에 온다', () => {
    rememberCarrier('CJ대한통운')
    rememberCarrier('한진택배')
    expect(readRecentCarriers()).toEqual(['한진택배', 'CJ대한통운'])
  })
  it('같은 택배사를 다시 쓰면 맨 앞으로 옮긴다(중복 없음)', () => {
    rememberCarrier('CJ대한통운')
    rememberCarrier('한진택배')
    rememberCarrier('CJ대한통운')
    expect(readRecentCarriers()).toEqual(['CJ대한통운', '한진택배'])
  })
  it('최대 5개까지만 남긴다', () => {
    for (const c of ['a', 'b', 'c', 'd', 'e', 'f']) rememberCarrier(c)
    expect(readRecentCarriers()).toEqual(['f', 'e', 'd', 'c', 'b'])
  })
})

describe('isBoxAlreadyShipped', () => {
  it('shipment 가 null 이 아니면 true(상태와 무관)', () => {
    expect(isBoxAlreadyShipped(boxDetail({ shipment: { id: 1, so_code: 'SO-261001-0003', customer_name: '거래처', carrier: null, tracking_no: '123', status: 'READY', shipped_at: null, qty_total: 50, box_count: 1 } }))).toBe(true)
  })
  it('shipment 가 null 이면 false', () => {
    expect(isBoxAlreadyShipped(boxDetail())).toBe(false)
  })
})

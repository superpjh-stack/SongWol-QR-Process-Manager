import { beforeEach, describe, expect, it } from 'vitest'
import { buildPackScanRequest, computeDefaultQtyBox, p30NotDoneStatus, packRemainingQty, readRememberedPackQtyBox, rememberPackQtyBox } from './packLogic'
import type { RouteStep, WorkOrderDetail } from '../shared/types'

function step(overrides: Partial<RouteStep>): RouteStep {
  return {
    id: 1,
    seq: 2,
    process_code: 'P30',
    process_name: '인쇄',
    std_lead_hours: 4,
    tolerance_pct: 5,
    status: 'WAITING',
    started_at: null,
    done_at: null,
    qty_in: null,
    qty_good: null,
    qty_bad: null,
    equipment: null,
    worker: null,
    is_estimated: false,
    approved_by: null,
    variance_reason: null,
    works: [],
    ...overrides,
  }
}

function wo(steps: RouteStep[], qtyGood = 480, qtyPacked = 0): WorkOrderDetail {
  return {
    id: 1,
    code: 'WO-261001-0012',
    so_code: 'SO-261001-0003',
    customer_name: '거래처',
    item: { id: 1, code: 'IT-1', name: '수건', spec: '40x80', color: '화이트' },
    print_method: 'SCREEN',
    qty_ordered: 500,
    qty_received: 500,
    qty_good: qtyGood,
    qty_bad: 0,
    qty_packed: qtyPacked,
    qty_shipped: 0,
    receipt_status: 'FULL',
    status: 'IN_PROGRESS',
    current_step_seq: 3,
    current_process_code: 'P50',
    due_date: '2026-10-05',
    delay_risk: false,
    design_version: 1,
    design_thumbnail_url: null,
    parent_wo_code: null,
    split_suffix: null,
    issued_at: '2026-09-25T00:00:00+09:00',
    steps,
    hold_reason: null,
    closed_at: null,
    recent_events: [],
    boxes: [],
    receipts: [],
    children: [],
  }
}

describe('packRemainingQty (KSK-80 남은 수량)', () => {
  it('양품 − 포장 누계', () => {
    expect(packRemainingQty({ qty_good: 480, qty_packed: 200 })).toBe(280)
  })
  it('음수로 내려가지 않는다', () => {
    expect(packRemainingQty({ qty_good: 480, qty_packed: 480 })).toBe(0)
    expect(packRemainingQty({ qty_good: 480, qty_packed: 500 })).toBe(0)
  })
})

describe('p30NotDoneStatus (KSK-80 인쇄 미완료 예고)', () => {
  it('P30 이 DONE 이면 null(예고 없음)', () => {
    expect(p30NotDoneStatus(wo([step({ status: 'DONE' })]))).toBeNull()
  })
  it('P30 이 DONE_ESTIMATED·SKIPPED 여도 예고 없음', () => {
    expect(p30NotDoneStatus(wo([step({ status: 'DONE_ESTIMATED' })]))).toBeNull()
    expect(p30NotDoneStatus(wo([step({ status: 'SKIPPED' })]))).toBeNull()
  })
  it('P30 이 WAITING/STARTED/PARTIAL 이면 그 status 를 반환한다', () => {
    expect(p30NotDoneStatus(wo([step({ status: 'WAITING' })]))).toBe('WAITING')
    expect(p30NotDoneStatus(wo([step({ status: 'STARTED' })]))).toBe('STARTED')
    expect(p30NotDoneStatus(wo([step({ status: 'PARTIAL' })]))).toBe('PARTIAL')
  })
  it('라우팅에 P30 자체가 없으면 null(무가공 등)', () => {
    expect(p30NotDoneStatus(wo([step({ process_code: 'P50', process_name: '포장' })]))).toBeNull()
  })
})

describe('computeDefaultQtyBox (KSK-80 기본값)', () => {
  it('남은 수량이 0 이면 null(입력 비활성)', () => {
    expect(computeDefaultQtyBox(50, 0)).toBeNull()
    expect(computeDefaultQtyBox(null, 0)).toBeNull()
  })
  it('기억된 값이 없으면 남은 수량 그대로', () => {
    expect(computeDefaultQtyBox(null, 280)).toBe(280)
  })
  it('기억된 값이 남은 수량보다 작으면 기억된 값', () => {
    expect(computeDefaultQtyBox(50, 280)).toBe(50)
  })
  it('기억된 값이 남은 수량보다 크면 남은 수량으로 상한', () => {
    expect(computeDefaultQtyBox(300, 280)).toBe(280)
  })
})

describe('readRememberedPackQtyBox / rememberPackQtyBox', () => {
  beforeEach(() => localStorage.clear())

  it('저장 전에는 null', () => {
    expect(readRememberedPackQtyBox('K-P50-1')).toBeNull()
  })
  it('저장한 값을 그대로 읽는다', () => {
    rememberPackQtyBox('K-P50-1', 50)
    expect(readRememberedPackQtyBox('K-P50-1')).toBe(50)
  })
  it('단말별로 분리된다', () => {
    rememberPackQtyBox('K-P50-1', 50)
    rememberPackQtyBox('K-P50-2', 24)
    expect(readRememberedPackQtyBox('K-P50-1')).toBe(50)
    expect(readRememberedPackQtyBox('K-P50-2')).toBe(24)
  })
})

describe('buildPackScanRequest', () => {
  it('action=PACK, qty_box 를 싣고 equipment_code·qty_good 은 없다', () => {
    const req = buildPackScanRequest({
      stationId: 'K-P50-1',
      workerCard: 'US-0007',
      code: 'WO-261001-0012',
      check: '7K3F',
      qtyBox: 50,
      inputVia: 'HID',
      eventUuid: 'e1',
      clientSeq: 1,
      scannedAt: '2026-10-01T09:12:03+09:00',
    })
    expect(req.action).toBe('PACK')
    expect(req.qty_box).toBe(50)
    expect(req.equipment_code).toBeUndefined()
    expect(req.qty_good).toBeUndefined()
    expect(req.extra).toBeUndefined()
  })
})

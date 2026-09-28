import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildPackScanRequest,
  computeDefaultQtyBox,
  p30NotDoneStatus,
  packConfirmationsFromFlush,
  packRemainingQty,
  readRememberedPackQtyBox,
  rememberPackQtyBox,
  type PackFlushEntry,
} from './packLogic'
import type { RouteStep, ScanResponse, WorkOrderDetail } from '../shared/types'

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

describe('packConfirmationsFromFlush (오프라인 포장 flush → 라벨 부착 확인 목록, §13.7 ⑬)', () => {
  function packResponse(overrides: Partial<ScanResponse> = {}): ScanResponse {
    return {
      result: 'OK',
      message: '포장 완료했습니다',
      wo: null,
      next_process: null,
      remaining_qty: 220,
      requires_approval: false,
      approval_token: null,
      warnings: [],
      step: null,
      event_uuid: 'e1',
      duplicate: false,
      box: { kind: 'PACK', id: 1, code: 'LT-261001-0007', wo_code: 'WO-261001-0012', box_no: 3, qty: 60, packed_at: '2026-10-01T09:00:00+09:00', shipment_id: null },
      label_job: { issue_no: 1, label_type: 'BOX_LABEL', printer_id: 'LP-PACK-1', copies: 1, sent_at: '2026-10-01T09:00:01+09:00', pdf_url: null, zpl_sent: true, error: null },
      ...overrides,
    }
  }

  function entry(overrides: Partial<PackFlushEntry> = {}): PackFlushEntry {
    return { event_uuid: 'e1', client_seq: 5, response: packResponse(), at: '2026-10-01T09:05:00+09:00', ...overrides }
  }

  it('box 가 있는 응답을 확인 목록 행으로 바꾼다 — n 은 client_seq, 라벨에 인쇄되는 값과 같다', () => {
    const rows = packConfirmationsFromFlush([entry()])
    expect(rows).toEqual([
      {
        id: 'e1',
        n: 5,
        woCode: 'WO-261001-0012',
        boxCode: 'LT-261001-0007',
        boxNo: 3,
        qty: 60,
        labelJob: packResponse().label_job,
        at: '2026-10-01T09:05:00+09:00',
      },
    ])
  })

  it('box 가 없는 응답(다른 액션·박스 미생성 REJECT)은 제외한다', () => {
    const noBoxResponse: ScanResponse = {
      result: 'REJECT',
      message: '유효하지 않은 코드',
      wo: null,
      next_process: null,
      remaining_qty: null,
      requires_approval: false,
      approval_token: null,
      warnings: [],
      step: null,
      event_uuid: 'e2',
      duplicate: false,
    }
    const rows = packConfirmationsFromFlush([entry({ event_uuid: 'e2', response: noBoxResponse })])
    expect(rows).toEqual([])
  })

  it('라벨 출력 실패(zpl_sent=false) 여도 박스는 목록에 남는다 — [재출력] 은 화면이 붙인다', () => {
    const rows = packConfirmationsFromFlush([
      entry({ response: packResponse({ result: 'WARN', label_job: { issue_no: 1, label_type: 'BOX_LABEL', printer_id: null, copies: 1, sent_at: null, pdf_url: null, zpl_sent: false, error: 'PRINTER_UNREACHABLE' } }) }),
    ])
    expect(rows[0]?.labelJob?.zpl_sent).toBe(false)
    expect(rows[0]?.labelJob?.error).toBe('PRINTER_UNREACHABLE')
  })

  it('duplicate=true 여도 거르지 않는다 — 이전 시도가 타임아웃돼 한 번도 못 본 확인일 수 있다(조용한 실패 금지)', () => {
    const rows = packConfirmationsFromFlush([entry({ response: packResponse({ duplicate: true }) })])
    expect(rows).toHaveLength(1)
  })

  it('여러 건을 #n(client_seq) 오름차순으로 정렬한다 — 서버 flush 응답 순서와 무관하게', () => {
    const rows = packConfirmationsFromFlush([
      entry({ event_uuid: 'c', client_seq: 9, response: packResponse({ event_uuid: 'c', box: { kind: 'PACK', id: 3, code: 'LT-3', wo_code: 'WO-1', box_no: 3, qty: 10, packed_at: 'x', shipment_id: null } }) }),
      entry({ event_uuid: 'a', client_seq: 3, response: packResponse({ event_uuid: 'a', box: { kind: 'PACK', id: 1, code: 'LT-1', wo_code: 'WO-1', box_no: 1, qty: 10, packed_at: 'x', shipment_id: null } }) }),
      entry({ event_uuid: 'b', client_seq: 6, response: packResponse({ event_uuid: 'b', box: { kind: 'PACK', id: 2, code: 'LT-2', wo_code: 'WO-1', box_no: 2, qty: 10, packed_at: 'x', shipment_id: null } }) }),
    ])
    expect(rows.map((r) => r.n)).toEqual([3, 6, 9])
    expect(rows.map((r) => r.boxCode)).toEqual(['LT-1', 'LT-2', 'LT-3'])
  })
})

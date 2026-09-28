import { describe, expect, it } from 'vitest'
import { autoDismissMsFor, buildDoneScanRequest, defaultGoodQty, isToleranceExceeded, isWoStatusBlocked, nowKstIso, scanResultVariant } from './kioskLogic'
import type { RouteStep, WorkOrderDetail } from '../shared/types'

function step(overrides: Partial<RouteStep>): RouteStep {
  return {
    id: 1,
    seq: 3,
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

function wo(steps: RouteStep[], qtyReceived = 0): WorkOrderDetail {
  return {
    id: 1,
    code: 'WO-261001-0012',
    so_code: 'SO-261001-0003',
    customer_name: '거래처',
    item: { id: 1, code: 'IT-1', name: '수건', spec: '40x80', color: '화이트' },
    print_method: 'SCREEN',
    qty_ordered: 500,
    qty_received: qtyReceived,
    qty_good: 0,
    qty_bad: 0,
    qty_packed: 0,
    qty_shipped: 0,
    receipt_status: 'FULL',
    status: 'IN_PROGRESS',
    current_step_seq: 3,
    current_process_code: 'P30',
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

describe('isToleranceExceeded (api-contract §6.2)', () => {
  it('qtyIn 을 모르면(오프라인) 판정하지 않고 null 을 반환한다', () => {
    expect(isToleranceExceeded(null, 5, 480, 3)).toBeNull()
    expect(isToleranceExceeded(undefined, 5, 480, 3)).toBeNull()
  })

  it('허용오차 이내면 false', () => {
    // qtyIn=500, tol=5% → 허용 ±25. good+bad=483, diff=17 ≤ 25
    expect(isToleranceExceeded(500, 5, 480, 3)).toBe(false)
  })

  it('허용오차 경계값(=)은 통과(false)', () => {
    // diff 정확히 25
    expect(isToleranceExceeded(500, 5, 475, 0)).toBe(false)
  })

  it('허용오차 초과면 true → KSK-31 로 분기', () => {
    // diff=30 > 25
    expect(isToleranceExceeded(500, 5, 470, 0)).toBe(true)
  })
})

describe('defaultGoodQty (KSK-30 기본값 우선순위)', () => {
  it('steps[P30].qty_in 이 있으면 그 값', () => {
    const w = wo([step({ process_code: 'P30', qty_in: 500 })])
    expect(defaultGoodQty(w, 'P30')).toBe(500)
  })

  it('PARTIAL 재스캔이면 잔량(qty_in - (good+bad))', () => {
    const w = wo([step({ process_code: 'P30', status: 'PARTIAL', qty_in: 500, qty_good: 300, qty_bad: 20 })])
    expect(defaultGoodQty(w, 'P30')).toBe(180)
  })

  it('PARTIAL 잔량은 음수로 내려가지 않는다', () => {
    const w = wo([step({ process_code: 'P30', status: 'PARTIAL', qty_in: 100, qty_good: 90, qty_bad: 20 })])
    expect(defaultGoodQty(w, 'P30')).toBe(0)
  })

  it('qty_in 이 없으면 직전 단계 qty_good 을 쓴다', () => {
    const w = wo([step({ process_code: 'P20', qty_in: 500, qty_good: 483 }), step({ process_code: 'P30', qty_in: null })])
    expect(defaultGoodQty(w, 'P30')).toBe(483)
  })

  it('직전 단계도 없으면 wo.qty_received 로 폴백한다', () => {
    const w = wo([step({ process_code: 'P30', qty_in: null })], 483)
    expect(defaultGoodQty(w, 'P30')).toBe(483)
  })

  it('아무 것도 없으면 null (빈칸, 입력 필수)', () => {
    const w = wo([step({ process_code: 'P30', qty_in: null })], 0)
    // qty_received=0 은 falsy 값이 아니라 명시적 0 이므로 그대로 0 을 반환한다 (참값)
    expect(defaultGoodQty(w, 'P30')).toBe(0)
  })
})

describe('scanResultVariant / autoDismissMsFor (§0.7)', () => {
  it('OK → ok, 2초 자동 닫힘', () => {
    expect(scanResultVariant({ result: 'OK', requires_approval: false })).toBe('ok')
    expect(autoDismissMsFor('ok')).toBe(2000)
  })
  it('WARN + requires_approval=false → warn, 탭까지 유지', () => {
    expect(scanResultVariant({ result: 'WARN', requires_approval: false })).toBe('warn')
    expect(autoDismissMsFor('warn')).toBeUndefined()
  })
  it('WARN + requires_approval=true → approval (KSK-60 승인 화면)', () => {
    expect(scanResultVariant({ result: 'WARN', requires_approval: true })).toBe('approval')
  })
  it('REJECT → reject, 탭까지 유지', () => {
    expect(scanResultVariant({ result: 'REJECT', requires_approval: false })).toBe('reject')
    expect(autoDismissMsFor('reject')).toBeUndefined()
  })
  it('saved(오프라인 저장) → 2초 자동 닫힘', () => {
    expect(autoDismissMsFor('saved')).toBe(2000)
  })
})

describe('isWoStatusBlocked', () => {
  it('CANCELLED/CLOSED/ON_HOLD/DRAFT 는 막는다', () => {
    for (const s of ['CANCELLED', 'CLOSED', 'ON_HOLD', 'DRAFT']) expect(isWoStatusBlocked(s)).toBe(true)
  })
  it('ISSUED/IN_PROGRESS 는 막지 않는다', () => {
    expect(isWoStatusBlocked('ISSUED')).toBe(false)
    expect(isWoStatusBlocked('IN_PROGRESS')).toBe(false)
  })
})

describe('nowKstIso', () => {
  it('+09:00 오프셋으로 같은 절대 시각을 표현한다', () => {
    const d = new Date('2026-01-01T00:30:00.000Z') // UTC 00:30 → KST 09:30
    const iso = nowKstIso(d)
    expect(iso).toBe('2026-01-01T09:30:00.000+09:00')
    expect(new Date(iso).getTime()).toBe(d.getTime()) // 절대 시각은 동일
  })
})

describe('buildDoneScanRequest', () => {
  it('사유가 없으면 extra 를 만들지 않는다', () => {
    const req = buildDoneScanRequest({
      stationId: 'K-P30-1',
      workerCard: 'US-0007',
      code: 'WO-261001-0012',
      check: '7K3F',
      equipmentCode: 'PRT-02',
      qtyGood: 480,
      qtyBad: 3,
      inputVia: 'HID',
      eventUuid: 'e1',
      clientSeq: 1,
      scannedAt: '2026-10-01T09:12:03+09:00',
    })
    expect(req.action).toBe('DONE')
    expect(req.extra).toBeUndefined()
    expect(req.input_via).toBe('HID')
  })

  it('사유가 있으면 extra.variance_reason_code/variance_reason 을 싣는다', () => {
    const req = buildDoneScanRequest({
      stationId: 'K-P30-1',
      workerCard: 'US-0007',
      code: 'WO-261001-0012',
      check: null,
      equipmentCode: 'PRT-02',
      qtyGood: 470,
      qtyBad: 0,
      varianceReasonCode: 'OTHER',
      varianceReasonText: '재단 손실',
      inputVia: 'MANUAL',
      eventUuid: 'e2',
      clientSeq: 2,
    })
    expect(req.extra).toEqual({ variance_reason_code: 'OTHER', variance_reason: '재단 손실' })
    expect(req.input_via).toBe('MANUAL')
  })
})

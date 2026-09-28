/**
 * P50 포장 키오스크(KSK-80·KSK-81)의 순수 로직 (screens-shopfloor §1 KSK-80/81). `kioskLogic.ts` 와 같은
 * 원칙 — API 호출·React 상태와 분리해 테스트 가능하게 둔다. `KioskSession.tsx` 가 `station.process_code
 * === 'P50'` 일 때 이 함수들을 부수효과에 연결한다.
 */
import { nowKstIso } from '../shared/scanUtil'
import type { InputVia, ScanRequest, StepStatus, WorkOrderDetail } from '../shared/types'

/** KSK-80 「양품 − 포장 누계」— 음수로 내려가지 않는다 (spec §1 KSK-80 「남은 수량」) */
export function packRemainingQty(wo: Pick<WorkOrderDetail, 'qty_good' | 'qty_packed'>): number {
  return Math.max(wo.qty_good - wo.qty_packed, 0)
}

/** P30 이 완료 상태가 아니면 그 status 를 반환(예고 배너용), 완료/생략이면 null. P30 단계가 라우팅에 없으면 null */
export function p30NotDoneStatus(wo: WorkOrderDetail): StepStatus | null {
  const p30 = wo.steps.find((s) => s.process_code === 'P30')
  if (!p30) return null
  if (p30.status === 'DONE' || p30.status === 'DONE_ESTIMATED' || p30.status === 'SKIPPED') return null
  return p30.status
}

const LAST_QTY_BOX_PREFIX = 'sw.pack.lastQtyBox.'

/** 이 단말의 마지막 박스당 입수 입력값 (KSK-80 기본값, §1 KSK-80 "이 단말의 마지막 입력값") */
export function readRememberedPackQtyBox(stationId: string): number | null {
  try {
    const raw = localStorage.getItem(LAST_QTY_BOX_PREFIX + stationId)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

export function rememberPackQtyBox(stationId: string, qty: number): void {
  try {
    localStorage.setItem(LAST_QTY_BOX_PREFIX + stationId, String(qty))
  } catch {
    // 저장 실패는 UX 편의 기능이라 조용히 넘긴다(EquipmentPicker 의 rememberEquipment 와 같은 원칙)
  }
}

/**
 * KSK-80 기본값 = 이 단말의 마지막 입력값을 「남은 수량」으로 상한한다. 남은 수량이 0 이면 null(입력 비활성).
 * 기억된 값이 없으면 남은 수량 그대로(처음 포장하는 단말은 "일단 전량"이 합리적인 기본값 — 기본값(제안)).
 */
export function computeDefaultQtyBox(remembered: number | null, remaining: number): number | null {
  if (remaining <= 0) return null
  if (remembered === null) return remaining
  return Math.min(remembered, remaining)
}

export type BuildPackRequestInput = {
  stationId: string
  workerCard: string
  code: string
  check: string | null
  qtyBox: number
  inputVia: InputVia
  eventUuid: string
  clientSeq: number
  scannedAt?: string
}

/** KSK-40 경로로 보내는 `action=PACK` 요청 조립 (api-contract §5.2 5-PACK). 프린터는 `station.printer_id` 를
 * 서버가 station_id 로 찾으므로 `extra.printer_id` 를 싣지 않는다(§13.5 ② — REPRINT 전용으로만 명시된 필드) */
export function buildPackScanRequest(input: BuildPackRequestInput): ScanRequest {
  return {
    event_uuid: input.eventUuid,
    scanned_at: input.scannedAt ?? nowKstIso(),
    station_id: input.stationId,
    worker_card: input.workerCard,
    code: input.code,
    check: input.check,
    action: 'PACK',
    qty_box: input.qtyBox,
    client_seq: input.clientSeq,
    input_via: input.inputVia,
  }
}

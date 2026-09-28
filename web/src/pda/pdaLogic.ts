/**
 * PDA(P20 입고 · P60 발송)의 순수 로직 (screens-shopfloor §2 PDA-10~22). `kiosk/kioskLogic.ts`·
 * `kiosk/packLogic.ts` 와 같은 원칙 — API 호출·React 상태와 분리해 테스트 가능하게 둔다.
 */
import { nowKstIso } from '../shared/scanUtil'
import type { InputVia, Inspection, PackBoxDetail, ScanExtra, ScanRequest, WoStatus } from '../shared/types'
import type { ScanListRow } from '../shared/ui/shopfloor'

/** PDA-12/13 「입고 후 누계 → PARTIAL/FULL/OVER」 표시용 3단계(NONE 은 입고 화면에서 나오지 않는다) */
export type ReceiveReconcile = 'PARTIAL' | 'FULL' | 'OVER'

/**
 * PDA-12 사전 판정(예상) — 오차 미적용, `remaining = ordered − projected`. `WorkOrderDetail.item` 에
 * `qty_tolerance_pct` 가 없어(§5 ⑯) 정확한 판정은 서버(PDA-13 의 `wo.receipt_status`)만 할 수 있다 —
 * 이 함수는 화면이 "(예상)" 문구와 함께 미리 보여주는 값만 만든다.
 */
export function estimateReceiveReconcile(qtyOrdered: number, qtyReceivedSoFar: number, enteredQty: number): ReceiveReconcile {
  const projected = qtyReceivedSoFar + enteredQty
  if (projected < qtyOrdered) return 'PARTIAL'
  if (projected === qtyOrdered) return 'FULL'
  return 'OVER'
}

/** PDA-12 · KSK-20 과 같은 예고 규칙 — 이 상태의 WO 는 입고할 수 없다(§2 PDA-12) */
export function isWoBlockedForReceive(status: WoStatus): boolean {
  return status === 'CANCELLED' || status === 'CLOSED' || status === 'ON_HOLD'
}

export type BuildReceiveInput = {
  stationId: string
  workerCard: string
  /** WO 코드 또는 매핑된 업체 바코드 원문(check 없음) — §2 PDA-12 "RECEIVE 는 qty_good = 입고수량" */
  code: string
  check: string | null
  qty: number
  boxCount: number | null
  inspection: Inspection
  vendor?: string | null
  varianceReason?: string | null
  inputVia: InputVia
  eventUuid: string
  clientSeq: number
  scannedAt?: string
}

/** PDA-12 [입고 확정] → `POST /scan {action:"RECEIVE", qty_good, qty_box, extra:{inspection,…}}` (api-contract §5.4) */
export function buildReceiveScanRequest(input: BuildReceiveInput): ScanRequest {
  const extra: ScanExtra = { inspection: input.inspection }
  if (input.vendor) extra.vendor = input.vendor
  if (input.varianceReason) extra.variance_reason = input.varianceReason
  return {
    event_uuid: input.eventUuid,
    scanned_at: input.scannedAt ?? nowKstIso(),
    station_id: input.stationId,
    worker_card: input.workerCard,
    code: input.code,
    check: input.check,
    action: 'RECEIVE',
    qty_good: input.qty,
    ...(input.boxCount !== null ? { qty_box: input.boxCount } : {}),
    extra,
    client_seq: input.clientSeq,
    input_via: input.inputVia,
  }
}

export type BuildMapInput = {
  stationId: string
  workerCard: string
  /** 업체 바코드 원문 (check 없음) */
  barcode: string
  woCode: string
  inputVia: InputVia
  eventUuid: string
  clientSeq: number
  scannedAt?: string
}

/** PDA-11 [매핑 저장] → `POST /scan {action:"MAP", code:바코드, extra:{wo_code}}` (api-contract §5.2 5-MAP) */
export function buildMapScanRequest(input: BuildMapInput): ScanRequest {
  return {
    event_uuid: input.eventUuid,
    scanned_at: input.scannedAt ?? nowKstIso(),
    station_id: input.stationId,
    worker_card: input.workerCard,
    code: input.barcode,
    check: null,
    action: 'MAP',
    extra: { wo_code: input.woCode },
    client_seq: input.clientSeq,
    input_via: input.inputVia,
  }
}

export type BuildShipInput = {
  stationId: string
  workerCard: string
  /** 박스 LOT 코드 */
  boxCode: string
  check: string | null
  trackingNo: string
  carrier?: string | null
  inputVia: InputVia
  eventUuid: string
  clientSeq: number
  scannedAt?: string
}

/** PDA-21 [발송 확정] — 박스 1개당 SHIP 이벤트 1건 (api-contract §5.2 5-SHIP, §5.4) */
export function buildShipScanRequest(input: BuildShipInput): ScanRequest {
  const extra: ScanExtra = { tracking_no: input.trackingNo }
  if (input.carrier) extra.carrier = input.carrier
  return {
    event_uuid: input.eventUuid,
    scanned_at: input.scannedAt ?? nowKstIso(),
    station_id: input.stationId,
    worker_card: input.workerCard,
    code: input.boxCode,
    check: input.check,
    action: 'SHIP',
    extra,
    client_seq: input.clientSeq,
    input_via: input.inputVia,
  }
}

/** PDA-20 박스 QR 조회 결과 → `ScanList` 행. 다른 SO 의 박스면 경고(막지 않는다, §2 PDA-20) */
export function buildBoxRow(detail: PackBoxDetail, currentSoCode: string | null): ScanListRow {
  const warn = currentSoCode !== null && detail.wo.so_code !== currentSoCode
  return {
    id: detail.code,
    code: detail.code,
    woCode: detail.wo_code,
    boxNo: detail.box_no,
    qty: detail.qty,
    customerName: detail.wo.customer_name,
    status: warn ? 'warn' : 'ok',
    note: warn ? `다른 수주(${detail.wo.so_code})의 박스입니다 — 송장이 분리됩니다` : null,
  }
}

/** 오프라인이라 박스 조회 자체가 안 될 때(§2 PDA-20 오프라인) 코드만으로 채우는 행 */
export function buildOfflineBoxRow(code: string): ScanListRow {
  return { id: code, code, woCode: null, boxNo: null, qty: null, customerName: null, status: 'offline' }
}

/** 이미 발송된 박스(`shipment` 가 있으면 상태와 무관하게 이미 SHIP 이벤트가 붙은 것) — 목록에 넣지 않는다 */
export function isBoxAlreadyShipped(detail: PackBoxDetail): boolean {
  return detail.shipment !== null
}

const RECENT_CARRIERS_KEY = 'sw.ship.recentCarriers'
const RECENT_CARRIERS_MAX = 5

/** PDA-21 택배사 칩 — 기준정보가 없어(§5 ⑲) 최근 사용 5개를 단말 로컬에 기억한다(기본값) */
export function readRecentCarriers(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_CARRIERS_KEY)
    if (!raw) return []
    const arr: unknown = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((v): v is string => typeof v === 'string').slice(0, RECENT_CARRIERS_MAX) : []
  } catch {
    return []
  }
}

export function rememberCarrier(carrier: string): void {
  try {
    const next = [carrier, ...readRecentCarriers().filter((c) => c !== carrier)].slice(0, RECENT_CARRIERS_MAX)
    localStorage.setItem(RECENT_CARRIERS_KEY, JSON.stringify(next))
  } catch {
    // UX 편의 기능 — 저장 실패해도 발송 자체는 계속된다
  }
}

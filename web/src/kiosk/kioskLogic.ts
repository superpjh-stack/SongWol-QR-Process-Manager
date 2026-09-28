/**
 * 키오스크 상태 머신의 순수 로직 (screens-shopfloor §1.0 · KSK-20·30·31·40·50). API 호출·React 상태와
 * 분리해 테스트 가능하게 뒀다 — `KioskSession.tsx` 가 이 함수들을 부수효과에 연결한다.
 */
import type { InputVia, RouteStep, ScanExtra, ScanRequest, ScanResponse, VarianceReasonCode, WorkOrderDetail } from '../shared/types'
import type { ScanResultVariant } from '../shared/ui/shopfloor'

/** 현재 시각을 `+09:00` 오프셋의 ISO 8601 로 (api-contract §5.1 `scanned_at`, KST 는 DST 없음) */
export function nowKstIso(d: Date = new Date()): string {
  const shifted = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return shifted.toISOString().replace('Z', '+09:00')
}

/** event_uuid 생성 — `crypto.randomUUID` 없는 매우 구형 환경 대비 폴백 포함 */
export function newEventUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // RFC4122 v4 폴백 (테스트·구형 WebView 전용, 암호학적 강도는 필요 없다 — 멱등키 용도)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function findStep(wo: WorkOrderDetail, processCode: string): RouteStep | undefined {
  return wo.steps.find((s) => s.process_code === processCode)
}
function previousStep(wo: WorkOrderDetail, processCode: string): RouteStep | undefined {
  const idx = wo.steps.findIndex((s) => s.process_code === processCode)
  if (idx <= 0) return undefined
  return wo.steps[idx - 1]
}

/**
 * KSK-30 양품 기본값 — 표 그대로: `steps[P30].qty_in` → 직전 단계 `qty_good` → `wo.qty_received`.
 * `PARTIAL` 재스캔이면 잔량(`qty_in − (qty_good+qty_bad)`, 음수는 0). 아무 것도 없으면 null(빈칸, 입력 필수).
 */
export function defaultGoodQty(wo: WorkOrderDetail, processCode: string): number | null {
  const step = findStep(wo, processCode)
  if (step?.status === 'PARTIAL') {
    const qtyIn = step.qty_in ?? 0
    const done = (step.qty_good ?? 0) + (step.qty_bad ?? 0)
    return Math.max(qtyIn - done, 0)
  }
  if (step?.qty_in != null) return step.qty_in
  const prev = previousStep(wo, processCode)
  if (prev?.qty_good != null) return prev.qty_good
  return wo.qty_received ?? null
}

/**
 * P30 수량 대사 (api-contract §6.2): `|good+bad-qtyIn| > qtyIn*tol/100` 이면 허용오차 초과 → KSK-31.
 * `qtyIn` 을 모르면(오프라인 등) 판정하지 않는다 — null 반환, 화면은 바로 전송(서버가 사후 판정).
 */
export function isToleranceExceeded(qtyIn: number | null | undefined, tolerancePct: number, qtyGood: number, qtyBad: number): boolean | null {
  if (qtyIn === null || qtyIn === undefined) return null
  const diff = Math.abs(qtyGood + qtyBad - qtyIn)
  const allowed = (qtyIn * tolerancePct) / 100
  return diff > allowed
}

export type BuildDoneRequestInput = {
  stationId: string
  workerCard: string
  code: string
  check: string | null
  equipmentCode: string
  qtyGood: number
  qtyBad: number
  varianceReasonCode?: VarianceReasonCode | null
  varianceReasonText?: string | null
  inputVia: InputVia
  eventUuid: string
  clientSeq: number
  scannedAt?: string
}

/** KSK-40 이 보내는 `action=DONE` 요청 조립 (api-contract §5.1). 파일럿은 P30 완료 스캔만 만든다 */
export function buildDoneScanRequest(input: BuildDoneRequestInput): ScanRequest {
  // exactOptionalPropertyTypes 때문에 값이 없는 선택 필드는 키 자체를 넣지 않는다(undefined 를 명시하지 않는다)
  const extra: ScanExtra | undefined = input.varianceReasonCode
    ? {
        variance_reason_code: input.varianceReasonCode,
        ...(input.varianceReasonText ? { variance_reason: input.varianceReasonText } : {}),
      }
    : undefined
  return {
    event_uuid: input.eventUuid,
    scanned_at: input.scannedAt ?? nowKstIso(),
    station_id: input.stationId,
    worker_card: input.workerCard,
    code: input.code,
    check: input.check,
    action: 'DONE',
    qty_good: input.qtyGood,
    qty_bad: input.qtyBad,
    equipment_code: input.equipmentCode,
    ...(extra ? { extra } : {}),
    client_seq: input.clientSeq,
    input_via: input.inputVia,
  }
}

/** api-contract §3.3 result × requires_approval → ScanResultCard variant (§0.7) */
export function scanResultVariant(res: Pick<ScanResponse, 'result' | 'requires_approval'>): ScanResultVariant {
  if (res.result === 'REJECT') return 'reject'
  if (res.result === 'WARN' && res.requires_approval) return 'approval'
  if (res.result === 'WARN') return 'warn'
  return 'ok'
}

/** OK·저장됨(saved) 만 2초 자동 닫힘, 그 외(WARN·승인·REJECT)는 탭까지 유지 (§0.7) */
export function autoDismissMsFor(variant: ScanResultVariant | 'saved'): number | undefined {
  return variant === 'ok' || variant === 'saved' ? 2000 : undefined
}

/** KSK-20 사전 경고 — status 로 [완료] 를 미리 막을지 (api-contract §5.2 2단계 예고, 화면 측) */
export function isWoStatusBlocked(status: string): boolean {
  return status === 'CANCELLED' || status === 'CLOSED' || status === 'ON_HOLD' || status === 'DRAFT'
}

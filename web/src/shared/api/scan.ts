/**
 * 스캔 · 단말 자기서비스 API — api-contract §5(스캔 엔진) · §7.6(스캔·단말) · §7.2 stations/me.
 *
 * 이 파일의 호출은 전부 **단말 자격**(`X-Station-Key`, api-contract §2.1)이다. `client.ts` 의 `request()`
 * 는 사용자 JWT(`Authorization: Bearer`)만 자동으로 붙이므로, 여기서는 `stationHeaders()` 로 단말 키를
 * 매 호출 명시적으로 얹는다 — 키는 `useStationConfig`/`loadStationConfig()` 가 저장한 로컬 설정에서 읽는다.
 *
 * 이름 규칙: 관리자 웹(JWT)의 `stationsApi`(`shared/api/master.ts`, `/stations` CRUD)와 자격이 다르므로
 * 이름을 겹치지 않게 `stationApi`(단수)로 뒀다 — 과제 지시문은 `stationsApi.me()` 등으로 썼지만, 기존
 * `stationsApi` 는 JWT 전용 admin CRUD 객체라 그 자리에 STATION-key 메서드를 얹으면 자격이 섞여 호출부가
 * 실수하기 쉽다. 가장 가까운 대안으로 분리했고, 보고서에 이 이름 변경을 남긴다.
 */
import { api, API_PREFIX, qs } from './client'
import { loadStationConfig } from '../hooks/useStationConfig'
import type {
  ApproveRequest,
  Equipment,
  InboundLot,
  LabelJob,
  LabelPrintRequest,
  Page,
  PackBox,
  PackBoxDetail,
  PendingScan,
  Process,
  QueueResponse,
  ScanBatchResponse,
  ScanRequest,
  ScanResponse,
  Station,
  VendorBarcodeLookup,
  WorkOrderDetail,
  WorkOrderSummary,
} from '../types'

const P = API_PREFIX

/** 단말 키 헤더. 등록 전(설정 없음)이면 빈 객체 — 서버가 401 `BAD_STATION_KEY` 로 응답한다 */
export function stationHeaders(extra?: Record<string, string>): Record<string, string> {
  const cfg = loadStationConfig()
  const h: Record<string, string> = { ...(extra ?? {}) }
  if (cfg?.api_key) h['X-Station-Key'] = cfg.api_key
  return h
}

export const scanApi = {
  /** POST /api/v1/scan — api-contract §5.1. 5초 타임아웃은 호출부(오프라인 큐)가 AbortSignal 로 건다 */
  submit: (body: ScanRequest, signal?: AbortSignal) =>
    api.post<ScanResponse>(`${P}/scan`, body, { headers: stationHeaders(), ...(signal ? { signal } : {}) }),
  /** POST /api/v1/scan/batch — api-contract §5.3. 최대 200건, client_seq 오름차순은 호출부 책임 */
  batch: (events: ScanRequest[]) => api.post<ScanBatchResponse>(`${P}/scan/batch`, { events }, { headers: stationHeaders() }),
  /** POST /api/v1/scan/{event_uuid}/approve — api-contract §5.5. approvalToken 있으면 X-Approval-Token 헤더로 */
  approve: (eventUuid: string, body: ApproveRequest, approvalToken?: string | null) =>
    api.post<ScanResponse>(`${P}/scan/${encodeURIComponent(eventUuid)}/approve`, body, {
      headers: stationHeaders(approvalToken ? { 'X-Approval-Token': approvalToken } : undefined),
    }),
  /** GET /api/v1/scan/pending?station_id= — KSK-61 (단말, station_id 필수) · ADM-17 (관리자 JWT, station_id 생략 시 전체) */
  pending: (stationId?: string) => api.get<PendingScan[]>(`${P}/scan/pending${qs({ station_id: stationId })}`, { headers: stationHeaders() }),
}

/** 단말 자기서비스 (부팅·대기열·설비) — 전부 STATION 키 */
export const stationApi = {
  /** GET /api/v1/stations/me — KSK-00 부팅 확인 */
  me: () => api.get<Station>(`${P}/stations/me`, { headers: stationHeaders() }),
  /** GET /api/v1/stations/{id}/queue?limit= — KSK-10 대기열 */
  queue: (stationId: string, limit = 8) =>
    api.get<QueueResponse>(`${P}/stations/${encodeURIComponent(stationId)}/queue${qs({ limit })}`, { headers: stationHeaders() }),
  /** GET /api/v1/stations/{id}/equipment?print_method= — KSK-20 설비 선택 */
  equipment: (stationId: string, printMethod?: string) =>
    api.get<Equipment[]>(`${P}/stations/${encodeURIComponent(stationId)}/equipment${qs({ print_method: printMethod })}`, {
      headers: stationHeaders(),
    }),
  /** GET /api/v1/processes (STATION R) — KSK-00 부팅 시 1회, 공정명 캐시 (screens-shopfloor §0.2) */
  processes: () => api.get<Process[]>(`${P}/processes`, { headers: stationHeaders() }),
  /** GET /api/v1/wo/{code} (STATION R, 코드 허용) — KSK-20 WO 요약 조회 */
  wo: (code: string, signal?: AbortSignal) =>
    api.get<WorkOrderDetail>(`${P}/wo/${encodeURIComponent(code)}`, { headers: stationHeaders(), ...(signal ? { signal } : {}) }),
  /**
   * GET /api/v1/wo/search?q= (STATION R) — KSK-70 라벨 재발행 검색. `shared/api/order.ts` 의
   * `woApi.search` 와 같은 경로지만 그쪽은 JWT(`authHeaders()`)만 붙인다 — 키오스크는 워커 로그인이
   * JWT 를 발급하지 않으므로(§0.3) 여기 STATION 키 버전을 따로 둔다(다른 STATION 전용 메서드들과 같은 이유).
   */
  searchWo: (q: string) => api.get<WorkOrderSummary[]>(`${P}/wo/search${qs({ q })}`, { headers: stationHeaders() }),
  /**
   * PDA(P20·P60) 전용 조회·액션 — STATION 키만으로 부른다(워커 로그인은 JWT 를 발급하지 않는다, §0.3).
   * `shared/api/material.ts`·`shipping.ts`·`label.ts` 의 같은 리소스는 관리자 JWT 전용이라 여기서
   * 별도로 둔다(그 파일들은 admin 웹 전용 — 건드리지 않는다).
   */
  /** GET /api/v1/boxes/{code} (STATION R) — PDA-20 박스 QR 조회 */
  box: (code: string) => api.get<PackBoxDetail>(`${P}/boxes/${encodeURIComponent(code)}`, { headers: stationHeaders() }),
  /** GET /api/v1/boxes?wo_code=&unshipped=true (STATION R) — PDA-20 WO 대체 경로 · PDA-22 미발송 잔여 경고 */
  unshippedBoxes: (woCode: string) =>
    api.get<Page<PackBox>>(`${P}/boxes${qs({ wo_code: woCode, unshipped: true })}`, { headers: stationHeaders() }),
  /** GET /api/v1/vendor-barcodes/{barcode} (STATION R) — PDA-10 업체 바코드 매핑 조회 */
  vendorBarcodeLookup: (barcode: string) => api.get<VendorBarcodeLookup>(`${P}/vendor-barcodes/${encodeURIComponent(barcode)}`, { headers: stationHeaders() }),
  /** POST /api/v1/lots/{code}/quarantine {memo} (STATION W) — PDA-13 FAIL 격리 메모 */
  quarantineLot: (code: string, memo: string) => api.post<InboundLot>(`${P}/lots/${encodeURIComponent(code)}/quarantine`, { memo }, { headers: stationHeaders() }),
  /** POST /api/v1/labels/print (STATION W) — KSK-81 박스 라벨 재출력 */
  printLabel: (body: LabelPrintRequest) => api.post<LabelJob>(`${P}/labels/print`, body, { headers: stationHeaders() }),
}

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
  PendingScan,
  Process,
  QueueResponse,
  ScanBatchResponse,
  ScanRequest,
  ScanResponse,
  Station,
  WorkOrderDetail,
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
  /** GET /api/v1/scan/pending?station_id= — KSK-61 */
  pending: (stationId: string) => api.get<PendingScan[]>(`${P}/scan/pending${qs({ station_id: stationId })}`, { headers: stationHeaders() }),
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
}

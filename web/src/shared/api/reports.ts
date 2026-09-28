/**
 * 실적 집계 · 알림 · 감사 로그 API — api-contract §7.8 (B5). `GET /dashboard/summary` 는
 * `board.ts`(boardApi.summary, BRD-01 이 STATION 키 겸용으로 먼저 둔 파일)를 그대로 쓴다 — 관리자 웹은
 * JWT 만 붙으면 되므로(`stationHeaders()` 는 단말 설정이 없으면 빈 값) 여기서 다시 만들지 않는다.
 * 경로는 계약 그대로.
 */
import { api, API_PREFIX, downloadBlob, qs, type QueryParams } from './client'
import type { AuditLog, Notification, OutputReport, Page } from '../types'

const P = API_PREFIX

export const reportsApi = {
  /** GET /reports/output?from&to&group&process_code&equipment_id&worker_id&format=json → OutputReport (ADM-25) */
  output: (params: QueryParams) => api.get<OutputReport>(`${P}/reports/output${qs({ ...params, format: 'json' })}`),
  /** GET /reports/output?...&format=xlsx → blob (JWT 헤더 필요 → downloadBlob) */
  outputExcel: (params: QueryParams, filename: string) => downloadBlob(`${P}/reports/output${qs({ ...params, format: 'xlsx' })}`, filename),
}

export const notificationsApi = {
  /** GET /notifications?unacked&type&from&to&page&size → Page<Notification> (ADM-29) */
  list: (params?: QueryParams) => api.get<Page<Notification>>(`${P}/notifications${qs(params)}`),
  /** POST /notifications/{id}/ack → Notification */
  ack: (id: number) => api.post<Notification>(`${P}/notifications/${id}/ack`),
}

export const auditLogsApi = {
  /** GET /audit-logs?table_name&row_id&user_id&from&to&page&size → Page<AuditLog> (ADM-30, ADMIN/MANAGER) */
  list: (params?: QueryParams) => api.get<Page<AuditLog>>(`${P}/audit-logs${qs(params)}`),
}

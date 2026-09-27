/**
 * 수주 · WO API — api-contract §7.3 + §13.4 델타 (admin #25~#27 [S1]) + §10 QR 착지.
 * 경로는 계약 그대로. `{id}` 는 숫자 PK (코드도 허용, §11-1) — 화면은 상세 응답의 id 를 쓴다.
 */
import { api, API_PREFIX, downloadBlob, qs, type QueryParams } from './client'
import type {
  Design,
  IssueWoRequest,
  IssueWoResponse,
  LabelJob,
  Page,
  QrLanding,
  ReasonRequest,
  ReprintRequest,
  SalesOrder,
  SalesOrderCreate,
  SalesOrderDetail,
  SalesOrderSummary,
  SalesOrderUpdate,
  ScanEventSummary,
  SoCancelResponse,
  SplitRequest,
  SplitResponse,
  WoProposal,
  WorkOrder,
  WorkOrderDetail,
  WorkOrderSummary,
} from '../types'

const P = API_PREFIX

/** 정렬 허용 컬럼 (api-contract §13.1 admin #4). 기본 방향: so `due_date` 오름차순, wo `-due_date` (§14.6) */
export const SO_SORTABLE = ['due_date', 'order_date', 'code', 'status', 'progress_pct', 'updated_at'] as const
export const WO_SORTABLE = ['due_date', 'code', 'status', 'current_step_seq', 'issued_at'] as const

export const soApi = {
  /** GET /so?from&to&customer_id&status&due_within_days&delay=true&q&page&size&sort */
  list: (params?: QueryParams) => api.get<Page<SalesOrderSummary>>(`${P}/so${qs(params)}`),
  /** GET /so/{code} */
  get: (code: string) => api.get<SalesOrderDetail>(`${P}/so/${encodeURIComponent(code)}`),
  /** POST /so (201) */
  create: (body: SalesOrderCreate) => api.post<SalesOrder>(`${P}/so`, body),
  /** PATCH /so/{id} — 착수 라인 qty 변경은 409 STATE_CONFLICT */
  update: (id: number, body: SalesOrderUpdate) => api.patch<SalesOrder>(`${P}/so/${id}`, body),
  /** POST /so/{id}/cancel {reason} → SoCancelResponse (admin #27) */
  cancel: (id: number, reason: string) => api.post<SoCancelResponse>(`${P}/so/${id}/cancel`, { reason } satisfies ReasonRequest),
  /** POST /so/{id}/lines/{line_id}/design multipart `file` → Design (admin #25: png jpg jpeg pdf ai svg, 20MB) */
  uploadDesign: (id: number, lineId: number, file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<Design>(`${P}/so/${id}/lines/${lineId}/design`, fd)
  },
  /** POST /so/{id}/lines/{line_id}/design/confirm → Design */
  confirmDesign: (id: number, lineId: number) => api.post<Design>(`${P}/so/${id}/lines/${lineId}/design/confirm`),
  /** POST /so/{id}/propose-wo → WoProposal (저장 없음). 404 ROUTING_NOT_FOUND */
  proposeWo: (id: number) => api.post<WoProposal>(`${P}/so/${id}/propose-wo`),
  /** POST /so/{id}/issue-wo {drafts} → IssueWoResponse. 409 DESIGN_NOT_CONFIRMED · 422 qty 합 불일치 */
  issueWo: (id: number, body: IssueWoRequest) => api.post<IssueWoResponse>(`${P}/so/${id}/issue-wo`, body),
}

export const woApi = {
  /** GET /wo?so_code&status&process_code&delay=true&q&page&size&sort */
  list: (params?: QueryParams) => api.get<Page<WorkOrderSummary>>(`${P}/wo${qs(params)}`),
  /** GET /wo/{code} */
  get: (code: string) => api.get<WorkOrderDetail>(`${P}/wo/${encodeURIComponent(code)}`),
  /** GET /wo/{id}/events?page&size */
  events: (id: number, params?: QueryParams) => api.get<Page<ScanEventSummary>>(`${P}/wo/${id}/events${qs(params)}`),
  /** GET /wo/search?q= → WorkOrderSummary[] */
  search: (q: string) => api.get<WorkOrderSummary[]>(`${P}/wo/search${qs({ q })}`),
  hold: (id: number, reason: string) => api.post<WorkOrder>(`${P}/wo/${id}/hold`, { reason } satisfies ReasonRequest),
  resume: (id: number) => api.post<WorkOrder>(`${P}/wo/${id}/resume`),
  cancel: (id: number, reason: string) => api.post<WorkOrder>(`${P}/wo/${id}/cancel`, { reason } satisfies ReasonRequest),
  close: (id: number) => api.post<WorkOrder>(`${P}/wo/${id}/close`),
  /** [S3-3] */
  split: (id: number, body: SplitRequest) => api.post<SplitResponse>(`${P}/wo/${id}/split`, body),
  /** POST /wo/{id}/reprint {label_type, printer_id?} → LabelJob. 503 PRINTER_UNREACHABLE */
  reprint: (id: number, body: ReprintRequest) => api.post<LabelJob>(`${P}/wo/${id}/reprint`, body),
}

/** QR 착지 (api-contract §10). 공개 + 체크코드 검증. 로그인 토큰이 있으면 client 가 자동으로 붙인다 */
export const qApi = {
  landing: (code: string, check: string | null) => api.get<QrLanding>(`${P}/q/${encodeURIComponent(code)}${qs({ c: check })}`),
}

/** 작업지시서 PDF (api-contract §7.7). JWT 헤더가 필요해 downloadBlob */
export const pdfApi = {
  workOrder: (woCode: string) => downloadBlob(`${P}/labels/work-order/${encodeURIComponent(woCode)}.pdf`, `${woCode}.pdf`),
  salesOrder: (soCode: string) => downloadBlob(`${P}/labels/so/${encodeURIComponent(soCode)}.pdf`, `${soCode}.pdf`),
  /** issue-wo·reprint 응답의 pdf_url (상대 경로 또는 절대 URL) */
  byUrl: (pdfUrl: string, fallbackName: string) => downloadBlob(pdfUrl, fallbackName),
}

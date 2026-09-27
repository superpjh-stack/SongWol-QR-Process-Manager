/**
 * 라벨 · 프린터 API — api-contract §7.2 (printers · label-templates, A1-09) + §7.7 (labels, B1) + §13.3 admin #10·#18.
 * - `GET /printers` 는 배열 응답 (admin #7). CRUD 공통형 + `POST /printers/{id}/test`
 * - 미리보기는 ZPL 텍스트 (§11-7). 응답 본문 형식이 계약에 없다 → 문자열/객체 둘 다 받아 텍스트로 정규화 (계약 누락 보고)
 */
import { api, API_PREFIX, qs } from './client'
import { crud } from './master'
import type { LabelIssue, LabelJob, LabelPrintRequest, LabelTemplate, LabelTemplateUpdate, LabelType, Printer, PrinterCreate, PrinterUpdate } from '../types'

const P = API_PREFIX

/**
 * 계약 누락 — 로컬 정의 (백엔드 fa5ddd6 `schemas/label.py` 기준. ts-types §4·§5 에 없다):
 * - `POST /printers/{id}/test` 응답 `PrinterTestResult` (LabelJob 아님). 실패도 200 + zpl_sent=false·error (§13.7 원칙)
 * - `POST /label-templates/{type}/preview` 요청 `{target?, printer_id?}` (저장된 양식을 예시값 또는 target 실데이터로 렌더), 응답 `LabelPreview{body}`
 */
export interface PrinterTestResult {
  printer_id: string
  host: string
  port: number
  zpl_sent: boolean
  sent_at: string | null
  error: string | null
  /** 보낸 ZPL 원문 */
  zpl: string
}
export interface LabelPreviewRequest {
  target?: string
  printer_id?: string
}
export interface LabelPreview {
  label_type: LabelType
  format: 'ZPL' | 'HTML'
  target: string | null
  body: string
}

export const printersApi = {
  ...crud<Printer, PrinterCreate, PrinterUpdate>('printers'),
  /** POST /printers/{id}/test → PrinterTestResult (실패도 200: zpl_sent=false · error=PRINTER_UNREACHABLE) */
  test: (id: string) => api.post<PrinterTestResult>(`${P}/printers/${encodeURIComponent(id)}/test`),
}

export const labelTemplatesApi = {
  /** GET /label-templates → 배열 (admin #7) */
  listAll: () => api.get<LabelTemplate[]>(`${P}/label-templates`),
  /** GET /label-templates/{label_type} → LabelTemplate{…, placeholders} (admin #18) */
  get: (labelType: LabelType) => api.get<LabelTemplate>(`${P}/label-templates/${labelType}`),
  /** PUT /label-templates/{label_type} {body} (format 은 label_type 에 고정, admin #10). 422 BAD_TEMPLATE */
  put: (labelType: LabelType, body: LabelTemplateUpdate) => api.put<LabelTemplate>(`${P}/label-templates/${labelType}`, body),
  /** POST /label-templates/{label_type}/preview {target?, printer_id?} → LabelPreview{body} (§11-7 텍스트만). **저장된** 양식을 렌더한다 */
  preview: (labelType: LabelType, req: LabelPreviewRequest = {}) => api.post<LabelPreview>(`${P}/label-templates/${labelType}/preview`, req),
}

export const labelsApi = {
  /** POST /labels/print {target, label_type, printer, copies} → LabelJob (spec §8.6) */
  print: (body: LabelPrintRequest) => api.post<LabelJob>(`${P}/labels/print`, body),
  /** GET /labels/issues?target_code= → LabelIssue[] */
  issues: (targetCode: string) => api.get<LabelIssue[]>(`${P}/labels/issues${qs({ target_code: targetCode })}`),
}

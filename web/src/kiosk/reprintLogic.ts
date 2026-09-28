/**
 * KSK-70 라벨 재발행 — 순수 로직 (screens-shopfloor §1 KSK-70).
 *
 * 재발행 경로 이중화(§5 ⑫)는 백엔드가 이미 갈랐다: `POST /wo/{id}/reprint` 는 WORK_ORDER_PDF 전용으로
 * 바뀌었고(backend/app/domain/label/service.py `reprint_work_order_pdf` 주석 "WO_LABEL 재출력은 이
 * 경로가 아니라 /labels/print 다"), 키오스크에는 PDF 출력 수단이 없다(§1 KSK-70 "작업지시서 PDF …
 * 버튼 노출 안 함"). 그래서 이 화면은 기존 `POST /labels/print`(`stationApi.printLabel`)만 쓴다.
 */
import type { LabelPrintRequest, WorkOrderSummary } from '@/shared/types'

/** 2자 이상에서 검색(§1 KSK-70 "입력") */
export const REPRINT_SEARCH_MIN_LEN = 2

export function shouldSearch(query: string): boolean {
  return query.trim().length >= REPRINT_SEARCH_MIN_LEN
}

/** WO 라벨(4인치 QR 라벨) 재출력 요청 — 차수(issue_no)는 서버가 매긴다 */
export function buildWoLabelReprintRequest(wo: Pick<WorkOrderSummary, 'code'>, printerId: string): LabelPrintRequest {
  return { target: wo.code, label_type: 'WO_LABEL', printer: printerId, copies: 1 }
}

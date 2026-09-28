/**
 * 자재 API — api-contract §7.4 (ADM-18~21) + admin #32 (S3-2b 업체 바코드 매핑 조회·해제).
 * 경로는 계약 그대로. `GET /receipts`·`GET /stock`·`GET /stock/txns`·`GET /vendor-barcodes` 는 useList('receipts'|'stock'|'stock/txns'|'vendor-barcodes', …) 로도 부를 수 있다(제네릭 Page<T>) — 이 파일은 그 외 변경(POST)과 명시적 typing 을 둔다.
 */
import { api, API_PREFIX, qs, type QueryParams } from './client'
import type { InboundLot, Page, Receipt, StockAdjust, StockRow, StockTxn, VendorBarcodeMap } from '../types'

const P = API_PREFIX

export const receiptsApi = {
  /** GET /receipts?from&to&item_id&wo_code&inspection&page&size → Page<Receipt> */
  list: (params?: QueryParams) => api.get<Page<Receipt>>(`${P}/receipts${qs(params)}`),
}

export const lotsApi = {
  /** GET /lots/{code} → InboundLot | PackBox (kind 로 구분) */
  get: (code: string) => api.get<InboundLot>(`${P}/lots/${encodeURIComponent(code)}`),
  /** POST /lots/{code}/quarantine {memo} → InboundLot(QUARANTINE). memo ≤300 (quarantine_memo) */
  quarantine: (code: string, memo: string) => api.post<InboundLot>(`${P}/lots/${encodeURIComponent(code)}/quarantine`, { memo }),
  /** POST /lots/{code}/release → InboundLot(OK). ADMIN/MANAGER */
  release: (code: string) => api.post<InboundLot>(`${P}/lots/${encodeURIComponent(code)}/release`),
}

export const stockApi = {
  /** GET /stock?q&item_group&page&size → Page<StockRow> (= v_stock_current) */
  list: (params?: QueryParams) => api.get<Page<StockRow>>(`${P}/stock${qs(params)}`),
  /** POST /stock/adjust {item_id, qty_delta, reason} → StockTxn. ADMIN/MANAGER, 422 reason 필수 */
  adjust: (body: StockAdjust) => api.post<StockTxn>(`${P}/stock/adjust`, body),
  /** GET /stock/txns?item_id&from&to&txn_type&source&page&size → Page<StockTxn> */
  txns: (params?: QueryParams) => api.get<Page<StockTxn>>(`${P}/stock/txns${qs(params)}`),
}

/**
 * S3-2b 업체 바코드 매핑 — admin #32 [S3]: `GET /vendor-barcodes?wo_code&item_id&active` 는 「화면 없음, 데이터 정합 확인용」으로
 * 문서화됐지만, 이번 스프린트 지시로 조회·해제 화면(VendorBarcodesPage)을 둔다.
 * **`POST /vendor-barcodes/{id}/deactivate` 는 api-contract·ts-types 어디에도 없다** — 이 리포 다른 리소스의
 * activate/deactivate 공통형(`crud().deactivate`, `master.ts`)과 같은 모양으로 추정 구현했다. 백엔드에 아직 없으면 404 로 드러난다(조용한 실패 아님).
 */
export const vendorBarcodesApi = {
  list: (params?: QueryParams) => api.get<Page<VendorBarcodeMap>>(`${P}/vendor-barcodes${qs(params)}`),
  deactivate: (id: number) => api.post<VendorBarcodeMap>(`${P}/vendor-barcodes/${id}/deactivate`),
}

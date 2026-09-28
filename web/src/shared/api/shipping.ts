/**
 * 출하 API — api-contract §7.5 (ADM-22~24). 경로는 계약 그대로.
 * `GET /boxes`·`GET /shipments` 는 useList('boxes'|'shipments', …) 로도 부를 수 있다(제네릭 Page<T>) — 이 파일은 상세·변경·일보를 둔다.
 */
import { api, API_PREFIX, downloadBlob, qs, type QueryParams } from './client'
import type { DailyShipmentReport, Page, PackBox, PackBoxDetail, Shipment, ShipmentCreate, ShipmentSummary } from '../types'

const P = API_PREFIX

export const boxesApi = {
  /** GET /boxes?wo_code&so_code&unshipped=true&page&size → Page<PackBox> */
  list: (params?: QueryParams) => api.get<Page<PackBox>>(`${P}/boxes${qs(params)}`),
  /** GET /boxes/{code} → PackBoxDetail{…, wo, shipment?} */
  get: (code: string) => api.get<PackBoxDetail>(`${P}/boxes/${encodeURIComponent(code)}`),
}

export const shipmentsApi = {
  /** GET /shipments?date&from&to&customer_id&so_code&tracking_no&status&unmapped=true&page&size → Page<ShipmentSummary> */
  list: (params?: QueryParams) => api.get<Page<ShipmentSummary>>(`${P}/shipments${qs(params)}`),
  /** GET /shipments/{id} → ShipmentDetail */
  get: (id: number) => api.get<Shipment>(`${P}/shipments/${id}`),
  /** POST /shipments {so_code?, box_codes[], tracking_no, carrier?, confirm:true} → Shipment. 409 BOX_ALREADY_SHIPPED */
  create: (body: ShipmentCreate) => api.post<Shipment>(`${P}/shipments`, body),
  /** GET /shipments/daily-report?date=&format=json → DailyShipmentReport */
  dailyReport: (date: string) => api.get<DailyShipmentReport>(`${P}/shipments/daily-report${qs({ date, format: 'json' })}`),
  /** GET /shipments/daily-report?date= → xlsx (JWT 헤더 필요 → downloadBlob, screens-admin §0.3) */
  dailyReportExcel: (date: string) => downloadBlob(`${P}/shipments/daily-report${qs({ date })}`, `출하일보_${date}.xlsx`),
}

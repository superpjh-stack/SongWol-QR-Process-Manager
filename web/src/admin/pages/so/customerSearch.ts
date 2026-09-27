/** 거래처 typeahead 검색 — GET /customers?q&active=true (screens-admin §2 #6). ADM-12 필터 · ADM-13 헤더 공용 */
import { customersApi, toErrorView } from '@/shared/api'
import type { Customer } from '@/shared/types'

export const searchCustomers = async (q: string, signal: AbortSignal): Promise<Customer[]> => (await customersApi.list({ q, active: true, size: 20 }, signal)).items
export const customerLabel = (c: Customer) => `${c.code} ${c.name}`
export const apiErrorText = (e: unknown) => toErrorView(e).message

/** 품목 typeahead 검색 — GET /items?q&active=true (screens-admin §2 #6). ADM-18·19·20·21·S3-2b 필터 공용 */
import { itemsApi, toErrorView } from '@/shared/api'
import type { Item } from '@/shared/types'

export const searchItems = async (q: string, signal: AbortSignal): Promise<Item[]> => (await itemsApi.list({ q, active: true, size: 20 }, signal)).items
export const itemLabel = (i: Item) => `${i.code} ${i.name}`
export const apiErrorText = (e: unknown) => toErrorView(e).message

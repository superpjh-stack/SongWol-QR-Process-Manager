/** useListParams + Page<T> → DataTable 서버 모드 props */
import type { Page } from '@/shared/types'
import type { Pagination, SortState } from '@/shared/ui/admin'
import type { ListParams } from './useListParams'

export function serverTable<T>(params: ListParams, page: Page<T> | undefined): { pagination: Pagination; sort: SortState | null; onSortChange: (s: SortState | null) => void } {
  return {
    pagination: { page: params.page, pageSize: params.size, total: page?.total ?? 0, onPageChange: params.setPage },
    sort: params.sort,
    onSortChange: params.setSort,
  }
}

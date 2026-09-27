/**
 * 단순 데이터 테이블 — 컬럼 정의·정렬·페이징·빈/로딩/오류 상태. 외부 라이브러리 없음.
 *
 * 두 모드:
 *   클라이언트 모드 (기본)   rows 전체를 받아 여기서 정렬·페이징한다. `pageSize` 로 페이지 크기 지정.
 *   서버 모드                `pagination`(page·pageSize·total·onPageChange) 과 `sort`+`onSortChange` 를 주면
 *                           정렬·슬라이싱을 하지 않고 이벤트만 올린다. 목록 API(page/size 파라미터)와 쓴다.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { cn } from '../cn'
import { IconChevronLeft, IconChevronRight, IconSortAsc, IconSortDesc, IconSortNone } from '../icons'
import { EmptyState } from './EmptyState'
import { ErrorAlert } from './ErrorAlert'
import { Spinner } from './Spinner'

export type SortDir = 'asc' | 'desc'
export type SortState = { key: string; dir: SortDir }

export type Column<T> = {
  key: string
  header: ReactNode
  /** 셀 렌더. 생략하면 row[key] 를 문자열로 */
  render?: (row: T, index: number) => ReactNode
  /** 정렬 가능 여부. 클라이언트 모드에서 정렬 기준 값은 sortValue ?? row[key] */
  sortable?: boolean
  sortValue?: (row: T) => string | number | null | undefined
  align?: 'left' | 'right' | 'center'
  width?: string
  className?: string
}

export type Pagination = { page: number; pageSize: number; total: number; onPageChange: (page: number) => void }

export type DataTableProps<T> = {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string | number
  loading?: boolean
  error?: ReactNode
  onRetry?: () => void
  emptyText?: string
  emptyAction?: ReactNode
  onRowClick?: (row: T) => void
  /** 클라이언트 페이징 크기. 0 이면 페이징 없음. 기본값 20 */
  pageSize?: number
  /** 서버 페이징 */
  pagination?: Pagination
  /** 서버 정렬 (controlled) */
  sort?: SortState | null
  onSortChange?: (sort: SortState | null) => void
  /** 표 높이 고정·스크롤 (예: 'max-h-[60vh]') */
  className?: string
  dense?: boolean
}

function defaultCell<T>(row: T, key: string): ReactNode {
  const v = (row as Record<string, unknown>)[key]
  if (v === null || v === undefined) return <span className="text-ink-faint">—</span>
  if (typeof v === 'number') return v.toLocaleString('ko-KR')
  if (typeof v === 'boolean') return v ? '예' : '아니오'
  return String(v)
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === null || a === undefined) return 1
  if (b === null || b === undefined) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), 'ko')
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  emptyText = '데이터가 없습니다',
  emptyAction,
  onRowClick,
  pageSize = 20,
  pagination,
  sort: sortProp,
  onSortChange,
  className,
  dense,
}: DataTableProps<T>) {
  const [innerSort, setInnerSort] = useState<SortState | null>(null)
  const [innerPage, setInnerPage] = useState(1)
  const controlledSort = sortProp !== undefined
  const sort = controlledSort ? sortProp : innerSort
  const serverMode = Boolean(pagination)

  const toggleSort = (key: string) => {
    const next: SortState | null = sort?.key !== key ? { key, dir: 'asc' } : sort.dir === 'asc' ? { key, dir: 'desc' } : null
    if (onSortChange) onSortChange(next)
    if (!controlledSort) setInnerSort(next)
    setInnerPage(1)
  }

  const sorted = useMemo(() => {
    if (serverMode || !sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    const val = (r: T) => (col?.sortValue ? col.sortValue(r) : (r as Record<string, unknown>)[sort.key])
    const out = [...rows].sort((a, b) => compare(val(a), val(b)))
    return sort.dir === 'desc' ? out.reverse() : out
  }, [rows, sort, columns, serverMode])

  const page = pagination ? pagination.page : innerPage
  const size = pagination ? pagination.pageSize : pageSize
  const total = pagination ? pagination.total : rows.length
  const pageCount = size > 0 ? Math.max(1, Math.ceil(total / size)) : 1
  const visible = serverMode || size === 0 ? sorted : sorted.slice((page - 1) * size, page * size)
  const setPage = (p: number) => {
    const clamped = Math.min(Math.max(1, p), pageCount)
    if (pagination) pagination.onPageChange(clamped)
    else setInnerPage(clamped)
  }

  const cellPad = dense ? 'px-2 py-1' : 'px-3 py-2'
  const alignCls = (a?: Column<T>['align']) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left')

  return (
    <div className={cn('flex flex-col rounded-ad border border-line bg-surface', className)} data-component="DataTable">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-ad-body">
          <thead className="sticky top-0 z-[1] bg-surface-2 text-ad-xs font-semibold text-ink-muted">
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key
                const SortIcon = active ? (sort.dir === 'asc' ? IconSortAsc : IconSortDesc) : IconSortNone
                return (
                  <th
                    key={c.key}
                    scope="col"
                    style={c.width ? { width: c.width } : undefined}
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn('border-b border-line whitespace-nowrap', cellPad, alignCls(c.align), c.className)}
                  >
                    {c.sortable ? (
                      <button type="button" onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-ink">
                        {c.header}
                        <SortIcon size={14} />
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {!loading && !error
              ? visible.map((row, i) => (
                  <tr
                    key={rowKey(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn('border-b border-line last:border-b-0', onRowClick && 'cursor-pointer hover:bg-brand-50')}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={cn(cellPad, alignCls(c.align), c.className)}>
                        {c.render ? c.render(row, i) : defaultCell(row, c.key)}
                      </td>
                    ))}
                  </tr>
                ))
              : null}
          </tbody>
        </table>
        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner label="불러오는 중…" />
          </div>
        ) : error ? (
          <div className="p-4">
            <ErrorAlert message={error} {...(onRetry ? { onRetry } : {})} />
          </div>
        ) : visible.length === 0 ? (
          <EmptyState title={emptyText} {...(emptyAction ? { action: emptyAction } : {})} />
        ) : null}
      </div>

      {!loading && !error && size > 0 && (total > size || serverMode) ? (
        <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-2 text-ad-xs text-ink-muted">
          <span className="tabular-nums">
            총 {total.toLocaleString('ko-KR')}건 · {page}/{pageCount} 페이지
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              aria-label="이전 페이지"
              className="flex h-7 w-7 items-center justify-center rounded-ad border border-line hover:bg-surface-3 disabled:opacity-40"
            >
              <IconChevronLeft size={14} />
            </button>
            <button
              type="button"
              disabled={page >= pageCount}
              onClick={() => setPage(page + 1)}
              aria-label="다음 페이지"
              className="flex h-7 w-7 items-center justify-center rounded-ad border border-line hover:bg-surface-3 disabled:opacity-40"
            >
              <IconChevronRight size={14} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

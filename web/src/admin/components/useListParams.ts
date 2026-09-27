/**
 * 목록 화면의 페이징·정렬·검색·필터 상태를 URL 쿼리에 둔다 (screens-admin §0.5·§0.6).
 * `?page=1&size=50&q=&active=true&sort=-updated_at`. active 기본 「활성」.
 */
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { SortState } from '@/shared/ui/admin'
import type { QueryParams } from '@/shared/api'

export const PAGE_SIZES = [50, 100, 200] as const
export type ActiveFilter = 'true' | 'false' | 'all'

export type ListParams = {
  page: number
  size: number
  q: string
  active: ActiveFilter
  sort: SortState | null
  extra: Record<string, string>
  /** API 로 보낼 파라미터 */
  query: QueryParams
  setPage: (p: number) => void
  setSize: (s: number) => void
  setQ: (q: string) => void
  setActive: (a: ActiveFilter) => void
  setSort: (s: SortState | null) => void
  setExtra: (key: string, value: string) => void
  reset: () => void
}

export function sortToParam(s: SortState | null): string | undefined {
  if (!s) return undefined
  return s.dir === 'desc' ? `-${s.key}` : s.key
}
export function paramToSort(v: string | null): SortState | null {
  if (!v) return null
  return v.startsWith('-') ? { key: v.slice(1), dir: 'desc' } : { key: v, dir: 'asc' }
}

export function useListParams(opts: { defaultSort?: string; extraKeys?: string[]; withActive?: boolean } = {}): ListParams {
  const { defaultSort, extraKeys = [], withActive = true } = opts
  const [sp, setSp] = useSearchParams()

  const page = Math.max(1, Number(sp.get('page') ?? 1) || 1)
  const sizeRaw = Number(sp.get('size') ?? PAGE_SIZES[0])
  const size = (PAGE_SIZES as readonly number[]).includes(sizeRaw) ? sizeRaw : PAGE_SIZES[0]
  const q = sp.get('q') ?? ''
  const activeRaw = sp.get('active')
  const active: ActiveFilter = activeRaw === 'false' || activeRaw === 'all' ? activeRaw : 'true'
  const sort = paramToSort(sp.get('sort') ?? defaultSort ?? null)
  const keysStr = extraKeys.join(',')
  const extra = useMemo(() => {
    const o: Record<string, string> = {}
    for (const k of keysStr.split(',').filter(Boolean)) {
      const v = sp.get(k)
      if (v) o[k] = v
    }
    return o
  }, [sp, keysStr])

  const patch = useCallback(
    (changes: Record<string, string | null>) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(changes)) {
            if (v === null || v === '') next.delete(k)
            else next.set(k, v)
          }
          return next
        },
        { replace: true },
      )
    },
    [setSp],
  )

  const query = useMemo<QueryParams>(
    () => ({
      page,
      size,
      q: q || undefined,
      active: withActive ? (active === 'all' ? undefined : active) : undefined,
      sort: sortToParam(sort),
      ...extra,
    }),
    [page, size, q, active, sort, extra, withActive],
  )

  return {
    page,
    size,
    q,
    active,
    sort,
    extra,
    query,
    setPage: (p) => patch({ page: String(p) }),
    setSize: (s) => patch({ size: String(s), page: '1' }),
    setQ: (v) => patch({ q: v, page: '1' }),
    setActive: (a) => patch({ active: a === 'true' ? null : a, page: '1' }),
    setSort: (s) => patch({ sort: sortToParam(s) ?? null, page: '1' }),
    setExtra: (k, v) => patch({ [k]: v, page: '1' }),
    reset: () => setSp(new URLSearchParams(), { replace: true }),
  }
}

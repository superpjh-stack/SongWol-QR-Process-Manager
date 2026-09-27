/**
 * 데이터 훅 (TanStack Query 래핑) — ts-types §3 `HookState<T>` 규약 { data, loading, error, refetch }.
 * 목록 훅은 `Page<T>` 를 그대로 돌려준다. fallback·mock 없음 — 실패는 error 로 드러난다.
 *
 *   useList<Customer>('customers', { q, active, page, size, sort })
 *   useArray<Process>('processes', { active: true })
 *   useOne<Customer>('customers', id)
 *   const create = useCreate<Customer, CustomerCreate>('customers'); await create.mutate(body)
 *   useUpdate · useActivate · useDeactivate
 */
import { useCallback, useMemo, useRef } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { ApiError, api, API_PREFIX, crud, qs, type MasterResource, type QueryParams } from '../api'
import type { HookState, Page } from '../types'

export type ListResource = MasterResource | 'migration/batches'

function asApiError(e: unknown): ApiError | null {
  if (!e) return null
  if (e instanceof ApiError) return e
  return new ApiError(-1, 'UNKNOWN', e instanceof Error ? e.message : String(e))
}

/** 임의 조회를 HookState 로 */
export function useApiQuery<T>(key: QueryKey, fn: () => Promise<T>, enabled = true): HookState<T> {
  const q = useQuery<T, unknown>({ queryKey: key, queryFn: fn, enabled })
  const refetch = useCallback(async () => {
    await q.refetch()
  }, [q])
  return useMemo(
    () => ({ data: q.data, loading: enabled && (q.isPending || q.isFetching), error: asApiError(q.error), refetch }),
    [q.data, q.isPending, q.isFetching, q.error, refetch, enabled],
  )
}

export const resourceKey = (resource: string) => ['res', resource] as const

/** Page 응답 목록 (`?page&size&sort&q&active…`) */
export function useList<T>(resource: ListResource, params: QueryParams = {}, enabled = true): HookState<Page<T>> {
  return useApiQuery<Page<T>>([...resourceKey(resource), 'list', params], () => api.get<Page<T>>(`${API_PREFIX}/${resource}${qs(params)}`), enabled)
}

/** 배열 응답 소형 마스터 (admin #7) */
export function useArray<T>(resource: ListResource, params: QueryParams = {}, enabled = true): HookState<T[]> {
  return useApiQuery<T[]>([...resourceKey(resource), 'all', params], () => api.get<T[]>(`${API_PREFIX}/${resource}${qs(params)}`), enabled)
}

export function useOne<T>(resource: ListResource, id: string | number | null | undefined): HookState<T> {
  const enabled = id !== null && id !== undefined && id !== ''
  return useApiQuery<T>(
    [...resourceKey(resource), 'one', id],
    () => api.get<T>(`${API_PREFIX}/${resource}/${encodeURIComponent(String(id))}`),
    enabled,
  )
}

export type MutationState<TVars, TData> = {
  mutate: (vars: TVars) => Promise<TData>
  loading: boolean
  error: ApiError | null
  reset: () => void
}

/** 임의 변경. 성공 시 `invalidate` 키 접두사를 무효화한다 */
export function useApiMutation<TVars, TData>(fn: (vars: TVars) => Promise<TData>, invalidate: QueryKey[] = []): MutationState<TVars, TData> {
  const qc = useQueryClient()
  const m = useMutation<TData, unknown, TVars>({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k })))
    },
  })
  // TanStack 은 결과 객체마다 reset 함수를 새로 만든다 → 화면 useEffect 의존성으로 쓰면 무한 재실행. ref 로 고정한다
  const ref = useRef(m)
  ref.current = m
  const mutate = useCallback((vars: TVars) => ref.current.mutateAsync(vars), [])
  const reset = useCallback(() => ref.current.reset(), [])
  return { mutate, loading: m.isPending, error: asApiError(m.error), reset }
}

export function useCreate<T, C>(resource: MasterResource): MutationState<C, T> {
  const c = crud<T, C, never>(resource)
  return useApiMutation<C, T>((body) => c.create(body), [resourceKey(resource)])
}

export function useUpdate<T, U>(resource: MasterResource): MutationState<{ id: string | number; body: U }, T> {
  const c = crud<T, never, U>(resource)
  return useApiMutation(({ id, body }) => c.update(id, body), [resourceKey(resource)])
}

export function useDeactivate<T>(resource: MasterResource): MutationState<string | number, T> {
  const c = crud<T, never, never>(resource)
  return useApiMutation((id) => c.deactivate(id), [resourceKey(resource)])
}

export function useActivate<T>(resource: MasterResource): MutationState<string | number, T> {
  const c = crud<T, never, never>(resource)
  return useApiMutation((id) => c.activate(id), [resourceKey(resource)])
}

/** 화면에서 특정 리소스 캐시를 갱신할 때 */
export function useInvalidate() {
  const qc = useQueryClient()
  return useCallback((resource: string) => qc.invalidateQueries({ queryKey: resourceKey(resource) }), [qc])
}

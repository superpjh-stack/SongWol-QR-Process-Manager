/** HookState → 로딩 스피너 / 오류 / 콘텐츠 (screens-admin §0.4). 로딩 중에는 직전 데이터를 남기지 않는다 */
import type { ReactNode } from 'react'
import { Spinner } from '@/shared/ui/admin'
import type { HookState } from '@/shared/types'
import { ApiErrorAlert } from './ApiErrorAlert'

export function QueryState<T>({ state, children }: { state: HookState<T>; children: (data: T) => ReactNode }) {
  if (state.loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner label="불러오는 중…" />
      </div>
    )
  }
  if (state.error) return <ApiErrorAlert error={state.error} onRetry={() => void state.refetch()} />
  if (state.data === undefined) return null
  return <>{children(state.data)}</>
}

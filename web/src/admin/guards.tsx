/** 인증·권한 가드. 비로그인 → /login?next= · 권한 없음 → 403 ErrorAlert (서버 403 을 기다리지 않는다, §0.2) */
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { ErrorAlert, Spinner } from '@/shared/ui/admin'
import { useAuth } from '@/shared/hooks'
import { ApiErrorAlert } from './components'
import { canRead, type ScreenKey } from './permissions'

export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const location = useLocation()
  if (auth.status === 'idle' || auth.status === 'loading') {
    return (
      <div className="density-admin flex min-h-dvh items-center justify-center">
        <Spinner label="확인 중…" />
      </div>
    )
  }
  if (auth.status === 'error') {
    return (
      <div className="density-admin mx-auto max-w-lg p-6">
        <ApiErrorAlert error={auth.error ?? new Error('세션 확인 실패')} onRetry={() => void auth.hydrate()} />
      </div>
    )
  }
  if (!auth.isAuthenticated) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }
  return <>{children}</>
}

export function RequireRole({ screen, children }: { screen: ScreenKey; children: ReactNode }) {
  const { role } = useAuth()
  if (!canRead(role, screen)) return <ErrorAlert title="접근 권한이 없습니다" message="이 화면을 볼 수 있는 역할이 아닙니다." />
  return <>{children}</>
}

/** ADM-L — AppLayout + 역할별 메뉴(섹션) + 섹션 탭 + 하단 사용자 영역(이름·역할·로그아웃) */
import { useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AppLayout, Button } from '@/shared/ui/admin'
import { useApiQuery, useAuth } from '@/shared/hooks'
import { boardApi } from '@/shared/api'
import type { Role } from '@/shared/types'
import { RoleLabel } from '@/shared/labels'
import { navFor, type Badges } from './nav'
import { canRead } from './permissions'
import { SectionTabs } from './SectionTabs'
import { RequireAuth } from './guards'

const BADGE_POLL_MS = 60_000

/** 메뉴 배지 — 승인 대기 건수. 대시보드와 같은 조회(`GET /dashboard/summary`)를 같은 키로 써서 캐시를 나눠 쓴다. */
function useNavBadges(role: Role | null): Badges {
  const enabled = canRead(role, 'wo.pending')
  const summary = useApiQuery(['board', 'summary'], () => boardApi.summary(), enabled)
  useEffect(() => {
    if (!enabled) return
    const t = window.setInterval(() => void summary.refetch(), BADGE_POLL_MS)
    return () => window.clearInterval(t)
  }, [enabled, summary.refetch])
  const pending = enabled ? (summary.data?.pending_approvals ?? 0) : 0
  return pending > 0 ? { '/admin/wo/pending': pending } : {}
}

function UserBlock() {
  const { user, role, logout } = useAuth()
  const navigate = useNavigate()
  if (!user || !role) return null
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="truncate font-semibold">{user.name}</div>
        <div className="truncate text-ad-xs text-white/60">{RoleLabel[role]}</div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="text-white/80 hover:bg-white/10 hover:text-white"
        onClick={() => {
          logout()
          navigate('/login', { replace: true })
        }}
      >
        로그아웃
      </Button>
    </div>
  )
}

function Shell() {
  const { role } = useAuth()
  const { pathname } = useLocation()
  const badges = useNavBadges(role)
  return (
    <AppLayout nav={navFor(role, pathname, badges)} user={<UserBlock />}>
      <SectionTabs badges={badges} />
      <Outlet />
    </AppLayout>
  )
}

export function AdminLayout() {
  return (
    <RequireAuth>
      <Shell />
    </RequireAuth>
  )
}

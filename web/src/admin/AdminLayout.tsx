/** ADM-L — AppLayout + 역할별 메뉴 + 하단 사용자 영역(이름·역할·로그아웃) */
import { useNavigate } from 'react-router-dom'
import { AppLayout, Button } from '@/shared/ui/admin'
import { useAuth } from '@/shared/hooks'
import { RoleLabel } from '@/shared/labels'
import { navFor } from './nav'
import { RequireAuth } from './guards'

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
  return <AppLayout nav={navFor(role)} user={<UserBlock />} />
}

export function AdminLayout() {
  return (
    <RequireAuth>
      <Shell />
    </RequireAuth>
  )
}

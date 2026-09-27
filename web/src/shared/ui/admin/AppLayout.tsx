/**
 * 관리자 웹 레이아웃: 좌측 사이드바(그룹 내비) + 콘텐츠. 콘텐츠는 `children` 또는 라우터 <Outlet/>.
 * 메뉴 항목·사용자 정보·로그아웃은 admin/ 이 넘긴다. 이 컴포넌트는 인증을 모른다.
 */
import { useState, type ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '../cn'
import { IconMenu } from '../icons'

export type NavItem = { to: string; label: string; icon?: ReactNode; end?: boolean }
export type NavGroup = { label?: string; items: NavItem[] }

export type AppLayoutProps = {
  brand?: ReactNode
  nav: NavGroup[]
  /** 하단 사용자 영역 (이름·역할·로그아웃 버튼) */
  user?: ReactNode
  children?: ReactNode
}

export function AppLayout({ brand = '송월 QR 공정관리', nav, user, children }: AppLayoutProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className="density-admin flex min-h-dvh bg-surface-2">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-20 flex w-sidebar flex-col border-r border-line bg-brand-900 text-white transition-transform',
          'lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center px-4 text-ad-lg font-bold">{brand}</div>
        <nav className="flex-1 overflow-y-auto px-2 py-2">
          {nav.map((g, gi) => (
            <div key={gi} className="mb-3">
              {g.label ? <div className="px-2 pb-1 text-ad-xs font-semibold text-white/50 uppercase">{g.label}</div> : null}
              {g.items.map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  {...(it.end !== undefined ? { end: it.end } : {})}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex h-9 items-center gap-2 rounded-ad px-2 text-white/80 hover:bg-white/10 hover:text-white',
                      isActive && 'bg-white/15 font-semibold text-white',
                    )
                  }
                >
                  {it.icon}
                  <span className="truncate">{it.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        {user ? <div className="border-t border-white/10 px-4 py-3">{user}</div> : null}
      </aside>
      {open ? <div className="fixed inset-0 z-10 bg-ink/40 lg:hidden" onClick={() => setOpen(false)} /> : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 items-center border-b border-line bg-surface px-3 lg:hidden">
          <button type="button" onClick={() => setOpen(true)} aria-label="메뉴" className="flex h-9 w-9 items-center justify-center rounded-ad hover:bg-surface-3">
            <IconMenu size={20} />
          </button>
          <span className="ml-2 font-bold">{brand}</span>
        </div>
        <main className="flex-1 p-6">{children ?? <Outlet />}</main>
      </div>
    </div>
  )
}

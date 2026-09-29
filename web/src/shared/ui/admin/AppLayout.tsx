/**
 * 관리자 웹 레이아웃: 좌측 사이드바(그룹 내비) + 콘텐츠. 콘텐츠는 `children` 또는 라우터 <Outlet/>.
 * 메뉴 항목·사용자 정보·로그아웃은 admin/ 이 넘긴다. 이 컴포넌트는 인증을 모른다.
 *
 * 사이드바는 항상 `fixed` + transform 으로 슬라이딩한다(모바일 전용 드로어가 아니라 데스크톱에서도
 * 숨김·펼침이 된다). 데스크톱(lg+)에서 열려 있을 때는 콘텐츠 영역에 `ml-sidebar` 를 줘서 자리를 만들고,
 * 닫히면 콘텐츠가 전체 폭으로 확장된다(사이드바 자체는 항상 fixed 라 레이아웃 흔들림 없음). 모바일은
 * 기존처럼 오버레이(배경 어둡게)로 뜬다. 마지막 상태는 로컬에 저장해 새로고침해도 유지한다.
 */
import { useEffect, useState, type ReactNode } from 'react'
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

const SIDEBAR_OPEN_KEY = 'sw.admin.sidebarOpen'

function loadSidebarOpen(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_OPEN_KEY)
    return v === null ? true : v === '1'
  } catch {
    return true
  }
}

function saveSidebarOpen(open: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_OPEN_KEY, open ? '1' : '0')
  } catch {
    // 저장 실패해도 화면 동작에는 영향 없음(다음 새로고침에 기본값으로 열릴 뿐)
  }
}

export function AppLayout({ brand = '송월 QR 공정관리', nav, user, children }: AppLayoutProps) {
  const [open, setOpen] = useState(loadSidebarOpen)

  useEffect(() => saveSidebarOpen(open), [open])

  return (
    <div className="density-admin flex min-h-dvh bg-surface-2">
      <aside
        aria-hidden={!open}
        className={cn(
          'fixed inset-y-0 left-0 z-20 flex w-sidebar flex-col border-r border-line bg-brand-900 text-white',
          'transition-transform duration-200 ease-in-out',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center justify-between px-4 text-ad-lg font-bold">
          <span className="truncate">{brand}</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="메뉴 숨기기"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-ad text-white/70 hover:bg-white/10 hover:text-white"
          >
            <IconMenu size={18} />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-2">
          {nav.map((g, gi) => (
            <div key={gi} className="mb-3">
              {g.label ? <div className="px-2 pb-1 text-ad-xs font-semibold text-white/50 uppercase">{g.label}</div> : null}
              {g.items.map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  {...(it.end !== undefined ? { end: it.end } : {})}
                  onClick={() => setOpen(window.innerWidth >= 1024 ? open : false)}
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
      {/* 모바일은 배경을 어둡게 덮는 오버레이 드로어, 데스크톱은 아래 ml-sidebar 로 콘텐츠가 밀려나므로 오버레이 불필요 */}
      {open ? <div className="fixed inset-0 z-10 bg-ink/40 lg:hidden" onClick={() => setOpen(false)} /> : null}

      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col transition-[margin-left] duration-200 ease-in-out',
          open ? 'lg:ml-sidebar' : 'lg:ml-0',
        )}
      >
        <div className="flex h-12 items-center border-b border-line bg-surface px-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? '메뉴 숨기기' : '메뉴 펼치기'}
            aria-expanded={open}
            className="flex h-9 w-9 items-center justify-center rounded-ad hover:bg-surface-3"
          >
            <IconMenu size={20} />
          </button>
          <span className="ml-2 truncate font-bold lg:hidden">{brand}</span>
        </div>
        <main className="flex-1 p-6">{children ?? <Outlet />}</main>
      </div>
    </div>
  )
}

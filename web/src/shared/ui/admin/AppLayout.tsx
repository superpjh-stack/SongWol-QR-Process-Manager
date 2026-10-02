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
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { cn } from '../cn'
import { IconChevronRight, IconMenu } from '../icons'

/**
 * `active` 를 주면 NavLink 의 경로 일치 대신 그 값으로 강조한다(한 항목이 여러 경로를 대표할 때).
 * `badge` 는 처리할 건수 — 0 이면 넘기지 않는다.
 */
export type NavItem = { to: string; label: string; icon?: ReactNode; end?: boolean; active?: boolean; badge?: number }
export type NavSubGroup = { label: string; items: NavItem[] }
export type NavNode = NavItem | NavSubGroup
export type NavGroup = { label?: string; items: NavNode[] }

const isSubGroup = (node: NavNode): node is NavSubGroup => !('to' in node)

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

const matches = (it: NavItem, pathname: string) => pathname === it.to || pathname.startsWith(it.to + '/')
/** 하위 그룹 키 — 상위 그룹 라벨과 합쳐서 만든다(같은 이름의 하위 그룹이 다른 그룹에 있어도 안 겹치게). */
const subKey = (groupLabel: string, subLabel: string) => `${groupLabel}>${subLabel}`

/** 현재 경로가 속한 (상위 그룹 라벨, 하위 그룹 키) — 처음 열릴 때 그것만 펼쳐 보여준다. */
function activeOpenKeys(nav: NavGroup[], pathname: string): string[] {
  for (const g of nav) {
    if (!g.label) continue
    for (const node of g.items) {
      if (isSubGroup(node)) {
        if (node.items.some((it) => matches(it, pathname))) return [g.label, subKey(g.label, node.label)]
      } else if (matches(node, pathname)) {
        return [g.label]
      }
    }
  }
  return []
}

export function AppLayout({ brand = '송월 QR 공정관리', nav, user, children }: AppLayoutProps) {
  const [open, setOpen] = useState(loadSidebarOpen)
  const location = useLocation()
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set(activeOpenKeys(nav, location.pathname)))

  useEffect(() => saveSidebarOpen(open), [open])

  // 다른 화면(직접 링크·뒤로가기 등)으로 이동해도 그 화면이 속한 그룹·하위그룹은 자동으로 펼쳐 둔다.
  // 이미 펼쳐진 다른 그룹을 접지는 않는다 — 사용자가 직접 접은 것만 접힌 채로 둔다.
  useEffect(() => {
    const keys = activeOpenKeys(nav, location.pathname)
    if (keys.length === 0) return
    setOpenGroups((prev) => {
      const missing = keys.filter((k) => !prev.has(k))
      if (missing.length === 0) return prev
      const next = new Set(prev)
      missing.forEach((k) => next.add(k))
      return next
    })
  }, [location.pathname])

  const toggleGroup = (label: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })

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
          {nav.map((g, gi) => {
            const closeOnMobile = () => setOpen(window.innerWidth >= 1024 ? open : false)
            const renderLink = (it: NavItem, indent = false) => (
              <NavLink
                key={it.to}
                to={it.to}
                {...(it.end !== undefined ? { end: it.end } : {})}
                onClick={closeOnMobile}
                className={({ isActive }) =>
                  cn(
                    'flex h-9 items-center gap-2 rounded-ad px-2 text-white/80 hover:bg-white/10 hover:text-white',
                    indent && 'pl-4 text-[13px]',
                    (it.active ?? isActive) && 'bg-white/15 font-semibold text-white',
                  )
                }
              >
                {it.icon}
                <span className="truncate">{it.label}</span>
                {it.badge ? (
                  <span className="ml-auto rounded-full bg-status-warn-bg px-1.5 text-ad-xs font-semibold text-status-warn-fg tabular-nums">{it.badge}</span>
                ) : null}
              </NavLink>
            )

            // 라벨 없는 그룹(대시보드 등 단일 항목)은 아코디언 없이 평범한 링크로 보여준다.
            if (!g.label) {
              return <div key={gi} className="mb-1">{g.items.filter((n): n is NavItem => !isSubGroup(n)).map((it) => renderLink(it))}</div>
            }

            const groupLabel = g.label
            const isOpen = openGroups.has(groupLabel)
            return (
              <div key={gi} className="mb-1">
                <button
                  type="button"
                  onClick={() => toggleGroup(groupLabel)}
                  aria-expanded={isOpen}
                  className="flex h-8 w-full items-center justify-between rounded-ad px-2 text-ad-xs font-semibold text-white/50 uppercase hover:text-white/80"
                >
                  <span>{groupLabel}</span>
                  <IconChevronRight size={13} className={cn('transition-transform duration-150', isOpen && 'rotate-90')} />
                </button>
                <div className={cn('grid overflow-hidden transition-[grid-template-rows] duration-150 ease-in-out', isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
                  <div className="min-h-0">
                    {g.items.map((node, ni) => {
                      if (!isSubGroup(node)) return renderLink(node)
                      const key = subKey(groupLabel, node.label)
                      const subOpen = openGroups.has(key)
                      return (
                        <div key={ni}>
                          <button
                            type="button"
                            onClick={() => toggleGroup(key)}
                            aria-expanded={subOpen}
                            className="flex h-8 w-full items-center justify-between rounded-ad px-2 pl-3 text-[11.5px] font-medium text-white/45 hover:text-white/75"
                          >
                            <span>{node.label}</span>
                            <IconChevronRight size={11} className={cn('transition-transform duration-150', subOpen && 'rotate-90')} />
                          </button>
                          <div className={cn('grid overflow-hidden transition-[grid-template-rows] duration-150 ease-in-out', subOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
                            <div className="min-h-0">{node.items.map((it) => renderLink(it, true))}</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })}
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

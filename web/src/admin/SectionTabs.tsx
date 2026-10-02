/**
 * 섹션 탭 — 사이드바 섹션 안의 화면을 오가는 콘텐츠 상단 탭. 화면이 많은 섹션(기준정보)은 하위 탭 한 줄이 더 붙는다.
 * 상세·등록 화면에서도 보여서 "지금 어느 메뉴 안인지"와 목록으로 돌아가는 길을 겸한다.
 */
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { cn } from '@/shared/ui'
import { Tabs } from '@/shared/ui/admin'
import { useAuth } from '@/shared/hooks'
import { firstPath, locate, sectionsFor, type Badges } from './nav'

export function SectionTabs({ badges = {} }: { badges?: Badges }) {
  const { role } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const here = locate(sectionsFor(role), pathname)
  if (!here) return null

  const { section, tab, leaf } = here
  const subTabs = 'items' in tab && tab.items.length > 1 ? tab.items : null
  // 볼 수 있는 화면이 하나뿐이면 탭을 둘 이유가 없다.
  if (section.tabs.length < 2 && !subTabs) return null

  return (
    <div className="mb-4" data-component="SectionTabs">
      {section.tabs.length > 1 ? (
        <Tabs
          tabs={section.tabs.map((t) => ({ key: firstPath(t), label: t.label, badge: ('to' in t && badges[t.to]) || undefined }))}
          value={firstPath(tab)}
          onChange={(to) => navigate(to)}
        />
      ) : null}
      {subTabs ? (
        <nav aria-label={`${tab.label} 하위 메뉴`} className="mt-2 flex flex-wrap gap-1">
          {subTabs.map((it) => (
            <Link
              key={it.to}
              to={it.to}
              aria-current={it === leaf ? 'page' : undefined}
              className={cn(
                'inline-flex h-8 items-center rounded-full px-3 text-ad-xs font-medium',
                it === leaf ? 'bg-brand-600 text-white' : 'bg-surface-3 text-ink-muted hover:text-ink',
              )}
            >
              {it.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  )
}

/**
 * ADM-L 메뉴 구조 · 역할별 노출 (screens-admin §0.2). 권한 없음 = 숨김.
 *
 * 사이드바는 업무 흐름 순서의 섹션 5개만 보여주고(아코디언 없음), 섹션 안의 화면은 콘텐츠 상단 탭
 * (`SectionTabs`)으로 오간다. 화면이 많은 기준정보만 탭 아래에 하위 탭을 한 줄 더 둔다. URL 은 그대로다.
 */
import type { NavGroup } from '@/shared/ui/admin'
import type { Role } from '@/shared/types'
import { canRead, type ScreenKey } from './permissions'

/** `exact` = 그 경로일 때만 이 화면으로 본다(하위 경로를 가져가지 않는다). */
export type Leaf = { to: string; label: string; screen: ScreenKey; exact?: boolean }
export type TabGroup = { label: string; items: Leaf[] }
export type SectionTab = Leaf | TabGroup
export type Section = { label: string; tabs: SectionTab[] }

const isLeaf = (t: SectionTab): t is Leaf => 'to' in t

export const SECTIONS: Section[] = [
  {
    label: '현황·실적',
    tabs: [
      { to: '/admin', label: '대시보드', screen: 'dashboard', exact: true },
      { to: '/admin/reports/output', label: '실적 집계', screen: 'reports' },
      { to: '/admin/system/notifications', label: '알림', screen: 'system.notifications' },
    ],
  },
  {
    label: '주문·생산',
    tabs: [
      { to: '/admin/so', label: '수주', screen: 'so' },
      { to: '/admin/wo', label: '작업지시', screen: 'wo' },
      { to: '/admin/wo/pending', label: '예외 승인', screen: 'wo.pending' },
    ],
  },
  {
    label: '자재·재고',
    tabs: [
      // 재고 조정(/admin/material/stock/adjust)은 재고 현황의 버튼으로 들어간다.
      { to: '/admin/material/stock', label: '재고 현황', screen: 'material' },
      { to: '/admin/material/receipts', label: '입고', screen: 'material' },
      { to: '/admin/material/txns', label: '입출고 이력', screen: 'material' },
      { to: '/admin/material/vendor-barcodes', label: '업체 바코드', screen: 'material' },
    ],
  },
  {
    label: '출하',
    tabs: [
      // 발송 등록(/admin/shipping/new)은 포장·출하 목록의 버튼으로 들어간다.
      { to: '/admin/shipping', label: '포장·출하', screen: 'shipping' },
      { to: '/admin/shipping/daily', label: '출하 일보', screen: 'shipping' },
    ],
  },
  {
    label: '기준정보',
    tabs: [
      {
        label: '거래처·품목',
        items: [
          { to: '/admin/master/customers', label: '거래처', screen: 'master.customers' },
          { to: '/admin/master/items', label: '품목', screen: 'master.items' },
          { to: '/admin/master/item-groups', label: '품목군', screen: 'master.item-groups' },
        ],
      },
      {
        label: '생산 설정',
        items: [
          { to: '/admin/master/print-methods', label: '가공방식', screen: 'master.print-methods' },
          { to: '/admin/master/processes', label: '공정', screen: 'master.processes' },
          { to: '/admin/master/equipment', label: '설비', screen: 'master.equipment' },
          { to: '/admin/master/routings', label: '라우팅', screen: 'master.routings' },
        ],
      },
      {
        label: '단말·사용자',
        items: [
          { to: '/admin/master/stations', label: '단말', screen: 'master.stations' },
          { to: '/admin/master/users', label: '사용자', screen: 'master.users' },
        ],
      },
      {
        label: '라벨·코드',
        items: [
          { to: '/admin/master/labels', label: '라벨양식·프린터', screen: 'master.labels' },
          { to: '/admin/master/codes', label: '코드체계', screen: 'master.codes' },
        ],
      },
      {
        label: '데이터·이력',
        items: [
          { to: '/admin/master/import', label: '엑셀 일괄 등록', screen: 'master.import' },
          { to: '/admin/system/migration', label: '마이그레이션 현황', screen: 'system.migration' },
          { to: '/admin/system/audit', label: '감사 로그', screen: 'system.audit' },
        ],
      },
    ],
  },
]

const leavesOf = (t: SectionTab): Leaf[] => (isLeaf(t) ? [t] : t.items)

/** 역할로 거른 섹션. 탭 그룹은 안의 화면이 다 걸러지면, 섹션은 탭이 다 걸러지면 통째로 사라진다. */
export function sectionsFor(role: Role | null): Section[] {
  return SECTIONS.map((s) => ({
    label: s.label,
    tabs: s.tabs
      .map((t): SectionTab | null => {
        if (isLeaf(t)) return canRead(role, t.screen) ? t : null
        const items = t.items.filter((it) => canRead(role, it.screen))
        return items.length > 0 ? { label: t.label, items } : null
      })
      .filter((t): t is SectionTab => t !== null),
  })).filter((s) => s.tabs.length > 0)
}

const covers = (leaf: Leaf, pathname: string) => pathname === leaf.to || (!leaf.exact && pathname.startsWith(leaf.to + '/'))

export type Located = { section: Section; tab: SectionTab; leaf: Leaf }

/**
 * 현재 경로가 속한 섹션·탭·화면. 상세·등록 화면(`/admin/so/SO-…`, `/admin/shipping/new`)은 가장 길게
 * 맞는 목록 화면에 속한 것으로 본다(`/admin/wo/pending` 은 작업지시가 아니라 예외 승인).
 */
export function locate(sections: Section[], pathname: string): Located | null {
  let best: Located | null = null
  for (const section of sections) {
    for (const tab of section.tabs) {
      for (const leaf of leavesOf(tab)) {
        if (covers(leaf, pathname) && (!best || leaf.to.length > best.leaf.to.length)) best = { section, tab, leaf }
      }
    }
  }
  return best
}

/** 탭(또는 섹션)을 눌렀을 때 갈 곳 = 그 안에서 볼 수 있는 첫 화면 */
export const firstPath = (t: SectionTab): string => leavesOf(t)[0]!.to

/** 처리할 건수 배지 — 화면 경로별(예: `/admin/wo/pending` → 승인 대기 건수). 사이드바는 섹션 합계를 보여준다. */
export type Badges = Record<string, number>

export function navFor(role: Role | null, pathname: string, badges: Badges = {}): NavGroup[] {
  const sections = sectionsFor(role)
  const current = locate(sections, pathname)?.section.label
  return [
    {
      items: sections.map((s) => {
        const badge = s.tabs.flatMap(leavesOf).reduce((sum, leaf) => sum + (badges[leaf.to] ?? 0), 0)
        return { to: firstPath(s.tabs[0]!), label: s.label, active: s.label === current, ...(badge > 0 ? { badge } : {}) }
      }),
    },
  ]
}

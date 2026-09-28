/** ADM-L 사이드바 메뉴 트리 · 역할별 노출 (screens-admin §0.2). 권한 없음 = 숨김 */
import type { NavGroup } from '@/shared/ui/admin'
import type { Role } from '@/shared/types'
import { canRead, type ScreenKey } from './permissions'

type Entry = { to: string; label: string; screen: ScreenKey; end?: boolean }
type Group = { label: string; items: Entry[] }

export const NAV_TREE: Group[] = [
  { label: '대시보드', items: [{ to: '/admin', label: '대시보드', screen: 'dashboard', end: true }] },
  { label: '수주', items: [{ to: '/admin/so', label: '수주 목록', screen: 'so' }] },
  {
    label: '작업지시',
    items: [
      { to: '/admin/wo', label: '작업지시 목록', screen: 'wo', end: true },
      { to: '/admin/wo/pending', label: '예외 승인', screen: 'wo.pending' },
    ],
  },
  {
    label: '입고·재고',
    items: [
      { to: '/admin/material/receipts', label: '입고 목록', screen: 'material' },
      { to: '/admin/material/stock', label: '재고 현황', screen: 'material', end: true },
      { to: '/admin/material/stock/adjust', label: '재고 조정', screen: 'material.adjust' },
      { to: '/admin/material/txns', label: '입출고 이력', screen: 'material' },
      { to: '/admin/material/vendor-barcodes', label: '업체 바코드 매핑', screen: 'material' },
    ],
  },
  {
    label: '포장·출하',
    items: [
      { to: '/admin/shipping', label: '포장·출하 목록', screen: 'shipping', end: true },
      { to: '/admin/shipping/new', label: '발송 등록', screen: 'shipping.new' },
      { to: '/admin/shipping/daily', label: '출하 일보', screen: 'shipping' },
    ],
  },
  {
    label: '실적·분석',
    items: [
      { to: '/admin/reports/output', label: '실적 집계', screen: 'reports' },
      { to: '/admin/trace', label: 'LOT 역추적', screen: 'trace' },
    ],
  },
  {
    label: '기준정보',
    items: [
      { to: '/admin/master/customers', label: '거래처', screen: 'master.customers' },
      { to: '/admin/master/items', label: '품목', screen: 'master.items' },
      { to: '/admin/master/item-groups', label: '품목군', screen: 'master.item-groups' },
      { to: '/admin/master/print-methods', label: '가공방식', screen: 'master.print-methods' },
      { to: '/admin/master/processes', label: '공정', screen: 'master.processes' },
      { to: '/admin/master/equipment', label: '설비', screen: 'master.equipment' },
      { to: '/admin/master/routings', label: '라우팅', screen: 'master.routings' },
      { to: '/admin/master/stations', label: '단말', screen: 'master.stations' },
      { to: '/admin/master/users', label: '사용자', screen: 'master.users' },
      { to: '/admin/master/labels', label: '라벨양식·프린터', screen: 'master.labels' },
      { to: '/admin/master/codes', label: '코드체계', screen: 'master.codes' },
      { to: '/admin/master/import', label: '엑셀 일괄 등록', screen: 'master.import' },
    ],
  },
  {
    label: '시스템',
    items: [
      { to: '/admin/system/notifications', label: '알림 이력', screen: 'system.notifications' },
      { to: '/admin/system/audit', label: '감사 로그', screen: 'system.audit' },
      { to: '/admin/system/migration', label: '마이그레이션 현황', screen: 'system.migration' },
    ],
  },
]

export function navFor(role: Role | null): NavGroup[] {
  return NAV_TREE.map((g) => ({
    label: g.label,
    items: g.items.filter((it) => canRead(role, it.screen)).map(({ to, label, end }) => ({ to, label, ...(end !== undefined ? { end } : {}) })),
  })).filter((g) => g.items.length > 0)
}

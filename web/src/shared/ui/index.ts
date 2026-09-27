/**
 * 공용 UI 진입점.
 *   현장(키오스크·PDA·현황판): import { BigButton, NumPad, ... } from '@/shared/ui/shopfloor'
 *   관리자 웹:                import { DataTable, Input, ... } from '@/shared/ui/admin'
 *   양쪽 공통:                StatusBadge · status 매핑 · 아이콘 · cn
 */
export { cn } from './cn'
export { StatusBadge } from './StatusBadge'
export type { StatusBadgeProps, Density } from './StatusBadge'
export * from './status'
export * as Icons from './icons'

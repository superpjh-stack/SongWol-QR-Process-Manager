/**
 * 역할별 화면 접근 (screens-admin §0.2 표 = api-contract §4 + §13.8). 「권한 없음 = 숨김」, 쓰기 버튼은 `disabled`.
 * W: 읽기+쓰기 · R: 읽기 · null: 숨김.
 */
import type { ImportEntity, Role } from '@/shared/types'

export type Access = 'W' | 'R' | null

export type ScreenKey =
  | 'dashboard' // ADM-28
  | 'so' // ADM-12·13·14
  | 'wo' // ADM-15·16
  | 'wo.pending' // ADM-17
  | 'material' // ADM-18·19·21
  | 'material.adjust' // ADM-20
  | 'shipping' // ADM-22·24
  | 'shipping.new' // ADM-23
  | 'reports' // ADM-25·26
  | 'trace' // ADM-27
  | 'master.customers' // ADM-01
  | 'master.items' // ADM-02
  | 'master.print-methods' // ADM-03
  | 'master.processes' // ADM-04
  | 'master.equipment' // ADM-05
  | 'master.routings' // ADM-06
  | 'master.stations' // ADM-07
  | 'master.users' // ADM-08
  | 'master.labels' // ADM-09 [S1]
  | 'master.codes' // ADM-10
  | 'master.import' // ADM-11
  | 'system.notifications' // ADM-29
  | 'system.audit' // ADM-30
  | 'system.migration' // ADM-31

type Row = [ADMIN: Access, MANAGER: Access, SALES: Access, WORKER: Access, VIEWER: Access]
const ROLE_INDEX: Record<Role, number> = { ADMIN: 0, MANAGER: 1, SALES: 2, WORKER: 3, VIEWER: 4 }

const MATRIX: Record<ScreenKey, Row> = {
  dashboard: ['R', 'R', 'R', 'R', 'R'],
  so: ['W', 'W', 'W', 'R', 'R'],
  wo: ['W', 'W', 'R', 'R', 'R'],
  'wo.pending': ['W', 'W', null, null, null],
  material: ['W', 'W', 'R', 'R', 'R'],
  'material.adjust': ['W', 'W', null, null, null],
  shipping: ['W', 'W', 'R', 'R', 'R'],
  'shipping.new': ['W', 'W', null, null, null],
  reports: ['R', 'R', 'R', 'R', 'R'],
  trace: ['R', 'R', 'R', 'R', 'R'],
  'master.customers': ['W', 'R', 'W', 'R', null],
  'master.items': ['W', 'R', 'W', 'R', null],
  'master.print-methods': ['W', 'W', 'R', 'R', null],
  'master.processes': ['W', 'W', 'R', 'R', null],
  'master.equipment': ['W', 'W', 'R', 'R', null],
  'master.routings': ['W', 'W', 'R', 'R', null],
  'master.stations': ['W', 'R', null, null, null],
  'master.users': ['W', 'R', null, null, null],
  'master.labels': ['W', 'R', null, null, null],
  'master.codes': ['W', 'R', null, null, null],
  // ADM-11: customer/item = ADMIN W · SALES W, stock = ADMIN W · MANAGER W (§13.1 admin #13)
  'master.import': ['W', 'W', 'W', null, null],
  'system.notifications': ['W', 'W', 'W', null, 'R'],
  'system.audit': ['W', 'R', null, null, null],
  'system.migration': ['W', 'R', null, null, null],
}

export function access(role: Role | null, screen: ScreenKey): Access {
  if (!role) return null
  return MATRIX[screen][ROLE_INDEX[role]] ?? null
}
export const canRead = (role: Role | null, screen: ScreenKey) => access(role, screen) !== null
export const canWrite = (role: Role | null, screen: ScreenKey) => access(role, screen) === 'W'

/** ADM-11 대상별 권한: customer/item = ADMIN·SALES, stock = ADMIN·MANAGER */
export function importEntitiesFor(role: Role | null): ImportEntity[] {
  switch (role) {
    case 'ADMIN':
      return ['customer', 'item', 'stock']
    case 'SALES':
      return ['customer', 'item']
    case 'MANAGER':
      return ['stock']
    default:
      return []
  }
}

/** 공정 등록(POST /processes)은 ADMIN 만 (api-contract §7.2) */
export const canCreateProcess = (role: Role | null) => role === 'ADMIN'

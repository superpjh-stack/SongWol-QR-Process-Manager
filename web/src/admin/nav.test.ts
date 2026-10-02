import { describe, expect, it } from 'vitest'
import { locate, navFor, sectionsFor } from './nav'

const labels = (role: Parameters<typeof navFor>[0], pathname = '/admin') => navFor(role, pathname)[0]!.items.map((it) => ('to' in it ? it.label : ''))

describe('navFor — 사이드바는 섹션만', () => {
  it('ADMIN 은 업무 흐름 순서의 5개 섹션을 본다', () => {
    expect(labels('ADMIN')).toEqual(['현황·실적', '주문·생산', '자재·재고', '출하', '기준정보'])
  })

  it('VIEWER 는 볼 화면이 없는 기준정보 섹션이 통째로 사라진다', () => {
    expect(labels('VIEWER')).toEqual(['현황·실적', '주문·생산', '자재·재고', '출하'])
  })

  it('상세 화면에서도 그 화면이 속한 섹션이 강조된다', () => {
    const items = navFor('ADMIN', '/admin/wo/WO-260929-0001')[0]!.items
    expect(items.filter((it) => 'to' in it && it.active).map((it) => it.label)).toEqual(['주문·생산'])
  })

  it('승인 대기 건수는 섹션 배지로 올라온다', () => {
    const items = navFor('MANAGER', '/admin', { '/admin/wo/pending': 3 })[0]!.items
    expect(items.find((it) => it.label === '주문·생산')).toMatchObject({ badge: 3 })
    expect(items.find((it) => it.label === '출하')).not.toHaveProperty('badge')
  })
})

describe('locate — 경로가 속한 탭', () => {
  const at = (pathname: string, role: Parameters<typeof sectionsFor>[0] = 'ADMIN') => {
    const here = locate(sectionsFor(role), pathname)
    return here ? [here.section.label, here.tab.label, here.leaf.label] : null
  }

  it('가장 길게 맞는 화면을 고른다', () => {
    expect(at('/admin/wo/pending')).toEqual(['주문·생산', '예외 승인', '예외 승인'])
    expect(at('/admin/wo/WO-260929-0001')).toEqual(['주문·생산', '작업지시', '작업지시'])
    expect(at('/admin/shipping/new')).toEqual(['출하', '포장·출하', '포장·출하'])
    expect(at('/admin/material/stock/adjust')).toEqual(['자재·재고', '재고 현황', '재고 현황'])
  })

  it('기준정보는 탭 그룹 안의 화면까지 찾는다', () => {
    expect(at('/admin/master/routings/12')).toEqual(['기준정보', '생산 설정', '라우팅'])
    expect(at('/admin/system/audit')).toEqual(['기준정보', '데이터·이력', '감사 로그'])
  })

  it('대시보드는 정확히 /admin 일 때만이다', () => {
    expect(at('/admin')).toEqual(['현황·실적', '대시보드', '대시보드'])
    expect(at('/admin/no-such-page')).toBeNull()
  })

  it('권한 없는 화면은 찾지 않는다', () => {
    expect(at('/admin/wo/pending', 'SALES')).toEqual(['주문·생산', '작업지시', '작업지시'])
    expect(at('/admin/master/users', 'SALES')).toBeNull()
  })
})

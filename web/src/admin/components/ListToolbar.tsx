/** 목록 필터 바 (screens-admin §0.6): q 검색 · active 셀렉트(활성/비활성/전체, 기본 활성) · size 선택 · 추가 필터 슬롯 */
import { useEffect, useState, type ReactNode } from 'react'
import { Button, Input, Select } from '@/shared/ui/admin'
import { PAGE_SIZES, type ActiveFilter, type ListParams } from './useListParams'

export function ListToolbar({ params, children, withQ = true, withActive = true }: { params: ListParams; children?: ReactNode; withQ?: boolean; withActive?: boolean }) {
  const [q, setQ] = useState(params.q)
  useEffect(() => setQ(params.q), [params.q])
  return (
    <form
      className="mb-3 flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        params.setQ(q.trim())
      }}
    >
      {withQ ? (
        <Input label="검색" placeholder="코드·명 검색" value={q} onChange={(e) => setQ(e.target.value)} wrapperClassName="w-64" aria-label="검색" />
      ) : null}
      {withActive ? (
        <Select
          label="활성"
          value={params.active}
          onChange={(e) => params.setActive(e.target.value as ActiveFilter)}
          options={[
            { value: 'true', label: '활성' },
            { value: 'false', label: '비활성' },
            { value: 'all', label: '전체' },
          ]}
          wrapperClassName="w-28"
        />
      ) : null}
      {children}
      <Select
        label="페이지 크기"
        value={String(params.size)}
        onChange={(e) => params.setSize(Number(e.target.value))}
        options={PAGE_SIZES.map((s) => ({ value: String(s), label: String(s) }))}
        wrapperClassName="w-28"
      />
      {withQ ? (
        <Button type="submit" variant="secondary">
          조회
        </Button>
      ) : null}
      <Button type="button" variant="ghost" onClick={params.reset}>
        필터 초기화
      </Button>
    </form>
  )
}

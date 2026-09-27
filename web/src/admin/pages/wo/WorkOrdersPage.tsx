/** ADM-15 WO 목록 — GET /wo?so_code&status&process_code&delay=true&q&page&size&sort. 정렬 admin #4, 기본 -due_date (§14.6) */
import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, DataTable, Input, PageHeader, Select } from '@/shared/ui/admin'
import { WO_STATUS_VALUES } from '@/shared/ui'
import { useArray, useAuth, useList } from '@/shared/hooks'
import type { Process, WorkOrderSummary, WoStatus } from '@/shared/types'
import { WO_STATUS } from '@/shared/ui'
import { canRead } from '../../permissions'
import { ApiErrorAlert, Checkbox, ListToolbar, serverTable, useListParams } from '../../components'
import { processNameFn, woColumns } from './woColumns'

const STATUS_OPTIONS = WO_STATUS_VALUES.map((s: WoStatus) => ({ value: s, label: `${s} ${WO_STATUS[s].label}` }))

export function WorkOrdersPage() {
  const { role } = useAuth()
  const navigate = useNavigate()
  const params = useListParams({ defaultSort: '-due_date', withActive: false, extraKeys: ['so_code', 'status', 'process_code', 'delay'] })
  const list = useList<WorkOrderSummary>('wo', params.query)
  const processes = useArray<Process>('processes')
  const columns = useMemo(() => woColumns(processNameFn(processes.data)), [processes.data])
  return (
    <>
      <PageHeader
        title="작업지시 목록"
        breadcrumb="작업지시 › 목록 (ADM-15)"
        description="상태·현재 공정·지연·수량 캐시. 행 → WO 상세"
        actions={canRead(role, 'wo.pending') ? <Link to="/admin/wo/pending" className="text-brand-700 hover:underline">예외 승인 대기 → [S2-3]</Link> : null}
      />
      <ListToolbar params={params} withActive={false}>
        <Input label="수주번호" placeholder="SO-…" value={params.extra.so_code ?? ''} onChange={(e) => params.setExtra('so_code', e.target.value.trim().toUpperCase())} wrapperClassName="w-44" className="font-mono uppercase" />
        <Select label="상태" value={params.extra.status ?? ''} onChange={(e) => params.setExtra('status', e.target.value)} options={STATUS_OPTIONS} placeholder="전체" wrapperClassName="w-40" />
        <Select
          label="현재 공정"
          value={params.extra.process_code ?? ''}
          onChange={(e) => params.setExtra('process_code', e.target.value)}
          options={(processes.data ?? []).filter((p) => p.active).sort((a, b) => a.seq - b.seq).map((p) => ({ value: p.code, label: `${p.code} ${p.name}` }))}
          placeholder="전체"
          wrapperClassName="w-40"
        />
        <Checkbox label="지연 위험만" checked={params.extra.delay === 'true'} onChange={(e) => params.setExtra('delay', e.target.checked ? 'true' : '')} />
      </ListToolbar>
      <DataTable<WorkOrderSummary>
        columns={columns}
        rows={list.data?.items ?? []}
        rowKey={(r) => r.id}
        loading={list.loading}
        error={list.error ? <ApiErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : undefined}
        emptyText="조회 조건에 해당하는 데이터가 없습니다"
        emptyAction={
          <Button variant="secondary" onClick={params.reset}>
            필터 초기화
          </Button>
        }
        onRowClick={(r) => navigate(`/admin/wo/${encodeURIComponent(r.code)}`)}
        {...serverTable(params, list.data)}
      />
    </>
  )
}

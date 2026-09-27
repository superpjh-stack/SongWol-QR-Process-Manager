/** ADM-12 수주 목록 — GET /so?from&to&customer_id&status&due_within_days&delay=true&q. 정렬 admin #4 (기본 due_date 오름차순, §14.6) */
import { useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, DataTable, DateInput, NumberInput, PageHeader, ProgressBar, SearchSelect, Select, type Column } from '@/shared/ui/admin'
import { SO_STATUS, SO_STATUS_VALUES, StatusBadge } from '@/shared/ui'
import { useAuth, useList, useOne } from '@/shared/hooks'
import type { Customer, SalesOrderSummary, SoStatus } from '@/shared/types'
import { formatDate, formatDateTime, isOverdue } from '../../format'
import { canWrite } from '../../permissions'
import { ApiErrorAlert, Checkbox, CodeText, ListToolbar, serverTable, useListParams } from '../../components'
import { apiErrorText, customerLabel, searchCustomers } from './customerSearch'

const STATUS_OPTIONS = SO_STATUS_VALUES.map((s: SoStatus) => ({ value: s, label: `${s} ${SO_STATUS[s].label}` }))
const EXTRA = ['from', 'to', 'customer_id', 'status', 'due_within_days', 'delay']


export function SalesOrdersPage() {
  const { role } = useAuth()
  const navigate = useNavigate()
  const params = useListParams({ defaultSort: 'due_date', withActive: false, extraKeys: EXTRA })
  const list = useList<SalesOrderSummary>('so', params.query)
  const customerId = params.extra.customer_id ? Number(params.extra.customer_id) : null
  const customer = useOne<Customer>('customers', customerId)
  const search = useCallback(searchCustomers, [])

  const columns: Column<SalesOrderSummary>[] = [
    {
      key: 'code',
      header: '수주번호',
      sortable: true,
      render: (r) => (
        <Link to={`/admin/so/${encodeURIComponent(r.code)}`} className="text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
          <CodeText code={r.code} />
        </Link>
      ),
    },
    { key: 'customer', header: '거래처', render: (r) => r.customer.name ?? r.customer.code },
    { key: 'order_date', header: '수주일', sortable: true, render: (r) => <span className="tabular-nums">{formatDate(r.order_date)}</span> },
    {
      key: 'due_date',
      header: '납기일',
      sortable: true,
      render: (r) => <span className={isOverdue(r.due_date, r.status) ? 'font-semibold tabular-nums text-status-error-fg' : 'tabular-nums'}>{formatDate(r.due_date)}</span>,
    },
    { key: 'status', header: '상태', sortable: true, render: (r) => <StatusBadge kind="so" status={r.status} /> },
    { key: 'progress_pct', header: '진행률', sortable: true, width: '160px', render: (r) => <ProgressBar value={r.progress_pct} /> },
    { key: 'delay_risk', header: '지연 위험', render: (r) => (r.delay_risk ? <StatusBadge kind="delay" status={true} /> : <span className="text-ink-faint">—</span>) },
    {
      key: 'line_count',
      header: '라인/WO',
      align: 'right',
      render: (r) => (
        <span className="tabular-nums">
          {r.line_count} / {r.wo_count}
        </span>
      ),
    },
    { key: 'confirmed_at', header: '확정', render: (r) => <span className="tabular-nums">{formatDateTime(r.confirmed_at)}</span> },
    { key: 'shipped_at', header: '발송', render: (r) => <span className="tabular-nums">{formatDateTime(r.shipped_at)}</span> },
  ]

  return (
    <>
      <PageHeader
        title="수주 목록"
        breadcrumb="수주 › 목록 (ADM-12)"
        description="기간·거래처·상태·납기 임박·지연 위험 필터. 진행률은 WO 실적 집계 (S2 전에는 0)"
        actions={
          <Button variant="primary" disabled={!canWrite(role, 'so')} onClick={() => navigate('/admin/so/new')}>
            수주 등록
          </Button>
        }
      />
      <ListToolbar params={params} withActive={false}>
        <DateInput label="수주일 부터" value={params.extra.from ?? ''} onChange={(e) => params.setExtra('from', e.target.value)} wrapperClassName="w-40" />
        <DateInput label="수주일 까지" value={params.extra.to ?? ''} onChange={(e) => params.setExtra('to', e.target.value)} wrapperClassName="w-40" />
        <SearchSelect<Customer>
          label="거래처"
          value={customerId !== null ? (customer.data ?? ({ id: customerId, code: '', name: `#${customerId}` } as Customer)) : null}
          onChange={(c) => params.setExtra('customer_id', c ? String(c.id) : '')}
          search={search}
          getKey={(c) => c.id}
          getLabel={customerLabel}
          errorText={apiErrorText}
          placeholder="거래처 검색"
          wrapperClassName="w-56"
        />
        <Select label="상태" value={params.extra.status ?? ''} onChange={(e) => params.setExtra('status', e.target.value)} options={STATUS_OPTIONS} placeholder="전체" wrapperClassName="w-44" />
        <NumberInput label="납기 임박" unit="일" min={0} value={params.extra.due_within_days ?? ''} onChange={(e) => params.setExtra('due_within_days', e.target.value)} wrapperClassName="w-28" />
        <Checkbox label="지연 위험만" checked={params.extra.delay === 'true'} onChange={(e) => params.setExtra('delay', e.target.checked ? 'true' : '')} />
      </ListToolbar>
      <DataTable<SalesOrderSummary>
        columns={columns}
        rows={list.data?.items ?? []}
        rowKey={(r) => r.id}
        loading={list.loading}
        error={list.error ? <ApiErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : undefined}
        emptyText="조회 조건에 해당하는 데이터가 없습니다"
        emptyAction={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={params.reset}>
              필터 초기화
            </Button>
            {canWrite(role, 'so') ? (
              <Button variant="primary" onClick={() => navigate('/admin/so/new')}>
                수주 등록
              </Button>
            ) : null}
          </div>
        }
        onRowClick={(r) => navigate(`/admin/so/${encodeURIComponent(r.code)}`)}
        {...serverTable(params, list.data)}
      />
    </>
  )
}

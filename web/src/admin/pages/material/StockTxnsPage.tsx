/**
 * ADM-21 입출고 이력 (A3-07) — [S3-5]
 * `GET /stock/txns?item_id&from&to&txn_type&source&page&size` → Page<StockTxn>. 출처 배지로 IMS 엑셀/실사/신규 구분.
 * 참조(ref_type·ref_id)는 material_receipt→ADM-18·shipment→ADM-22·migration_batch→ADM-31·work_order→ADM-16 이지만,
 * ref_id 가 각 화면의 라우트 키(코드/행 id)와 일치한다는 보장이 계약에 없어 클릭 가능한 링크 대신 텍스트로만 표시한다.
 */
import { cn } from '@/shared/ui'
import { DataTable, DateInput, PageHeader, SearchSelect, Select, StatusBadge, type Column } from '@/shared/ui/admin'
import { useList, useOne } from '@/shared/hooks'
import { STOCK_SOURCES, STOCK_TXN_TYPES } from '@/shared/types'
import type { Item, StockTxn } from '@/shared/types'
import { MigrationSourceLabel, StockTxnTypeLabel } from '@/shared/labels'
import { formatDateTime, formatQty } from '../../format'
import { ApiErrorAlert, CodeText, ListToolbar, serverTable, useListParams } from '../../components'
import { apiErrorText, itemLabel, searchItems } from './itemSearch'

const REF_TYPE_LABEL: Record<string, string> = {
  material_receipt: '입고',
  shipment: '출하',
  migration_batch: '마이그레이션',
  work_order: '작업지시',
}

export function StockTxnsPage() {
  const params = useListParams({ extraKeys: ['item_id', 'from', 'to', 'txn_type', 'source'], withActive: false })
  const list = useList<StockTxn>('stock/txns', params.query)
  const itemId = params.extra.item_id ? Number(params.extra.item_id) : null
  const itemQ = useOne<Item>('items', itemId)

  const columns: Column<StockTxn>[] = [
    { key: 'created_at', header: '시각', render: (r) => <span className="tabular-nums">{formatDateTime(r.created_at, true)}</span> },
    {
      key: 'item',
      header: '품목',
      render: (r) => (
        <span>
          <CodeText code={r.item.code} /> {r.item.name}
        </span>
      ),
    },
    { key: 'txn_type', header: '구분', render: (r) => StockTxnTypeLabel[r.txn_type] ?? r.txn_type },
    {
      key: 'qty',
      header: '수량',
      align: 'right',
      render: (r) => (
        <span className={cn('font-semibold tabular-nums', r.qty < 0 ? 'text-status-error-fg' : 'text-status-done-fg')}>
          {r.qty > 0 ? '+' : ''}
          {formatQty(r.qty)}
        </span>
      ),
    },
    { key: 'source', header: '출처', render: (r) => <StatusBadge kind="source" status={r.source} /> },
    {
      key: 'ref',
      header: '참조',
      render: (r) => (r.ref_type ? <span className="text-ad-xs">{REF_TYPE_LABEL[r.ref_type] ?? r.ref_type} #{r.ref_id}</span> : '—'),
    },
    { key: 'reason', header: '사유', render: (r) => r.reason ?? '—' },
    { key: 'created_by', header: '등록자', render: (r) => r.created_by?.name ?? '—' },
  ]

  return (
    <>
      <PageHeader title="입출고 이력" breadcrumb="자재·재고 › 입출고 이력 (ADM-21)" description="신규 이력 + IMS 이관 이력을 한 화면에서, 출처 구분 표시 (IMS 엑셀/실사/신규)" />
      <ListToolbar params={params} withQ={false} withActive={false}>
        <SearchSelect<Item>
          label="품목"
          value={itemId !== null ? (itemQ.data ?? ({ id: itemId, code: '', name: `#${itemId}` } as Item)) : null}
          onChange={(i) => params.setExtra('item_id', i ? String(i.id) : '')}
          search={searchItems}
          getKey={(i) => i.id}
          getLabel={itemLabel}
          errorText={apiErrorText}
          placeholder="품목 검색"
          wrapperClassName="w-56"
        />
        <DateInput label="부터" value={params.extra.from ?? ''} onChange={(e) => params.setExtra('from', e.target.value)} wrapperClassName="w-40" />
        <DateInput label="까지" value={params.extra.to ?? ''} onChange={(e) => params.setExtra('to', e.target.value)} wrapperClassName="w-40" />
        <Select label="구분" value={params.extra.txn_type ?? ''} onChange={(e) => params.setExtra('txn_type', e.target.value)} options={STOCK_TXN_TYPES.map((t) => ({ value: t, label: StockTxnTypeLabel[t] }))} placeholder="전체" wrapperClassName="w-32" />
        <Select label="출처" value={params.extra.source ?? ''} onChange={(e) => params.setExtra('source', e.target.value)} options={STOCK_SOURCES.map((s) => ({ value: s, label: MigrationSourceLabel[s] }))} placeholder="전체" wrapperClassName="w-32" />
      </ListToolbar>
      <DataTable<StockTxn>
        columns={columns}
        rows={list.data?.items ?? []}
        rowKey={(r) => r.id}
        loading={list.loading}
        error={list.error ? <ApiErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : undefined}
        emptyText="조회 조건에 해당하는 데이터가 없습니다"
        {...serverTable(params, list.data)}
      />
    </>
  )
}

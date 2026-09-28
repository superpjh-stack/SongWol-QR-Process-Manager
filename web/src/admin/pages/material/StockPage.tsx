/**
 * ADM-19 재고 현황 (A3-05) — [S3-5]
 * `GET /stock?q&item_group&page&size` → Page<StockRow> (= v_stock_current). 행 액션: [이력→ADM-21] [조정→ADM-20, ADMIN/MANAGER].
 * 정렬 허용 컬럼이 계약에 없어 정렬 UI 는 두지 않는다 (§3 #4). Excel 내보내기 없음 (§3 #29).
 */
import { Link, useNavigate } from 'react-router-dom'
import { Button, DataTable, PageHeader, Select, type Column } from '@/shared/ui/admin'
import { useArray, useAuth, useList } from '@/shared/hooks'
import type { ItemGroup, StockRow } from '@/shared/types'
import { formatDateTime, formatQty } from '../../format'
import { canWrite } from '../../permissions'
import { ApiErrorAlert, ListToolbar, RowActions, serverTable, useListParams } from '../../components'

export function StockPage() {
  const { role } = useAuth()
  const navigate = useNavigate()
  const manage = canWrite(role, 'material.adjust')
  const params = useListParams({ extraKeys: ['item_group'], withActive: false })
  const list = useList<StockRow>('stock', params.query)
  const groups = useArray<ItemGroup>('item-groups', { active: true })

  const columns: Column<StockRow>[] = [
    {
      key: 'item_code',
      header: '품목',
      render: (r) => (
        <span className="flex flex-col">
          <span>
            <span className="font-mono">{r.item_code}</span> {r.item_name}
          </span>
          <span className="text-ad-xs text-ink-muted">{[r.spec, r.color].filter(Boolean).join(' · ') || '—'}</span>
        </span>
      ),
    },
    { key: 'qty_on_hand', header: '현재고', align: 'right', render: (r) => <span className="font-semibold tabular-nums">{formatQty(r.qty_on_hand)}</span> },
    { key: 'updated_at', header: '갱신', render: (r) => <span className="tabular-nums">{formatDateTime(r.updated_at)}</span> },
    { key: 'last_receive_at', header: '최근 입고', render: (r) => <span className="tabular-nums">{formatDateTime(r.last_receive_at)}</span> },
    { key: 'last_ship_at', header: '최근 발송', render: (r) => <span className="tabular-nums">{formatDateTime(r.last_ship_at)}</span> },
    {
      key: '_actions',
      header: '',
      render: (r) => (
        <RowActions>
          <Link to={`/admin/material/txns?item_id=${r.item_id}`} className="text-ad-xs text-brand-700 hover:underline">
            이력
          </Link>
          {manage ? (
            <Button size="sm" variant="secondary" onClick={() => navigate(`/admin/material/stock/adjust?item_id=${r.item_id}`)}>
              조정
            </Button>
          ) : null}
        </RowActions>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="재고 현황"
        breadcrumb="입고·재고 › 재고 현황 (ADM-19)"
        description="현재고 = 이관 기초재고 + 입고 − 발송 ± 조정. 창고/위치 구분 없음 (spec A3-05 단일 확인). Excel 내보내기 없음 (§3 #29)"
      />
      <ListToolbar params={params} withActive={false}>
        <Select
          label="품목군"
          value={params.extra.item_group ?? ''}
          onChange={(e) => params.setExtra('item_group', e.target.value)}
          options={(groups.data ?? []).map((g) => ({ value: g.code, label: `${g.code} ${g.name}` }))}
          placeholder="전체"
          wrapperClassName="w-44"
        />
      </ListToolbar>
      {groups.error ? <ApiErrorAlert error={groups.error} onRetry={() => void groups.refetch()} className="mb-3" /> : null}
      <DataTable<StockRow>
        columns={columns}
        rows={list.data?.items ?? []}
        rowKey={(r) => r.item_id}
        loading={list.loading}
        error={list.error ? <ApiErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : undefined}
        emptyText="조회 조건에 해당하는 데이터가 없습니다"
        emptyAction={
          <Button variant="secondary" onClick={params.reset}>
            필터 초기화
          </Button>
        }
        {...serverTable(params, list.data)}
      />
    </>
  )
}

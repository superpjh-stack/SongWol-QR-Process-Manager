/**
 * ADM-18 입고 목록 (A3-01·A3-03·A3-08) — [S3-1·S3-4]
 * `GET /receipts?from&to&item_id&wo_code&inspection&page&size` → Page<Receipt>. LOT 격리/해제는 ADMIN/MANAGER
 * (material.adjust 권한에 준함, §3 #13). 입고 등록은 PDA 전용 — 웹에는 만들지 않는다.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, DataTable, DateInput, Input, PageHeader, Select, SearchSelect, StatusBadge, useToast, type Column } from '@/shared/ui/admin'
import { useApiMutation, useAuth, useList, useOne } from '@/shared/hooks'
import { lotsApi } from '@/shared/api'
import { INSPECTION_STATUS_VALUES } from '@/shared/ui'
import type { Item, Receipt } from '@/shared/types'
import { InspectionLabel } from '@/shared/labels'
import { formatDateTime, formatQty } from '../../format'
import { canWrite } from '../../permissions'
import { ApiErrorAlert, CodeText, ListToolbar, ReasonDialog, RowActions, ConfirmDialog, serverTable, useListParams } from '../../components'
import { apiErrorText, itemLabel, searchItems } from './itemSearch'

const INSPECTION_OPTIONS = INSPECTION_STATUS_VALUES.map((s) => ({ value: s, label: InspectionLabel[s] }))

function QuarantineDialog({ receipt, onClose, onDone }: { receipt: Receipt | null; onClose: () => void; onDone: (msg: string) => void }) {
  const mut = useApiMutation((memo: string) => lotsApi.quarantine(receipt!.lot_code, memo))
  return (
    <ReasonDialog
      open={receipt !== null}
      title={`LOT 격리 — ${receipt?.lot_code ?? ''}`}
      reasonLabel="격리 사유 (반품·교환 메모)"
      maxLength={300}
      confirmLabel="격리"
      danger
      loading={mut.loading}
      error={mut.error}
      onClose={onClose}
      onConfirm={(reason) =>
        void mut
          .mutate(reason)
          .then(() => onDone(`LOT ${receipt?.lot_code} 을(를) 격리했습니다`))
          .catch(() => undefined)
      }
    >
      <p>
        LOT <CodeText code={receipt?.lot_code} /> 를 QUARANTINE 상태로 바꿉니다.
      </p>
    </ReasonDialog>
  )
}

function ReleaseDialog({ receipt, onClose, onDone }: { receipt: Receipt | null; onClose: () => void; onDone: (msg: string) => void }) {
  const mut = useApiMutation(() => lotsApi.release(receipt!.lot_code))
  return (
    <ConfirmDialog
      open={receipt !== null}
      title={`LOT 격리 해제 — ${receipt?.lot_code ?? ''}`}
      confirmLabel="해제"
      loading={mut.loading}
      error={mut.error}
      onClose={onClose}
      onConfirm={() =>
        void mut
          .mutate(undefined)
          .then(() => onDone(`LOT ${receipt?.lot_code} 격리를 해제했습니다`))
          .catch(() => undefined)
      }
    >
      <p>
        LOT <CodeText code={receipt?.lot_code} /> 를 OK 상태로 되돌립니다.
      </p>
    </ConfirmDialog>
  )
}

export function ReceiptsPage() {
  const { role } = useAuth()
  const toast = useToast()
  const manage = canWrite(role, 'material.adjust')
  const params = useListParams({ extraKeys: ['from', 'to', 'item_id', 'wo_code', 'inspection'], withActive: false })
  const list = useList<Receipt>('receipts', params.query)
  const itemId = params.extra.item_id ? Number(params.extra.item_id) : null
  const itemQ = useOne<Item>('items', itemId)
  const [quarantining, setQuarantining] = useState<Receipt | null>(null)
  const [releasing, setReleasing] = useState<Receipt | null>(null)

  const columns: Column<Receipt>[] = [
    { key: 'received_at', header: '입고 시각', render: (r) => <span className="tabular-nums">{formatDateTime(r.received_at, true)}</span> },
    {
      key: 'wo_code',
      header: 'WO',
      render: (r) =>
        r.wo_code ? (
          <span className="flex flex-col gap-0.5">
            <Link to={`/admin/wo/${encodeURIComponent(r.wo_code)}`} className="text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
              <CodeText code={r.wo_code} />
            </Link>
            <span className="flex items-center gap-1 text-ad-xs text-ink-muted">
              {r.wo_receipt_status ? <StatusBadge kind="receipt" status={r.wo_receipt_status} /> : null}
              {r.remaining_qty !== null ? <span>잔량 {formatQty(r.remaining_qty)}</span> : null}
            </span>
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'item',
      header: '품목',
      render: (r) => (
        <span>
          <CodeText code={r.item.code} /> {r.item.name}
        </span>
      ),
    },
    {
      key: 'lot_code',
      header: 'LOT',
      render: (r) => (
        <span className="flex flex-col gap-0.5">
          <CodeText code={r.lot_code} />
          <span className="flex items-center gap-1 text-ad-xs text-ink-muted">
            <StatusBadge kind="lot" status={r.lot.status} />
            {r.lot.vendor ? <span>{r.lot.vendor}</span> : null}
          </span>
        </span>
      ),
    },
    {
      key: 'qty',
      header: '수량 · 박스',
      align: 'right',
      render: (r) => (
        <span className="tabular-nums">
          {formatQty(r.qty)} / {formatQty(r.box_count)}
        </span>
      ),
    },
    { key: 'inspection', header: '검수', render: (r) => <StatusBadge kind="inspection" status={r.inspection} /> },
    { key: 'worker', header: '작업자', render: (r) => r.worker?.name ?? '—' },
    { key: 'vendor_barcode', header: '업체 바코드', render: (r) => (r.vendor_barcode ? <CodeText code={r.vendor_barcode} /> : '—') },
    {
      key: '_actions',
      header: '',
      render: (r) =>
        manage ? (
          <RowActions>
            {r.lot.status === 'OK' ? (
              <Button size="sm" variant="danger" onClick={() => setQuarantining(r)}>
                격리
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setReleasing(r)}>
                격리 해제
              </Button>
            )}
          </RowActions>
        ) : null,
    },
  ]

  return (
    <>
      <PageHeader title="입고 목록" breadcrumb="입고·재고 › 입고 목록 (ADM-18)" description="입고 건·LOT 조회, 지시수량 대사 상태. 입고 등록은 PDA 전용 (웹 화면 없음)" />
      <ListToolbar params={params} withQ={false} withActive={false}>
        <DateInput label="부터" value={params.extra.from ?? ''} onChange={(e) => params.setExtra('from', e.target.value)} wrapperClassName="w-40" />
        <DateInput label="까지" value={params.extra.to ?? ''} onChange={(e) => params.setExtra('to', e.target.value)} wrapperClassName="w-40" />
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
        <Input label="WO" placeholder="WO-…" value={params.extra.wo_code ?? ''} onChange={(e) => params.setExtra('wo_code', e.target.value.trim().toUpperCase())} wrapperClassName="w-44" className="font-mono uppercase" />
        <Select label="검수" value={params.extra.inspection ?? ''} onChange={(e) => params.setExtra('inspection', e.target.value)} options={INSPECTION_OPTIONS} placeholder="전체" wrapperClassName="w-32" />
      </ListToolbar>
      <DataTable<Receipt>
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
        {...serverTable(params, list.data)}
      />
      <QuarantineDialog
        receipt={quarantining}
        onClose={() => setQuarantining(null)}
        onDone={(msg) => {
          toast.success(msg)
          setQuarantining(null)
          void list.refetch()
        }}
      />
      <ReleaseDialog
        receipt={releasing}
        onClose={() => setReleasing(null)}
        onDone={(msg) => {
          toast.success(msg)
          setReleasing(null)
          void list.refetch()
        }}
      />
    </>
  )
}

/**
 * S3-2b 업체 바코드 매핑 조회·해제 — api-contract §13.1 admin #32 [S3]:
 * `GET /vendor-barcodes?wo_code&item_id&active` → Page<VendorBarcodeMap> (문서에는 「화면 없음, 데이터 정합 확인용」으로
 * 적혀 있으나, 이번 스프린트 지시로 조회·해제 화면을 둔다. 권한은 입고·재고(material) 매트릭스에 준한다.
 * 해제는 `POST /vendor-barcodes/{id}/deactivate` — 계약에 없는 엔드포인트를 다른 리소스의 activate/deactivate
 * 공통형과 같은 모양으로 추정 구현했다 (`shared/api/material.ts` 참고). 백엔드에 아직 없으면 404 로 드러난다.
 */
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { Button, DataTable, Input, PageHeader, SearchSelect, StatusBadge, useToast, type Column } from '@/shared/ui/admin'
import { useApiMutation, useAuth, useList, useOne } from '@/shared/hooks'
import { vendorBarcodesApi } from '@/shared/api'
import type { Item, VendorBarcodeMap } from '@/shared/types'
import { formatDateTime } from '../../format'
import { canWrite } from '../../permissions'
import { ApiErrorAlert, CodeText, ConfirmDialog, ListToolbar, RowActions, serverTable, useListParams } from '../../components'
import { apiErrorText, itemLabel, searchItems } from './itemSearch'

export function VendorBarcodesPage() {
  const { role } = useAuth()
  const toast = useToast()
  const manage = canWrite(role, 'material')
  const params = useListParams({ extraKeys: ['wo_code', 'item_id'], withActive: true })
  const list = useList<VendorBarcodeMap>('vendor-barcodes', params.query)
  const itemId = params.extra.item_id ? Number(params.extra.item_id) : null
  const itemQ = useOne<Item>('items', itemId)
  const [target, setTarget] = useState<VendorBarcodeMap | null>(null)
  const deactivate = useApiMutation((id: number) => vendorBarcodesApi.deactivate(id))

  const columns: Column<VendorBarcodeMap>[] = [
    { key: 'vendor_barcode', header: '업체 바코드', render: (r) => <CodeText code={r.vendor_barcode} /> },
    {
      key: 'wo_code',
      header: 'WO',
      render: (r) => (
        <Link to={`/admin/wo/${encodeURIComponent(r.wo_code)}`} className="text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
          <CodeText code={r.wo_code} />
        </Link>
      ),
    },
    {
      key: 'item',
      header: '품목',
      render: (r) => (
        <span>
          <CodeText code={r.item.code} /> {r.item.name ?? ''}
        </span>
      ),
    },
    { key: 'mapped_at', header: '매핑 시각', render: (r) => <span className="tabular-nums">{formatDateTime(r.mapped_at)}</span> },
    { key: 'mapped_by', header: '등록자', render: (r) => r.mapped_by?.name ?? '—' },
    { key: 'active', header: '상태', render: (r) => <StatusBadge kind="active" status={r.active} /> },
    {
      key: '_actions',
      header: '',
      render: (r) =>
        manage && r.active ? (
          <RowActions>
            <Button size="sm" variant="danger" onClick={() => setTarget(r)}>
              해제
            </Button>
          </RowActions>
        ) : null,
    },
  ]

  return (
    <>
      <PageHeader
        title="업체 바코드 매핑"
        breadcrumb="입고·재고 › 업체 바코드 매핑 (S3-2b)"
        description="GET /vendor-barcodes — 매핑 정합 확인용 (api-contract admin #32). 해제(deactivate)는 계약에 없는 엔드포인트를 추정 구현했다"
      />
      <ListToolbar params={params} withQ={false}>
        <Input label="WO" placeholder="WO-…" value={params.extra.wo_code ?? ''} onChange={(e) => params.setExtra('wo_code', e.target.value.trim().toUpperCase())} wrapperClassName="w-44" className="font-mono uppercase" />
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
      </ListToolbar>
      <DataTable<VendorBarcodeMap>
        columns={columns}
        rows={list.data?.items ?? []}
        rowKey={(r) => r.id}
        loading={list.loading}
        error={list.error ? <ApiErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : undefined}
        emptyText="조회 조건에 해당하는 매핑이 없습니다"
        {...serverTable(params, list.data)}
      />
      <ConfirmDialog
        open={target !== null}
        title={`매핑 해제 — ${target?.vendor_barcode ?? ''}`}
        danger
        confirmLabel="해제"
        loading={deactivate.loading}
        error={deactivate.error}
        onClose={() => setTarget(null)}
        onConfirm={() =>
          void deactivate
            .mutate(target!.id)
            .then(() => {
              toast.success('매핑을 해제했습니다')
              setTarget(null)
              void list.refetch()
            })
            .catch(() => undefined)
        }
      >
        <p>
          업체 바코드 <CodeText code={target?.vendor_barcode} /> ({target?.wo_code}) 매핑을 비활성 처리합니다.
        </p>
      </ConfirmDialog>
    </>
  )
}

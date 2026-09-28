/**
 * ADM-22 포장·출하 목록 (A4-03·A4-05) — [S3-9]
 * 탭 출하(`GET /shipments`, 행→상세 모달 `GET /shipments/{id}`) · 박스(`GET /boxes`, 행→상세 모달 `GET /boxes/{code}`).
 * §13.7: 박스는 항상 커밋되고 라벨 출력만 실패할 수 있다 — label_job.zpl_sent=false 면 「라벨 미출력 ✕」 + [재출력]
 * (`POST /labels/print {target: box.code, label_type:'BOX_LABEL'}`).
 */
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Button, DataTable, DateInput, DescriptionList, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Tabs, useToast, type Column } from '@/shared/ui/admin'
import { useApiMutation, useApiQuery, useArray, useAuth, useList } from '@/shared/hooks'
import { boxesApi, labelsApi, shipmentsApi } from '@/shared/api'
import type { PackBox, PackBoxDetail, Printer, Shipment, ShipmentStatus, ShipmentSummary } from '@/shared/types'
import { formatDateTime, formatQty, todayIso } from '../../format'
import { canWrite } from '../../permissions'
import { ApiErrorAlert, Checkbox, CodeText, ListToolbar, serverTable, useListParams } from '../../components'
import { shipmentDateParams } from './shipmentFilters'

type Tab = 'shipments' | 'boxes'
const SHIPMENT_STATUSES: ShipmentStatus[] = ['READY', 'SHIPPED', 'DELIVERED']

/* ───────── 출하 상세 모달 ───────── */
function ShipmentDetailModal({ id, onClose }: { id: number | null; onClose: () => void }) {
  const q = useApiQuery<Shipment>(['res', 'shipments', 'one', id ?? 0], () => shipmentsApi.get(id!), id !== null)
  return (
    <Modal open={id !== null} title={q.data ? `출하 상세 — ${q.data.so_code}` : '출하 상세'} onClose={onClose} size="lg">
      {q.loading ? (
        <Spinner label="불러오는 중…" />
      ) : q.error ? (
        <ApiErrorAlert error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data ? (
        <div className="space-y-4">
          <DescriptionList
            cols={3}
            items={[
              {
                label: '수주',
                value: (
                  <Link to={`/admin/so/${encodeURIComponent(q.data.so_code)}`} className="text-brand-700 hover:underline">
                    <CodeText code={q.data.so_code} />
                  </Link>
                ),
              },
              { label: '거래처', value: q.data.customer_name },
              { label: '상태', value: <StatusBadge kind="shipment" status={q.data.status} /> },
              { label: '택배사 · 송장', value: `${q.data.carrier ?? '—'} · ${q.data.tracking_no ?? '—'}` },
              { label: '발송 시각', value: formatDateTime(q.data.shipped_at) },
              { label: '수량 · 박스', value: `${formatQty(q.data.qty_total)} / ${formatQty(q.data.box_count)}` },
              { label: '작업자', value: q.data.worker?.name ?? '—' },
              { label: 'SO 잔량 (분할발송)', value: <span className="font-semibold">{formatQty(q.data.so_remaining_qty)}</span> },
            ]}
          />
          <div>
            <h3 className="mb-2 font-semibold">박스 ({q.data.boxes.length})</h3>
            <table className="w-full border-collapse text-ad-body">
              <thead className="bg-surface-2 text-ad-xs text-ink-muted">
                <tr>
                  <th className="px-2 py-1 text-left">코드</th>
                  <th className="px-2 py-1 text-left">WO</th>
                  <th className="px-2 py-1 text-right">박스#</th>
                  <th className="px-2 py-1 text-right">수량</th>
                  <th className="px-2 py-1 text-left">포장 시각</th>
                </tr>
              </thead>
              <tbody>
                {q.data.boxes.map((b) => (
                  <tr key={b.id} className="border-t border-line">
                    <td className="px-2 py-1">
                      <CodeText code={b.code} />
                    </td>
                    <td className="px-2 py-1">
                      <CodeText code={b.wo_code} />
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{b.box_no}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{formatQty(b.qty)}</td>
                    <td className="px-2 py-1 tabular-nums">{formatDateTime(b.packed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}

/* ───────── 출하 탭 ───────── */
function ShipmentsTab() {
  const params = useListParams({ withActive: false, extraKeys: ['date', 'from', 'to', 'customer_id', 'so_code', 'tracking_no', 'status', 'unmapped'] })
  const dateValue = params.extra.date || todayIso()
  const query = {
    ...params.query,
    date: undefined,
    from: undefined,
    to: undefined,
    ...shipmentDateParams(dateValue, params.extra.from ?? '', params.extra.to ?? ''),
  }
  const list = useList<ShipmentSummary>('shipments', query)
  const [openId, setOpenId] = useState<number | null>(null)

  const columns: Column<ShipmentSummary>[] = [
    {
      key: 'so_code',
      header: '수주',
      render: (r) => (
        <Link to={`/admin/so/${encodeURIComponent(r.so_code)}`} className="text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
          <CodeText code={r.so_code} />
        </Link>
      ),
    },
    { key: 'customer_name', header: '거래처' },
    { key: 'carrier', header: '택배사 · 송장', render: (r) => `${r.carrier ?? '—'} · ${r.tracking_no ?? '—'}` },
    { key: 'status', header: '상태', render: (r) => <StatusBadge kind="shipment" status={r.status} /> },
    { key: 'shipped_at', header: '발송 시각', render: (r) => <span className="tabular-nums">{formatDateTime(r.shipped_at)}</span> },
    {
      key: 'qty_total',
      header: '수량 · 박스',
      align: 'right',
      render: (r) => (
        <span className="tabular-nums">
          {formatQty(r.qty_total)} / {formatQty(r.box_count)}
        </span>
      ),
    },
  ]

  return (
    <div>
      <ListToolbar params={params} withQ={false} withActive={false}>
        <DateInput label="발송일" value={dateValue} onChange={(e) => params.setExtra('date', e.target.value)} wrapperClassName="w-40" hint="from/to 를 채우면 기간 필터로 전환" />
        <DateInput label="부터" value={params.extra.from ?? ''} onChange={(e) => params.setExtra('from', e.target.value)} wrapperClassName="w-40" />
        <DateInput label="까지" value={params.extra.to ?? ''} onChange={(e) => params.setExtra('to', e.target.value)} wrapperClassName="w-40" />
        <Input label="수주번호" value={params.extra.so_code ?? ''} onChange={(e) => params.setExtra('so_code', e.target.value.trim().toUpperCase())} wrapperClassName="w-40" className="font-mono uppercase" />
        <Input label="송장번호" value={params.extra.tracking_no ?? ''} onChange={(e) => params.setExtra('tracking_no', e.target.value.trim())} wrapperClassName="w-40" />
        <Select label="상태" value={params.extra.status ?? ''} onChange={(e) => params.setExtra('status', e.target.value)} options={SHIPMENT_STATUSES.map((s) => ({ value: s, label: s }))} placeholder="전체" wrapperClassName="w-32" />
        <Checkbox label="송장 매핑 누락 박스만" checked={params.extra.unmapped === 'true'} onChange={(e) => params.setExtra('unmapped', e.target.checked ? 'true' : '')} />
      </ListToolbar>
      <DataTable<ShipmentSummary>
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
        onRowClick={(r) => setOpenId(r.id)}
        {...serverTable(params, list.data)}
      />
      <ShipmentDetailModal id={openId} onClose={() => setOpenId(null)} />
    </div>
  )
}

/* ───────── 박스 라벨 재출력 ───────── */
function BoxReprintModal({ box, onClose, onDone }: { box: PackBox | null; onClose: () => void; onDone: (msg: string) => void }) {
  const printers = useArray<Printer>('printers', { active: true }, box !== null)
  const [printer, setPrinter] = useState('')
  const print = useApiMutation(() => labelsApi.print({ target: box!.code, label_type: 'BOX_LABEL', printer, copies: 1 }))
  return (
    <Modal
      open={box !== null}
      title={`박스 라벨 재출력 — ${box?.code ?? ''}`}
      onClose={onClose}
      size="sm"
      dismissible={!print.loading}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={print.loading}>
            닫기
          </Button>
          <Button
            variant="primary"
            loading={print.loading}
            disabled={!printer}
            onClick={() =>
              void print
                .mutate(undefined)
                .then((job) => onDone(job.zpl_sent && !job.error ? '라벨 출력을 전송했습니다' : `전송 실패 — ${job.error ?? 'ZPL 미전송'}`))
                .catch(() => undefined)
            }
          >
            출력 전송
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {print.error ? <ApiErrorAlert error={print.error} /> : null}
        {printers.error ? (
          <ApiErrorAlert error={printers.error} onRetry={() => void printers.refetch()} />
        ) : (
          <Select
            label="프린터"
            required
            value={printer}
            onChange={(e) => setPrinter(e.target.value)}
            options={(printers.data ?? []).map((p) => ({ value: p.id, label: `${p.id} ${p.name} (${p.purpose})` }))}
            placeholder={printers.loading ? '불러오는 중…' : (printers.data ?? []).length ? '선택' : '활성 프린터 없음 — ADM-09'}
          />
        )}
      </div>
    </Modal>
  )
}

/* ───────── 박스 상세 모달 ───────── */
function BoxDetailModal({ code, onClose }: { code: string | null; onClose: () => void }) {
  const q = useApiQuery<PackBoxDetail>(['res', 'boxes', 'one', code ?? ''], () => boxesApi.get(code!), code !== null)
  return (
    <Modal open={code !== null} title={`박스 상세 — ${code ?? ''}`} onClose={onClose}>
      {q.loading ? (
        <Spinner label="불러오는 중…" />
      ) : q.error ? (
        <ApiErrorAlert error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data ? (
        <DescriptionList
          cols={2}
          items={[
            {
              label: 'WO',
              value: (
                <Link to={`/admin/wo/${encodeURIComponent(q.data.wo_code)}`} className="text-brand-700 hover:underline">
                  <CodeText code={q.data.wo_code} />
                </Link>
              ),
            },
            { label: '박스 #', value: q.data.box_no },
            { label: '수량', value: formatQty(q.data.qty) },
            { label: '포장 시각', value: formatDateTime(q.data.packed_at) },
            { label: '작업자', value: q.data.worker.name },
            { label: '발송', value: q.data.shipment ? <StatusBadge kind="shipment" status={q.data.shipment.status} /> : <span className="font-semibold text-status-warn-fg">미발송</span> },
          ]}
        />
      ) : null}
    </Modal>
  )
}

/* ───────── 박스 탭 ───────── */
function BoxesTab() {
  const { role } = useAuth()
  const toast = useToast()
  const canPrint = canWrite(role, 'so') // 라벨 출력 W (ADMIN/MANAGER/SALES, ADM-16 과 동일 기준)
  const params = useListParams({ withActive: false, extraKeys: ['wo_code', 'so_code', 'unshipped'] })
  const list = useList<PackBox>('boxes', params.query)
  const [openCode, setOpenCode] = useState<string | null>(null)
  const [reprintBox, setReprintBox] = useState<PackBox | null>(null)

  const columns: Column<PackBox>[] = [
    { key: 'code', header: '코드', render: (r) => <CodeText code={r.code} /> },
    {
      key: 'wo_code',
      header: 'WO',
      render: (r) => (
        <Link to={`/admin/wo/${encodeURIComponent(r.wo_code)}`} className="text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
          <CodeText code={r.wo_code} />
        </Link>
      ),
    },
    { key: 'box_no', header: '박스 #', align: 'right' },
    { key: 'qty', header: '수량', align: 'right', render: (r) => <span className="tabular-nums">{formatQty(r.qty)}</span> },
    { key: 'packed_at', header: '포장 시각', render: (r) => <span className="tabular-nums">{formatDateTime(r.packed_at)}</span> },
    { key: 'shipment_id', header: '발송', render: (r) => (r.shipment_id ? <span className="text-status-done-fg">발송됨</span> : <span className="font-semibold text-status-warn-fg">미발송</span>) },
    {
      key: 'label_job',
      header: '라벨',
      render: (r) => {
        const lj = r.label_job
        if (!lj) return <span className="text-ink-faint">—</span>
        if (lj.zpl_sent && !lj.error) return <StatusBadge kind="scanResult" status="OK" labelOverride="출력됨" />
        return (
          <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <StatusBadge kind="scanResult" status="REJECT" labelOverride="라벨 미출력 ✕" />
            {canPrint ? (
              <Button size="sm" variant="secondary" onClick={() => setReprintBox(r)}>
                재출력
              </Button>
            ) : null}
          </span>
        )
      },
    },
  ]

  return (
    <div>
      <ListToolbar params={params} withQ={false} withActive={false}>
        <Input label="WO" value={params.extra.wo_code ?? ''} onChange={(e) => params.setExtra('wo_code', e.target.value.trim().toUpperCase())} wrapperClassName="w-40" className="font-mono uppercase" />
        <Input label="수주번호" value={params.extra.so_code ?? ''} onChange={(e) => params.setExtra('so_code', e.target.value.trim().toUpperCase())} wrapperClassName="w-40" className="font-mono uppercase" />
        <Checkbox label="미발송만" checked={params.extra.unshipped === 'true'} onChange={(e) => params.setExtra('unshipped', e.target.checked ? 'true' : '')} />
      </ListToolbar>
      <DataTable<PackBox>
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
        onRowClick={(r) => setOpenCode(r.code)}
        {...serverTable(params, list.data)}
      />
      <BoxDetailModal code={openCode} onClose={() => setOpenCode(null)} />
      <BoxReprintModal
        box={reprintBox}
        onClose={() => setReprintBox(null)}
        onDone={(msg) => {
          toast.success(msg)
          setReprintBox(null)
          void list.refetch()
        }}
      />
    </div>
  )
}

/* ───────── 페이지 ───────── */
export function ShippingPage() {
  const { role } = useAuth()
  const navigate = useNavigate()
  const [sp, setSp] = useSearchParams()
  const tab: Tab = sp.get('tab') === 'boxes' ? 'boxes' : 'shipments'
  const setTab = (t: Tab) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev)
        n.set('tab', t)
        return n
      },
      { replace: true },
    )
  return (
    <>
      <PageHeader
        title="포장·출하 목록"
        breadcrumb="포장·출하 › 목록 (ADM-22)"
        description="일자·거래처·송장·SO 별 출하, 오늘 발송 예정/완료/지연, 송장 매핑 누락 박스, 잔량"
        actions={
          <Button variant="primary" disabled={!canWrite(role, 'shipping.new')} onClick={() => navigate('/admin/shipping/new')}>
            발송 등록
          </Button>
        }
      />
      <Tabs<Tab>
        tabs={[
          { key: 'shipments', label: '출하' },
          { key: 'boxes', label: '박스' },
        ]}
        value={tab}
        onChange={setTab}
      >
        {tab === 'shipments' ? <ShipmentsTab /> : <BoxesTab />}
      </Tabs>
    </>
  )
}

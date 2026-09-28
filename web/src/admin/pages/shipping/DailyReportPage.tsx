/**
 * ADM-24 출하 일보 (A4-06) — [S3-9]
 * `GET /shipments/daily-report?date=&format=json` → DailyShipmentReport · [Excel] `?date=` (xlsx blob, downloadBlob).
 * 전 역할 R.
 */
import { useSearchParams } from 'react-router-dom'
import { Button, DataTable, DateInput, PageHeader, Spinner, StatCard, type Column } from '@/shared/ui/admin'
import { useApiMutation, useApiQuery } from '@/shared/hooks'
import { shipmentsApi } from '@/shared/api'
import type { DailyShipmentReport } from '@/shared/types'
import { formatDateTime, formatQty, todayIso } from '../../format'
import { ApiErrorAlert } from '../../components'

type Row = DailyShipmentReport['rows'][number] & { _i: number }

export function DailyReportPage() {
  const [sp, setSp] = useSearchParams()
  const date = sp.get('date') || todayIso()
  const setDate = (d: string) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev)
        if (d) n.set('date', d)
        else n.delete('date')
        return n
      },
      { replace: true },
    )
  const report = useApiQuery<DailyShipmentReport>(['shipments', 'daily-report', date], () => shipmentsApi.dailyReport(date))
  const excel = useApiMutation(() => shipmentsApi.dailyReportExcel(date))

  const columns: Column<Row>[] = [
    { key: 'so_code', header: '수주', render: (r) => <span className="font-mono">{r.so_code}</span> },
    { key: 'customer_name', header: '거래처' },
    { key: 'item_name', header: '품목' },
    { key: 'qty', header: '수량', align: 'right', render: (r) => <span className="tabular-nums">{formatQty(r.qty)}</span> },
    { key: 'tracking_no', header: '송장', render: (r) => r.tracking_no ?? '—' },
    { key: 'shipped_at', header: '발송 시각', render: (r) => <span className="tabular-nums">{formatDateTime(r.shipped_at)}</span> },
    { key: 'overdue', header: '지연', render: (r) => (r.overdue ? <span className="font-semibold text-status-error-fg">지연</span> : '—') },
  ]

  return (
    <>
      <PageHeader
        title="출하 일보"
        breadcrumb="포장·출하 › 출하 일보 (ADM-24)"
        actions={
          <>
            <Button variant="secondary" className="print:hidden" onClick={() => window.print()}>
              인쇄
            </Button>
            <Button variant="primary" className="print:hidden" loading={excel.loading} onClick={() => void excel.mutate(undefined).catch(() => undefined)}>
              Excel 다운로드
            </Button>
          </>
        }
      />
      {excel.error ? <ApiErrorAlert error={excel.error} onRetry={() => void excel.mutate(undefined).catch(() => undefined)} className="mb-3 print:hidden" /> : null}
      <div className="mb-3 flex flex-wrap items-end gap-3 print:hidden">
        <DateInput label="일자" value={date} onChange={(e) => setDate(e.target.value)} wrapperClassName="w-40" />
      </div>
      {report.error ? (
        <ApiErrorAlert error={report.error} onRetry={() => void report.refetch()} />
      ) : report.data ? (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <StatCard label="출하 건수" value={formatQty(report.data.totals.shipments)} />
            <StatCard label="박스" value={formatQty(report.data.totals.boxes)} />
            <StatCard label="수량" value={formatQty(report.data.totals.qty)} />
          </div>
          <DataTable<Row> columns={columns} rows={report.data.rows.map((r, i) => ({ ...r, _i: i }))} rowKey={(r) => r._i} emptyText="발송 내역이 없습니다" pageSize={0} />
        </>
      ) : (
        <div className="flex justify-center py-12">
          <Spinner label="불러오는 중…" />
        </div>
      )}
    </>
  )
}

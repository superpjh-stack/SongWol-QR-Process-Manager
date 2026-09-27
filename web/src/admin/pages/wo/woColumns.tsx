/** ADM-15 WO 목록 컬럼 — ADM-14 탭 2 「작업지시」 와 공용 (screens-admin ADM-14 「ADM-15 와 같은 컬럼」) */
import { Link } from 'react-router-dom'
import { StatusBadge } from '@/shared/ui'
import type { Column } from '@/shared/ui/admin'
import type { Process, WorkOrderSummary } from '@/shared/types'
import { PrintMethodCodeLabel } from '@/shared/labels'
import { formatDate, formatDateTime, formatQty, isOverdue } from '../../format'
import { AuthImage, CodeText } from '../../components'

export function woColumns(processName: (code: string | null) => string, opts: { withSo?: boolean } = {}): Column<WorkOrderSummary>[] {
  const { withSo = true } = opts
  const cols: Column<WorkOrderSummary>[] = [
    {
      key: 'code',
      header: 'WO',
      sortable: true,
      render: (r) => (
        <span className="inline-flex items-center gap-1">
          <Link to={`/admin/wo/${encodeURIComponent(r.code)}`} className="text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
            <CodeText code={r.code} />
          </Link>
          {r.parent_wo_code ? <span className="rounded-full bg-surface-3 px-1.5 text-ad-xs text-ink-muted">하위</span> : null}
        </span>
      ),
    },
  ]
  if (withSo) {
    cols.push({
      key: 'so_code',
      header: '수주',
      render: (r) => (
        <Link to={`/admin/so/${encodeURIComponent(r.so_code)}`} className="text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
          <CodeText code={r.so_code} />
        </Link>
      ),
    })
    cols.push({ key: 'customer_name', header: '거래처' })
  }
  cols.push(
    {
      key: 'item',
      header: '품목',
      render: (r) => (
        <span>
          {r.item.name ?? r.item.code}
          <span className="ml-1 text-ad-xs text-ink-muted">{[r.item.spec, r.item.color].filter(Boolean).join(' · ')}</span>
        </span>
      ),
    },
    { key: 'print_method', header: '가공방식', render: (r) => PrintMethodCodeLabel[r.print_method] ?? r.print_method },
    { key: 'qty_ordered', header: '지시', align: 'right', render: (r) => <span className="tabular-nums">{formatQty(r.qty_ordered)}</span> },
    {
      key: 'qty_received',
      header: '입고',
      align: 'right',
      render: (r) => (
        <span className="inline-flex items-center gap-1 tabular-nums">
          {formatQty(r.qty_received)} <StatusBadge kind="receipt" status={r.receipt_status} />
        </span>
      ),
    },
    {
      key: 'qty_good',
      header: '양품/불량',
      align: 'right',
      render: (r) => (
        <span className="tabular-nums">
          {formatQty(r.qty_good)} / <span className={r.qty_bad > 0 ? 'text-status-error-fg' : ''}>{formatQty(r.qty_bad)}</span>
        </span>
      ),
    },
    {
      key: 'qty_packed',
      header: '포장/발송',
      align: 'right',
      render: (r) => (
        <span className="tabular-nums">
          {formatQty(r.qty_packed)} / {formatQty(r.qty_shipped)}
        </span>
      ),
    },
    { key: 'status', header: '상태', sortable: true, render: (r) => <StatusBadge kind="wo" status={r.status} /> },
    {
      key: 'current_step_seq',
      header: '현재 공정',
      sortable: true,
      render: (r) =>
        r.current_process_code ? (
          <span>
            <span className="font-mono">{r.current_process_code}</span> {processName(r.current_process_code)}
            {r.current_step_seq !== null ? <span className="ml-1 text-ad-xs text-ink-muted">#{r.current_step_seq}</span> : null}
          </span>
        ) : (
          <span className="text-ink-faint">—</span>
        ),
    },
    {
      key: 'due_date',
      header: '납기',
      sortable: true,
      render: (r) => (
        <span className="inline-flex items-center gap-1 tabular-nums">
          <span className={isOverdue(r.due_date, r.status) ? 'font-semibold text-status-error-fg' : ''}>{formatDate(r.due_date)}</span>
          {r.delay_risk ? <StatusBadge kind="delay" status={true} /> : null}
        </span>
      ),
    },
    {
      key: 'design_version',
      header: '도안',
      render: (r) =>
        r.design_version !== null ? (
          <span className="inline-flex items-center gap-1">
            <AuthImage src={r.design_thumbnail_url} alt="" width={28} height={28} className="rounded-ad border border-line object-cover" />
            <span className="text-ad-xs">v{r.design_version}</span>
          </span>
        ) : (
          <span className="text-ink-faint">—</span>
        ),
    },
    { key: 'issued_at', header: '발행', sortable: true, render: (r) => <span className="tabular-nums">{formatDateTime(r.issued_at)}</span> },
  )
  return cols
}

export function processNameFn(processes: Process[] | undefined) {
  const m = new Map((processes ?? []).map((p) => [p.code, p.name]))
  return (code: string | null) => (code ? (m.get(code) ?? '') : '')
}

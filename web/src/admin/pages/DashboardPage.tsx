/**
 * ADM-28 대시보드 (B5-01 관리자용) — [S4-2]
 * `GET /dashboard/summary` → DashboardSummary. 전 역할 R. 실시간 WS(`/ws/board`)는 현황판(TV, BRD-01) 전용 —
 * 관리자 웹은 화면이 조밀한 표 중심이라 단순화해 30초 polling 만 쓴다(screens-admin §0.5 "WS 미연결 시 REST
 * 값만 표시하고 30초 polling"과 같은 효과, 계약상 `/ws/board` 는 관리자 화면에도 열 수 있지만 필수는 아니다).
 */
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Button, DataTable, PageHeader, ProgressBar, Spinner, StatCard, StatusBadge, type Column } from '@/shared/ui/admin'
import { useApiQuery, useAuth } from '@/shared/hooks'
import { boardApi } from '@/shared/api'
import type { ProcessQueueRow, SoProgress } from '@/shared/types'
import { formatDateTime, formatQty } from '../format'
import { canRead } from '../permissions'
import { ApiErrorAlert } from '../components'

const POLL_MS = 30_000

function soColumns(): Column<SoProgress>[] {
  return [
    { key: 'so_code', header: '수주', render: (r) => <Link to={`/admin/so/${encodeURIComponent(r.so_code)}`} className="font-mono text-brand-700 hover:underline">{r.so_code}</Link> },
    { key: 'customer_name', header: '거래처' },
    { key: 'due_date', header: '납기', render: (r) => <span className={r.delay_risk ? 'font-semibold text-status-error-fg' : ''}>{r.due_date}</span> },
    { key: 'status', header: '상태', render: (r) => <StatusBadge kind="so" status={r.status} /> },
    { key: 'progress_pct', header: '진행률', render: (r) => <ProgressBar value={r.progress_pct} /> },
    { key: 'current_processes', header: '현재 공정', render: (r) => (r.current_processes.length ? r.current_processes.join(', ') : '—') },
    { key: 'est_complete_at', header: '완료 예상', render: (r) => <span className="tabular-nums">{formatDateTime(r.est_complete_at)}</span> },
  ]
}

function processQueueColumns(): Column<ProcessQueueRow>[] {
  return [
    { key: 'process_name', header: '공정', render: (r) => `${r.process_code} ${r.process_name}` },
    { key: 'wo_count', header: 'WO 수', align: 'right', render: (r) => <span className="tabular-nums">{formatQty(r.wo_count)}</span> },
    { key: 'qty_total', header: '수량', align: 'right', render: (r) => <span className="tabular-nums">{formatQty(r.qty_total)}</span> },
    {
      key: 'max_wait_hours',
      header: '최대 대기(시간)',
      align: 'right',
      render: (r) => <span className={r.max_wait_hours > 24 ? 'font-semibold text-status-warn-fg tabular-nums' : 'tabular-nums'}>{r.max_wait_hours.toFixed(1)}</span>,
    },
  ]
}

export function DashboardPage() {
  const { role } = useAuth()
  const dash = useApiQuery(['board', 'summary'], () => boardApi.summary())

  useEffect(() => {
    const t = window.setInterval(() => void dash.refetch(), POLL_MS)
    return () => window.clearInterval(t)
  }, [dash.refetch])

  if (!dash.data && dash.loading) {
    return (
      <>
        <PageHeader title="대시보드" breadcrumb="대시보드 (ADM-28)" />
        <div className="flex justify-center py-12">
          <Spinner label="불러오는 중…" />
        </div>
      </>
    )
  }
  if (!dash.data) {
    return (
      <>
        <PageHeader title="대시보드" breadcrumb="대시보드 (ADM-28)" />
        <ApiErrorAlert error={dash.error} onRetry={() => void dash.refetch()} />
      </>
    )
  }

  const s = dash.data
  const soCols = soColumns()

  return (
    <>
      <PageHeader
        title="대시보드"
        breadcrumb="대시보드 (ADM-28)"
        description={`기준 시각 ${formatDateTime(s.generated_at, true)} · 30초 주기 갱신`}
        actions={
          <Button variant="ghost" loading={dash.loading} onClick={() => void dash.refetch()}>
            새로고침
          </Button>
        }
      />
      {dash.error ? <ApiErrorAlert error={dash.error} onRetry={() => void dash.refetch()} className="mb-3" /> : null}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <StatCard label="오늘 발송 예정" value={formatQty(s.today_shipments.planned)} to="/admin/shipping/daily" />
        <StatCard label="오늘 발송 완료" value={formatQty(s.today_shipments.done)} to="/admin/shipping/daily" />
        <StatCard label="오늘 발송 지연" value={formatQty(s.today_shipments.overdue)} tone={s.today_shipments.overdue > 0 ? 'error' : 'default'} to="/admin/shipping/daily" />
        <StatCard label="시간당 생산량" value={formatQty(s.output_per_hour_today, 1)} />
        <StatCard
          label="승인 대기"
          value={formatQty(s.pending_approvals)}
          tone={s.pending_approvals > 0 ? 'warn' : 'default'}
          {...(canRead(role, 'wo.pending') ? { to: '/admin/wo/pending' } : {})}
        />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section>
          <h2 className="mb-2 text-ad-lg font-semibold">오늘 납기</h2>
          <DataTable<SoProgress> columns={soCols} rows={s.today_due} rowKey={(r) => r.so_id} emptyText="오늘 납기 건이 없습니다" pageSize={0} dense />
        </section>
        <section>
          <h2 className="mb-2 text-ad-lg font-semibold">지연 위험</h2>
          <DataTable<SoProgress> columns={soCols} rows={s.delay_risk} rowKey={(r) => r.so_id} emptyText="지연 위험 건이 없습니다" pageSize={0} dense />
        </section>
      </div>

      <section className="mb-4">
        <h2 className="mb-2 text-ad-lg font-semibold">공정별 대기</h2>
        <DataTable<ProcessQueueRow> columns={processQueueColumns()} rows={s.process_queue} rowKey={(r) => r.process_code} emptyText="대기 중인 공정이 없습니다" pageSize={0} dense />
      </section>

      {s.offline_backlog.length > 0 ? (
        <section>
          <h2 className="mb-2 text-ad-lg font-semibold">오프라인 적체</h2>
          <div className="flex flex-wrap gap-3">
            {s.offline_backlog.map((row) => (
              <StatCard key={row.station_id} label={row.station_id} value={formatQty(row.count)} tone="warn" to="/admin/master/stations" className="min-w-40" />
            ))}
          </div>
        </section>
      ) : null}
    </>
  )
}

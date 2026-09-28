/**
 * ADM-29 알림 이력 (B5-03, A2-08) — [S4-8]
 * `GET /notifications?unacked=true&type&from&to&page&size` → Page<Notification>. [확인] → `POST /notifications/{id}/ack`.
 * 권한: ADMIN/MANAGER/SALES R/W(확인) · VIEWER R · WORKER 숨김 (permissions.ts 'system.notifications').
 */
import { Link } from 'react-router-dom'
import { Button, DataTable, DateInput, PageHeader, Select, useToast, type Column } from '@/shared/ui/admin'
import { useApiMutation, useApiQuery, useAuth } from '@/shared/hooks'
import { notificationsApi } from '@/shared/api'
import { NOTIFICATION_TYPES, type Notification } from '@/shared/types'
import { NotificationChannelLabel, NotificationTypeLabel } from '@/shared/labels'
import { formatDateTime } from '../../format'
import { canWrite } from '../../permissions'
import { ApiErrorAlert, Checkbox, useListParams } from '../../components'
import { targetLink } from './notificationLinks'

export function NotificationsPage() {
  const { role } = useAuth()
  const write = canWrite(role, 'system.notifications')
  const toast = useToast()
  const params = useListParams({ extraKeys: ['type', 'from', 'to', 'unacked'], withActive: false })
  const unackedRaw = params.extra.unacked
  const unackedOnly = unackedRaw !== 'false'
  const query = { ...params.query, unacked: unackedOnly }
  const list = useApiQuery(['notifications', query], () => notificationsApi.list(query))
  const ack = useApiMutation((id: number) => notificationsApi.ack(id), [['notifications']])

  const columns: Column<Notification>[] = [
    { key: 'created_at', header: '생성', render: (r) => <span className="tabular-nums">{formatDateTime(r.created_at, true)}</span> },
    { key: 'type', header: '유형', render: (r) => NotificationTypeLabel[r.type] },
    {
      key: 'target_code',
      header: '대상',
      render: (r) => {
        const to = targetLink(r.target_code)
        return to ? (
          <Link to={to} className="font-mono text-brand-700 hover:underline">
            {r.target_code}
          </Link>
        ) : (
          <span className="font-mono">{r.target_code || '—'}</span>
        )
      },
    },
    { key: 'message', header: '내용' },
    { key: 'channel', header: '채널', render: (r) => NotificationChannelLabel[r.channel] },
    { key: 'sent_at', header: '발송', render: (r) => (r.sent_at ? <span className="tabular-nums">{formatDateTime(r.sent_at, true)}</span> : <span className="text-status-warn-fg">미발송(재시도 대상)</span>) },
    {
      key: 'ack',
      header: '확인',
      render: (r) =>
        r.ack_at ? (
          <span className="text-ad-xs text-ink-muted">
            {r.ack_by?.name ?? '—'} · {formatDateTime(r.ack_at, true)}
          </span>
        ) : write ? (
          <Button size="sm" variant="primary" loading={ack.loading} onClick={() => void ack.mutate(r.id).then(() => toast.success('확인 처리되었습니다')).catch(() => undefined)}>
            확인
          </Button>
        ) : (
          '—'
        ),
    },
  ]

  return (
    <>
      <PageHeader title="알림 이력" breadcrumb="시스템 › 알림 이력 (ADM-29)" description="DELAY·DEFECT·RECEIPT_SHORT·QTY_VARIANCE·APPROVAL_REQUEST·OFFLINE_BACKLOG 알림 이력 및 확인 처리" />
      {ack.error ? <ApiErrorAlert error={ack.error} className="mb-3" /> : null}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Checkbox label="미확인만" checked={unackedOnly} onChange={(e) => params.setExtra('unacked', e.target.checked ? '' : 'false')} />
        <Select label="유형" value={params.extra.type ?? ''} onChange={(e) => params.setExtra('type', e.target.value)} placeholder="전체" wrapperClassName="w-40" options={NOTIFICATION_TYPES.map((t) => ({ value: t, label: NotificationTypeLabel[t] }))} />
        <DateInput label="부터" value={params.extra.from ?? ''} onChange={(e) => params.setExtra('from', e.target.value)} wrapperClassName="w-40" />
        <DateInput label="까지" value={params.extra.to ?? ''} onChange={(e) => params.setExtra('to', e.target.value)} wrapperClassName="w-40" />
        <Button variant="ghost" onClick={params.reset}>
          필터 초기화
        </Button>
      </div>
      <DataTable<Notification>
        columns={columns}
        rows={list.data?.items ?? []}
        rowKey={(r) => r.id}
        loading={list.loading}
        error={list.error ? <ApiErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : undefined}
        emptyText={unackedOnly ? '미확인 알림이 없습니다' : '조회 조건에 해당하는 알림이 없습니다'}
        pagination={{ page: params.page, pageSize: params.size, total: list.data?.total ?? 0, onPageChange: params.setPage }}
      />
    </>
  )
}

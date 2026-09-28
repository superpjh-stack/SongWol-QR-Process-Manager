/**
 * ADM-30 감사 로그 (spec §13) — [S4-8]
 * `GET /audit-logs?table_name&row_id&user_id&from&to&page&size` → Page<AuditLog>. ADMIN R/W · MANAGER R.
 * 기준정보·수주 상세의 「변경 이력」 링크가 `?table_name=&row_id=` 로 들어온다 (db-schema §7.2 훅 대상 테이블).
 */
import { DataTable, DateInput, Input, PageHeader, Select, type Column } from '@/shared/ui/admin'
import { useApiQuery } from '@/shared/hooks'
import { auditLogsApi } from '@/shared/api'
import { AUDIT_TABLES, type AuditLog } from '@/shared/types'
import { AuditActionLabel } from '@/shared/labels'
import { formatDateTime } from '../../format'
import { ApiErrorAlert, useListParams } from '../../components'

function JsonDiff({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  if (!before && !after) return <span className="text-ink-faint">—</span>
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])
  const changed = [...keys].filter((k) => JSON.stringify((before ?? {})[k]) !== JSON.stringify((after ?? {})[k]))
  return (
    <details>
      <summary className="cursor-pointer text-ad-xs text-brand-700">{changed.length > 0 ? `변경 ${changed.length}개 필드` : '펼침'}</summary>
      <div className="mt-1 flex max-w-md gap-2 overflow-auto">
        <div className="flex-1">
          <div className="text-ad-xs font-semibold text-ink-muted">이전</div>
          <pre className="whitespace-pre-wrap break-all font-mono text-ad-xs">{before ? JSON.stringify(before, null, 1) : '—'}</pre>
        </div>
        <div className="flex-1">
          <div className="text-ad-xs font-semibold text-ink-muted">이후</div>
          <pre className="whitespace-pre-wrap break-all font-mono text-ad-xs">{after ? JSON.stringify(after, null, 1) : '—'}</pre>
        </div>
      </div>
    </details>
  )
}

export function AuditLogPage() {
  // 기준정보·수주 상세의 「변경 이력」 링크(?table_name=&row_id=)는 useListParams 의 extraKeys 가 그대로 읽는다
  const params = useListParams({ extraKeys: ['table_name', 'row_id', 'user_id', 'from', 'to'], withActive: false })
  const list = useApiQuery(['audit-logs', params.query], () => auditLogsApi.list(params.query))

  const columns: Column<AuditLog>[] = [
    { key: 'at', header: '시각', render: (r) => <span className="tabular-nums">{formatDateTime(r.at, true)}</span> },
    { key: 'table_name', header: '테이블', render: (r) => <span className="font-mono text-ad-xs">{r.table_name}</span> },
    { key: 'row', header: '행', render: (r) => <span className="font-mono text-ad-xs">{r.row_id ?? r.row_key ?? '—'}</span> },
    { key: 'action', header: '동작', render: (r) => AuditActionLabel[r.action] },
    { key: 'user', header: '사용자', render: (r) => r.user?.name ?? '—' },
    { key: 'diff', header: '변경', render: (r) => <JsonDiff before={r.before} after={r.after} /> },
    { key: 'request_id', header: '요청', render: (r) => (r.request_id ? <span className="font-mono text-ad-xs">{r.request_id.slice(0, 8)}…</span> : '—') },
  ]

  return (
    <>
      <PageHeader title="감사 로그" breadcrumb="시스템 › 감사 로그 (ADM-30)" description="기준정보·수주 변경 이력 (before/after)" />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Select
          label="테이블"
          value={params.extra.table_name ?? ''}
          onChange={(e) => params.setExtra('table_name', e.target.value)}
          placeholder="전체"
          wrapperClassName="w-48"
          options={AUDIT_TABLES.map((t) => ({ value: t, label: t }))}
        />
        <Input label="행 ID" value={params.extra.row_id ?? ''} onChange={(e) => params.setExtra('row_id', e.target.value)} wrapperClassName="w-28" />
        <Input label="사용자 ID" value={params.extra.user_id ?? ''} onChange={(e) => params.setExtra('user_id', e.target.value)} wrapperClassName="w-28" />
        <DateInput label="부터" value={params.extra.from ?? ''} onChange={(e) => params.setExtra('from', e.target.value)} wrapperClassName="w-40" />
        <DateInput label="까지" value={params.extra.to ?? ''} onChange={(e) => params.setExtra('to', e.target.value)} wrapperClassName="w-40" />
      </div>
      <DataTable<AuditLog>
        columns={columns}
        rows={list.data?.items ?? []}
        rowKey={(r) => r.id}
        loading={list.loading}
        error={list.error ? <ApiErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : undefined}
        emptyText="조회 조건에 해당하는 감사 로그가 없습니다"
        pagination={{ page: params.page, pageSize: params.size, total: list.data?.total ?? 0, onPageChange: params.setPage }}
        dense
      />
    </>
  )
}

/** ADM-31 마이그레이션 현황 — GET /migration/batches?page&size&sort&entity&status&source (최소 목록) */
import { DataTable, PageHeader, Select, useToast, type Column } from '@/shared/ui/admin'
import { useList } from '@/shared/hooks'
import { IMPORT_ENTITIES, MIGRATION_SOURCES, MIGRATION_STATUSES, type MigrationBatch } from '@/shared/types'
import { ImportEntityLabel, MigrationSourceLabel, MigrationStatusLabel } from '@/shared/labels'
import { StatusBadge } from '@/shared/ui'
import { formatDateTime, formatQty } from '../../format'
import { ApiErrorAlert, ListToolbar, serverTable, useListParams } from '../../components'

export function MigrationBatchesPage() {
  const toast = useToast()
  const params = useListParams({ defaultSort: '-created_at', extraKeys: ['entity', 'status', 'source'], withActive: false })
  const list = useList<MigrationBatch>('migration/batches', params.query)

  const columns: Column<MigrationBatch>[] = [
    { key: 'id', header: 'ID', align: 'right', render: (r) => <span className="tabular-nums">{r.id}</span> },
    { key: 'source', header: '출처', render: (r) => <StatusBadge kind="source" status={r.source} /> },
    { key: 'entity', header: '대상', render: (r) => (r.entity in ImportEntityLabel ? `${ImportEntityLabel[r.entity as keyof typeof ImportEntityLabel]} (${r.entity})` : r.entity) },
    {
      key: 'source_file',
      header: '원본 파일',
      render: (r) => (
        <span className="flex flex-col">
          <span>{r.source_file}</span>
          <button
            type="button"
            className="self-start font-mono text-ad-xs text-ink-muted hover:underline"
            title={r.source_hash}
            onClick={async (e) => {
              e.stopPropagation()
              await navigator.clipboard.writeText(r.source_hash)
              toast.info('해시를 복사했습니다')
            }}
          >
            {r.source_hash.slice(0, 8)} 복사
          </button>
        </span>
      ),
    },
    { key: 'extracted_at', header: '추출 시각', render: (r) => formatDateTime(r.extracted_at) },
    {
      key: '_counts',
      header: '건수 (원본 / 적재 / 병합 / 건너뜀 / 실패 / 무시)',
      align: 'right',
      render: (r) => {
        // F30: src = loaded + merged + skipped + failed (+ ignored). 백엔드가 아직 안 주는 항은 0 으로 본다
        const sum = r.row_count_loaded + r.row_count_merged + (r.row_count_skipped ?? 0) + (r.row_count_failed ?? 0) + (r.row_count_ignored ?? 0)
        const ok = r.row_count_src === sum
        const opt = (v: number | undefined) => (v === undefined ? '·' : formatQty(v))
        return (
          <span className={`tabular-nums ${ok ? '' : 'font-semibold text-status-warn-fg'}`} title={ok ? '대사 일치 (F30)' : `차이 ${r.row_count_src - sum} — 건너뜀·실패·무시 항은 백엔드 S0 fix 후 표시`}>
            {formatQty(r.row_count_src)} / {formatQty(r.row_count_loaded)} / {formatQty(r.row_count_merged)} / {opt(r.row_count_skipped)} / {opt(r.row_count_failed)} / {opt(r.row_count_ignored)} {ok ? '✓' : '≠'}
          </span>
        )
      },
    },
    { key: 'status', header: '상태', render: (r) => <StatusBadge kind="migration" status={r.status} /> },
    { key: 'merge_policy', header: '병합 정책', render: (r) => r.merge_policy ?? '—' },
    { key: 'created_by', header: '등록자', render: (r) => r.created_by?.name ?? '—' },
    { key: 'created_at', header: '등록 시각', sortable: true, render: (r) => formatDateTime(r.created_at) },
  ]

  return (
    <>
      <PageHeader title="마이그레이션 현황" breadcrumb="시스템 › 마이그레이션 (ADM-31)" description="엑셀 일괄 등록·IMS 이관 배치. 대사: 원본 = 적재 + 병합 + 건너뜀 + 실패 (+ 무시) (spec §12.5 · F30). 배치 상세·롤백은 [S5]" />
      <ListToolbar params={params} withQ={false} withActive={false}>
        <Select label="대상" value={params.extra.entity ?? ''} onChange={(e) => params.setExtra('entity', e.target.value)} options={[...IMPORT_ENTITIES.map((e) => ({ value: e, label: ImportEntityLabel[e] })), { value: 'stock_txn', label: 'stock_txn' }]} placeholder="전체" wrapperClassName="w-36" />
        <Select label="상태" value={params.extra.status ?? ''} onChange={(e) => params.setExtra('status', e.target.value)} options={MIGRATION_STATUSES.map((s) => ({ value: s, label: MigrationStatusLabel[s] }))} placeholder="전체" wrapperClassName="w-36" />
        <Select label="출처" value={params.extra.source ?? ''} onChange={(e) => params.setExtra('source', e.target.value)} options={MIGRATION_SOURCES.map((s) => ({ value: s, label: MigrationSourceLabel[s] }))} placeholder="전체" wrapperClassName="w-36" />
      </ListToolbar>
      <DataTable<MigrationBatch>
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

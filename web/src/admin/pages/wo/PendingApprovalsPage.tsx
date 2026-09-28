/**
 * ADM-17 예외 승인 대기 (B4-01·B4-02·라우팅 삽입·B4-06) — [S2-3]
 * `GET /scan/pending` (station_id 생략 → 전체) → PendingScan[]. 승인/거부 `POST /scan/{event_uuid}/approve`
 * (JWT ADMIN/MANAGER 경로, `X-Approval-Token` 은 목록의 approval_token 을 쓴다). 409 STATE_CONFLICT(이미 처리됨)
 * → 행 제거 + 안내. 실시간 WS(`approval_pending`)는 S4-2 이후 — 그 전에는 30초 polling(주기 기본값).
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, DataTable, PageHeader, useToast, type Column } from '@/shared/ui/admin'
import { useApiMutation, useApiQuery } from '@/shared/hooks'
import { isApiError, scanApi } from '@/shared/api'
import type { ApproveRequest, PendingScan } from '@/shared/types'
import { ScanActionLabel } from '@/shared/labels'
import { formatDateTime } from '../../format'
import { ApiErrorAlert, CodeText, ConfirmDialog, Textarea } from '../../components'

const POLL_MS = 30_000

type Decision = 'APPROVE' | 'DENY'

function DecisionDialog({
  item,
  decision,
  onClose,
  onDone,
  onConflict,
}: {
  item: PendingScan | null
  decision: Decision | null
  onClose: () => void
  onDone: (msg: string) => void
  onConflict: (msg: string) => void
}) {
  const [note, setNote] = useState('')
  useEffect(() => {
    if (item) setNote('')
  }, [item])
  const approve = useApiMutation((body: ApproveRequest) => scanApi.approve(item!.event_uuid, body, item!.approval_token))
  const open = item !== null && decision !== null
  const label = item?.wo?.code ?? item?.event_uuid ?? ''
  return (
    <ConfirmDialog
      open={open}
      title={decision === 'APPROVE' ? `승인 — ${label}` : `거부 — ${label}`}
      danger={decision === 'DENY'}
      confirmLabel={decision === 'APPROVE' ? '승인' : '거부'}
      loading={approve.loading}
      error={approve.error}
      onClose={onClose}
      onConfirm={() =>
        void approve
          .mutate({ decision: decision!, note: note.trim() || undefined })
          .then((res) => onDone(res.message))
          .catch((e: unknown) => {
            if (isApiError(e) && e.status === 409) onConflict(e.message)
          })
      }
    >
      <div className="space-y-3">
        <p>{item?.message}</p>
        <p className="text-ad-xs text-ink-muted">E1 승인 = 미완료 직전 단계 전부 DONE_ESTIMATED 후 본 스캔 반영 (api-contract §5.2-4)</p>
        <Textarea label="메모 (선택)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      </div>
    </ConfirmDialog>
  )
}

export function PendingApprovalsPage() {
  const toast = useToast()
  const list = useApiQuery<PendingScan[]>(['scan', 'pending'], () => scanApi.pending())
  const [target, setTarget] = useState<{ item: PendingScan; decision: Decision } | null>(null)

  useEffect(() => {
    const t = window.setInterval(() => void list.refetch(), POLL_MS)
    return () => window.clearInterval(t)
  }, [list.refetch])

  const columns: Column<PendingScan>[] = [
    { key: 'scanned_at', header: '스캔 시각', render: (r) => <span className="tabular-nums">{formatDateTime(r.scanned_at, true)}</span> },
    {
      key: 'station_id',
      header: '단말 · 공정',
      render: (r) => (
        <span>
          <CodeText code={r.station_id} /> {r.process_code ? <span className="font-mono text-ad-xs">{r.process_code}</span> : null}
        </span>
      ),
    },
    { key: 'worker', header: '작업자', render: (r) => r.worker?.name ?? '—' },
    {
      key: 'wo',
      header: 'WO',
      render: (r) =>
        r.wo ? (
          <span className="flex flex-col">
            <Link to={`/admin/wo/${encodeURIComponent(r.wo.code)}`} className="text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>
              <CodeText code={r.wo.code} />
            </Link>
            <span className="text-ad-xs text-ink-muted">
              {r.wo.customer_name} · {r.wo.item_name}
            </span>
          </span>
        ) : (
          '—'
        ),
    },
    { key: 'action', header: '액션', render: (r) => `${r.action} ${ScanActionLabel[r.action]}` },
    { key: 'message', header: '사유', render: (r) => r.message },
    {
      key: '_actions',
      header: '',
      render: (r) => (
        <span className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="primary" onClick={() => setTarget({ item: r, decision: 'APPROVE' })}>
            승인
          </Button>
          <Button size="sm" variant="danger" onClick={() => setTarget({ item: r, decision: 'DENY' })}>
            거부
          </Button>
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="예외 승인 대기"
        breadcrumb="작업지시 › 예외 승인 대기 (ADM-17)"
        description="E1·E2·라우팅 삽입·E6 승인 대기 (GET /scan/pending). 30초 주기 갱신 — 실시간 WS 연동은 S4-2 이후"
      />
      <DataTable<PendingScan>
        columns={columns}
        rows={list.data ?? []}
        rowKey={(r) => r.event_uuid}
        loading={list.loading}
        error={list.error ? <ApiErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : undefined}
        emptyText="승인 대기 건이 없습니다"
        pageSize={0}
      />
      <DecisionDialog
        item={target?.item ?? null}
        decision={target?.decision ?? null}
        onClose={() => setTarget(null)}
        onDone={(msg) => {
          toast.success(msg)
          setTarget(null)
          void list.refetch()
        }}
        onConflict={(msg) => {
          toast.error(msg)
          setTarget(null)
          void list.refetch()
        }}
      />
    </>
  )
}

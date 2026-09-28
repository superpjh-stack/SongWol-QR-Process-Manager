/**
 * ADM-16 WO 상세 — 헤더(ADM-15 컬럼 전부 + hold_reason·closed_at·도안·parent/children) · 보류/재개/취소/종결(ReasonDialog·409 인라인)
 * · 라벨 재출력(WO_LABEL = POST /labels/print 프린터 선택 · WORK_ORDER_PDF = POST /wo/{id}/reprint → pdf_url) · 작업지시서 PDF
 * · 하위 WO 분할(E4, POST /wo/{id}/split) [S3-3] · 재작업(E3, POST /wo/{id}/rework) [S4-6]
 * 탭: 단계 타임라인(Timeline) · 이벤트 로그(recent_events → GET /wo/{id}/events, 행별 [취소] = E6 관리자 웹 발의
 * `POST /wo/{id}/events/{event_uuid}/cancel`, JWT MANAGER/ADMIN [S4]) · 발행 이력(GET /labels/issues?target_code=)
 * 예외 승인은 [S2-3] (ADM-17 로 분리)
 */
import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Button, DataTable, DescriptionList, ErrorAlert, Modal, NumberInput, PageHeader, Select, Spinner, Tabs, Timeline, useToast, type Column } from '@/shared/ui/admin'
import { StatusBadge } from '@/shared/ui'
import { useApiMutation, useApiQuery, useArray, useAuth } from '@/shared/hooks'
import { ApiError, labelsApi, pdfApi, woApi } from '@/shared/api'
import type { LabelIssue, LabelJob, Page, Printer, Process, ReworkResponse, ScanEventSummary, SplitResponse, WorkOrderDetail } from '@/shared/types'
import { LabelTypeLabel, PrintMethodCodeLabel, ScanActionLabel, TargetTypeLabel } from '@/shared/labels'
import { formatDate, formatDateTime, formatQty, isOverdue } from '../../format'
import { canWrite } from '../../permissions'
import { ApiErrorAlert, AuthImage, CodeText, Checkbox, ConfirmDialog, RadioGroup, ReasonDialog, REASON_MAX, Textarea } from '../../components'
import { canCancelEvent, cancelledEventUuids } from './eventCancel'
import { processNameFn } from './woColumns'

type Tab = 'timeline' | 'events' | 'issues'
type ReprintType = 'WO_LABEL' | 'WORK_ORDER_PDF'

/* ───────── 라벨 재출력 ───────── */
function ReprintModal({ wo, open, onClose }: { wo: WorkOrderDetail; open: boolean; onClose: () => void }) {
  const printers = useArray<Printer>('printers', { active: true }, open)
  const [type, setType] = useState<ReprintType>('WO_LABEL')
  const [printer, setPrinter] = useState('')
  const [copies, setCopies] = useState(1)
  const [job, setJob] = useState<LabelJob | null>(null)
  const printLabel = useApiMutation(() => labelsApi.print({ target: wo.code, label_type: 'WO_LABEL', printer, copies }))
  const reprintPdf = useApiMutation(() => woApi.reprint(wo.id, { label_type: 'WORK_ORDER_PDF' }))
  const dl = useApiMutation((url: string) => pdfApi.byUrl(url, `${wo.code}.pdf`))
  const busy = printLabel.loading || reprintPdf.loading
  const error = printLabel.error ?? reprintPdf.error ?? dl.error
  const run = async () => {
    setJob(null)
    try {
      if (type === 'WO_LABEL') {
        const r = await printLabel.mutate(undefined)
        setJob(r)
      } else {
        const r = await reprintPdf.mutate(undefined)
        setJob(r)
        if (r.pdf_url) await dl.mutate(r.pdf_url)
      }
    } catch {
      /* error 표시 */
    }
  }
  return (
    <Modal
      open={open}
      title={`라벨 재출력 — ${wo.code}`}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            닫기
          </Button>
          <Button variant="primary" loading={busy} disabled={type === 'WO_LABEL' && (!printer || copies < 1)} onClick={() => void run()}>
            {type === 'WO_LABEL' ? '출력 전송' : 'PDF 재발행'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error ? <ApiErrorAlert error={error} onRetry={() => void run()} /> : null}
        {job ? (
          job.label_type === 'WO_LABEL' || type === 'WO_LABEL' ? (
            job.zpl_sent && !job.error ? (
              <ErrorAlert title={`${job.issue_no}차 출력 전송`} message={`프린터 ${job.printer_id ?? '—'} · ${job.copies}매 · ${formatDateTime(job.sent_at)}`} className="border-status-done-line bg-status-done-bg text-status-done-fg" />
            ) : (
              <ErrorAlert title="전송 실패" message={`${job.error ?? 'ZPL 미전송'} — 프린터 ${job.printer_id ?? printer}`} onRetry={() => void run()} />
            )
          ) : (
            <ErrorAlert title={`${job.issue_no}차 PDF 재발행`} message={job.pdf_url ? '다운로드를 시작했습니다' : 'pdf_url 이 응답에 없습니다'} className="border-status-done-line bg-status-done-bg text-status-done-fg" />
          )
        ) : null}
        <RadioGroup<ReprintType>
          label="라벨 종류"
          name="reprint_type"
          value={type}
          onChange={setType}
          options={[
            { value: 'WO_LABEL', label: LabelTypeLabel.WO_LABEL, hint: 'POST /labels/print — 프린터 선택 필수 (ADM-09 활성)' },
            { value: 'WORK_ORDER_PDF', label: LabelTypeLabel.WORK_ORDER_PDF, hint: 'POST /wo/{id}/reprint → pdf_url 다운로드 (issue_no +1)' },
          ]}
        />
        {type === 'WO_LABEL' ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {printers.error ? (
              <ApiErrorAlert error={printers.error} onRetry={() => void printers.refetch()} className="md:col-span-2" />
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
            <NumberInput label="매수" min={1} max={20} value={copies} onChange={(e) => setCopies(Number(e.target.value) || 1)} />
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

/* ───────── 하위 WO 분할 (E4, [S3-3]) ───────── */
function SplitModal({ wo, open, onClose, onDone }: { wo: WorkOrderDetail; open: boolean; onClose: () => void; onDone: (res: SplitResponse) => void }) {
  const [qty, setQty] = useState(1)
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const split = useApiMutation((body: { qty: number; reason: string }) => woApi.split(wo.id, body))
  const reset = () => {
    setQty(1)
    setReason('')
    setTouched(false)
    split.reset()
  }
  const trimmed = reason.trim()
  const qtyErr = qty < 1 || qty >= wo.qty_ordered ? `1 이상 ${wo.qty_ordered - 1} 이하로 입력하세요` : undefined
  const reasonErr = touched && trimmed.length === 0 ? '사유를 입력하세요' : trimmed.length > REASON_MAX ? `${REASON_MAX}자 이하로 입력하세요` : undefined
  return (
    <Modal
      open={open}
      title={`하위 WO 분할 — ${wo.code}`}
      onClose={() => {
        reset()
        onClose()
      }}
      dismissible={!split.loading}
      footer={
        <>
          <Button variant="ghost" onClick={() => { reset(); onClose() }} disabled={split.loading}>
            취소
          </Button>
          <Button
            variant="primary"
            loading={split.loading}
            onClick={() => {
              setTouched(true)
              if (qtyErr || trimmed.length === 0 || trimmed.length > REASON_MAX) return
              void split
                .mutate({ qty, reason: trimmed })
                .then((res) => {
                  reset()
                  onDone(res)
                })
                .catch(() => undefined)
            }}
          >
            분할
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {split.error ? <ApiErrorAlert error={split.error} /> : null}
        <p className="text-ad-xs text-ink-muted">
          지시 수량 {formatQty(wo.qty_ordered)} 중 일부를 새 하위 WO 로 분리합니다. 26개 초과 시 409 SPLIT_LIMIT.
        </p>
        <NumberInput label="분할 수량" required min={1} max={wo.qty_ordered - 1} value={qty} onChange={(e) => setQty(Number(e.target.value) || 0)} error={qtyErr} />
        <Textarea label="사유" required maxLength={REASON_MAX} value={reason} error={reasonErr} onBlur={() => setTouched(true)} onChange={(e) => setReason(e.target.value)} hint={`${trimmed.length}/${REASON_MAX}`} />
      </div>
    </Modal>
  )
}

/* ───────── 재작업 (E3, [S4-6]) ───────── */
function ReworkModal({ wo, open, onClose, onDone }: { wo: WorkOrderDetail; open: boolean; onClose: () => void; onDone: (res: ReworkResponse) => void }) {
  const [qty, setQty] = useState(1)
  const [reason, setReason] = useState('')
  const [reinsertP30, setReinsertP30] = useState(true)
  const [touched, setTouched] = useState(false)
  const rework = useApiMutation((body: { qty: number; reason: string; reinsert_p30: boolean }) => woApi.rework(wo.id, body))
  const reset = () => {
    setQty(1)
    setReason('')
    setReinsertP30(true)
    setTouched(false)
    rework.reset()
  }
  const trimmed = reason.trim()
  const qtyErr = wo.qty_bad <= 0 ? '불량 수량이 없습니다' : qty < 1 || qty > wo.qty_bad ? `1 이상 ${wo.qty_bad} 이하로 입력하세요` : undefined
  const reasonErr = touched && trimmed.length === 0 ? '사유를 입력하세요' : trimmed.length > REASON_MAX ? `${REASON_MAX}자 이하로 입력하세요` : undefined
  return (
    <Modal
      open={open}
      title={`재작업 — ${wo.code}`}
      onClose={() => {
        reset()
        onClose()
      }}
      dismissible={!rework.loading}
      footer={
        <>
          <Button variant="ghost" onClick={() => { reset(); onClose() }} disabled={rework.loading}>
            취소
          </Button>
          <Button
            variant="primary"
            loading={rework.loading}
            disabled={wo.qty_bad <= 0}
            onClick={() => {
              setTouched(true)
              if (qtyErr || trimmed.length === 0 || trimmed.length > REASON_MAX) return
              void rework
                .mutate({ qty, reason: trimmed, reinsert_p30: reinsertP30 })
                .then((res) => {
                  reset()
                  onDone(res)
                })
                .catch(() => undefined)
            }}
          >
            재작업 등록
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {rework.error ? <ApiErrorAlert error={rework.error} /> : null}
        <p className="text-ad-xs text-ink-muted">
          불량 수량 {formatQty(wo.qty_bad)} 중 일부를 재작업 하위 WO 로 분리합니다 (stock_txn REWORK).
        </p>
        <NumberInput label="재작업 수량" required min={1} max={Math.max(1, wo.qty_bad)} value={qty} onChange={(e) => setQty(Number(e.target.value) || 0)} error={qtyErr} disabled={wo.qty_bad <= 0} />
        <Textarea label="사유" required maxLength={REASON_MAX} value={reason} error={reasonErr} onBlur={() => setTouched(true)} onChange={(e) => setReason(e.target.value)} hint={`${trimmed.length}/${REASON_MAX}`} disabled={wo.qty_bad <= 0} />
        <Checkbox label="재인쇄 가능하면 라우팅 P30 부터 재삽입" checked={reinsertP30} onChange={(e) => setReinsertP30(e.target.checked)} hint="해제 시 P50(포장)부터 — 재인쇄 불가한 경우" disabled={wo.qty_bad <= 0} />
      </div>
    </Modal>
  )
}

/* ───────── 이벤트 로그 ───────── */
function eventColumns(opts: { canCancel: boolean; cancelledUuids: Set<string>; onCancel: (row: ScanEventSummary) => void }): Column<ScanEventSummary>[] {
  return [
    {
      key: 'scanned_at',
      header: '스캔 / 수신',
      render: (r) => (
        <span className="tabular-nums text-ad-xs">
          {formatDateTime(r.scanned_at, true)}
          <br />
          <span className="text-ink-muted">{formatDateTime(r.received_at, true)}</span>
        </span>
      ),
    },
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
      key: 'target_code',
      header: '대상',
      render: (r) => (
        <span>
          <span className="text-ad-xs text-ink-muted">{TargetTypeLabel[r.target_type]}</span> <CodeText code={r.target_code} />
        </span>
      ),
    },
    { key: 'action', header: '액션', render: (r) => `${r.action} ${ScanActionLabel[r.action]}` },
    {
      key: 'qty_good',
      header: '양품/불량/박스',
      align: 'right',
      render: (r) => (
        <span className="tabular-nums">
          {formatQty(r.qty_good)} / {formatQty(r.qty_bad)} / {formatQty(r.qty_box)}
        </span>
      ),
    },
    { key: 'equipment', header: '설비', render: (r) => (r.equipment ? <CodeText code={r.equipment.code} /> : '—') },
    {
      key: 'result',
      header: '결과',
      render: (r) => (
        <span className="inline-flex flex-col gap-0.5">
          <StatusBadge kind="scanResult" status={r.result} />
          {r.result_msg ? <span className="text-ad-xs text-ink-muted">{r.result_msg}</span> : null}
        </span>
      ),
    },
    { key: 'approval_status', header: '승인', render: (r) => (r.approval_status ? <StatusBadge kind="approval" status={r.approval_status} /> : '—') },
    { key: 'compensates_uuid', header: '보상', render: (r) => (r.compensates_uuid ? <span className="font-mono text-ad-xs">{r.compensates_uuid.slice(0, 8)}…</span> : '—') },
    {
      key: 'payload',
      header: 'payload',
      render: (r) =>
        Object.keys(r.payload ?? {}).length ? (
          <details>
            <summary className="cursor-pointer text-ad-xs text-brand-700">펼침</summary>
            <pre className="mt-1 max-w-xs overflow-auto whitespace-pre-wrap break-all font-mono text-ad-xs">{JSON.stringify(r.payload, null, 1)}</pre>
          </details>
        ) : (
          '—'
        ),
    },
    {
      key: '_actions',
      header: '',
      render: (r) =>
        opts.canCancel && canCancelEvent(r, opts.cancelledUuids) ? (
          <Button size="sm" variant="danger" onClick={() => opts.onCancel(r)}>
            취소
          </Button>
        ) : null,
    },
  ]
}

/** E6 관리자 웹 발의 취소 확인 (admin #28 [S4]). JWT 가 곧 승인 — 카드/PIN 없음, reason 필수 */
function CancelEventDialog({ wo, event, onClose, onDone }: { wo: WorkOrderDetail; event: ScanEventSummary | null; onClose: () => void; onDone: (msg: string) => void }) {
  const cancel = useApiMutation((reason: string) => woApi.cancelEvent(wo.id, event!.event_uuid, reason))
  return (
    <ReasonDialog
      open={event !== null}
      title={`이벤트 취소 — ${event?.action ?? ''} ${event ? ScanActionLabel[event.action] : ''}`}
      danger
      confirmLabel="취소 확정"
      loading={cancel.loading}
      error={cancel.error}
      onClose={onClose}
      onConfirm={(reason) =>
        void cancel
          .mutate(reason)
          .then(() => onDone('이벤트가 취소되었습니다'))
          .catch(() => undefined)
      }
    >
      <p>
        스캔 시각 {event ? formatDateTime(event.scanned_at, true) : ''} · 대상 <CodeText code={event?.target_code ?? ''} /> · 결과{' '}
        {event ? <StatusBadge kind="scanResult" status={event.result} /> : null}
      </p>
      <p className="text-ad-xs text-ink-muted">JWT 승인이 곧 승인이므로 CANCEL 이벤트를 APPROVED 로 즉시 기록하고 리플레이합니다 (admin #28).</p>
    </ReasonDialog>
  )
}

function EventsTab({ wo, refetchWo }: { wo: WorkOrderDetail; refetchWo: () => Promise<void> }) {
  const { role } = useAuth()
  const toast = useToast()
  const canCancel = role === 'MANAGER' || role === 'ADMIN'
  const [all, setAll] = useState(false)
  const [page, setPage] = useState(1)
  const size = 50
  const events = useApiQuery<Page<ScanEventSummary>>(['res', 'wo', wo.id, 'events', page, size], () => woApi.events(wo.id, { page, size }), all)
  const [target, setTarget] = useState<ScanEventSummary | null>(null)
  const allRows: ScanEventSummary[] = all ? (events.data?.items ?? []) : wo.recent_events
  const cancelledUuids = useMemo(() => cancelledEventUuids(allRows), [allRows])
  const cols = useMemo(() => eventColumns({ canCancel, cancelledUuids, onCancel: setTarget }), [canCancel, cancelledUuids])
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-ad-xs text-ink-muted">
          {all ? '전체 이벤트 (GET /wo/{id}/events)' : `최근 이벤트 ${wo.recent_events.length}건 (recent_events)`} · PENDING 승인은 [S2-3, ADM-17] · 행별 [취소]는 E6 (admin #28, MANAGER/ADMIN)
        </p>
        {!all ? (
          <Button size="sm" variant="secondary" onClick={() => setAll(true)}>
            전체 보기
          </Button>
        ) : null}
      </div>
      {all ? (
        <DataTable<ScanEventSummary>
          columns={cols}
          rows={events.data?.items ?? []}
          rowKey={(r) => r.event_uuid}
          loading={events.loading}
          error={events.error ? <ApiErrorAlert error={events.error} onRetry={() => void events.refetch()} /> : undefined}
          emptyText="스캔 이벤트가 없습니다 (키오스크 스캔은 S2)"
          pagination={{ page, pageSize: size, total: events.data?.total ?? 0, onPageChange: setPage }}
          dense
        />
      ) : (
        <DataTable<ScanEventSummary> columns={cols} rows={wo.recent_events} rowKey={(r) => r.event_uuid} pageSize={0} emptyText="스캔 이벤트가 없습니다 (키오스크 스캔은 S2)" dense />
      )}
      <CancelEventDialog
        wo={wo}
        event={target}
        onClose={() => setTarget(null)}
        onDone={(msg) => {
          toast.success(msg)
          setTarget(null)
          void events.refetch()
          void refetchWo()
        }}
      />
    </div>
  )
}

function IssuesTab({ wo }: { wo: WorkOrderDetail }) {
  const issues = useApiQuery<LabelIssue[]>(['labels', 'issues', wo.code], () => labelsApi.issues(wo.code))
  const cols: Column<LabelIssue>[] = [
    { key: 'issued_at', header: '발행 시각', render: (r) => <span className="tabular-nums">{formatDateTime(r.issued_at, true)}</span> },
    { key: 'label_type', header: '라벨', render: (r) => LabelTypeLabel[r.label_type] },
    { key: 'issue_no', header: '차수', align: 'right', render: (r) => <span className="tabular-nums">{r.issue_no}</span> },
    { key: 'printer_id', header: '프린터', render: (r) => <CodeText code={r.printer_id} /> },
    { key: 'sent_at', header: '전송 시각', render: (r) => <span className="tabular-nums">{formatDateTime(r.sent_at, true)}</span> },
    { key: 'copies', header: '매수', align: 'right' },
    {
      key: 'zpl_sent',
      header: '결과',
      render: (r) =>
        r.label_type === 'WORK_ORDER_PDF' ? (
          <StatusBadge kind="scanResult" status="OK" labelOverride="PDF 발행" />
        ) : r.zpl_sent && !r.error ? (
          <StatusBadge kind="scanResult" status="OK" labelOverride="전송" />
        ) : (
          <StatusBadge kind="scanResult" status="REJECT" labelOverride={r.error ?? '미전송'} />
        ),
    },
    { key: 'issued_by', header: '발행자', render: (r) => r.issued_by?.name ?? '—' },
    { key: 'station_id', header: '단말', render: (r) => <CodeText code={r.station_id} /> },
  ]
  return (
    <DataTable<LabelIssue>
      columns={cols}
      rows={issues.data ?? []}
      rowKey={(r) => r.id}
      loading={issues.loading}
      error={issues.error ? <ApiErrorAlert error={issues.error} onRetry={() => void issues.refetch()} /> : undefined}
      emptyText="발행 이력이 없습니다"
      pageSize={0}
    />
  )
}

/* ───────── 페이지 ───────── */
function Detail({ wo, refetch }: { wo: WorkOrderDetail; refetch: () => Promise<void> }) {
  const { role } = useAuth()
  const manage = canWrite(role, 'wo') // ADMIN/MANAGER
  const reprintable = canWrite(role, 'so') // ADMIN/MANAGER/SALES (라벨 출력 W)
  const toast = useToast()
  const [sp, setSp] = useSearchParams()
  const tab: Tab = sp.get('tab') === 'events' ? 'events' : sp.get('tab') === 'issues' ? 'issues' : 'timeline'
  const setTab = (t: Tab) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev)
        n.set('tab', t)
        return n
      },
      { replace: true },
    )
  const processes = useArray<Process>('processes')
  const pname = processNameFn(processes.data)
  const [dialog, setDialog] = useState<'hold' | 'resume' | 'cancel' | 'close' | null>(null)
  const [reprintOpen, setReprintOpen] = useState(false)
  const [splitOpen, setSplitOpen] = useState(false)
  const [reworkOpen, setReworkOpen] = useState(false)
  const hold = useApiMutation((reason: string) => woApi.hold(wo.id, reason))
  const resume = useApiMutation(() => woApi.resume(wo.id))
  const cancel = useApiMutation((reason: string) => woApi.cancel(wo.id, reason))
  const close = useApiMutation(() => woApi.close(wo.id))
  const pdf = useApiMutation(() => pdfApi.workOrder(wo.code))
  const s = wo.status
  const terminal = s === 'CANCELLED' || s === 'CLOSED'
  const after = (msg: string) => {
    toast.success(msg)
    setDialog(null)
    void refetch()
  }

  return (
    <>
      <PageHeader
        title={`작업지시 ${wo.code}`}
        breadcrumb={
          <>
            <Link to="/admin/wo" className="hover:underline">
              작업지시
            </Link>{' '}
            › 상세 (ADM-16)
          </>
        }
        actions={
          <>
            <Button loading={pdf.loading} onClick={() => void pdf.mutate(undefined).catch(() => undefined)}>
              작업지시서 PDF
            </Button>
            <Button disabled={!reprintable || terminal} onClick={() => setReprintOpen(true)}>
              라벨 재출력
            </Button>
            <Button disabled={!manage || terminal || wo.qty_ordered < 2} title="1 ≤ 수량 < 지시 수량 · 26개 초과 시 409 SPLIT_LIMIT" onClick={() => setSplitOpen(true)}>
              분할
            </Button>
            <Button disabled={!manage || terminal || wo.qty_bad <= 0} title="불량 수량이 있어야 재작업 가능" onClick={() => setReworkOpen(true)}>
              재작업
            </Button>
            {s === 'ON_HOLD' ? (
              <Button variant="primary" disabled={!manage} onClick={() => setDialog('resume')}>
                재개
              </Button>
            ) : (
              <Button disabled={!manage || terminal} onClick={() => setDialog('hold')}>
                보류
              </Button>
            )}
            <Button disabled={!manage || terminal || s !== 'SHIPPED'} title="SHIPPED 후 종결 (전이 규칙은 서버, 409 message 표시)" onClick={() => setDialog('close')}>
              종결
            </Button>
            <Button variant="danger" disabled={!manage || terminal} onClick={() => setDialog('cancel')}>
              취소
            </Button>
          </>
        }
      />
      {pdf.error ? <ApiErrorAlert error={pdf.error} onRetry={() => void pdf.mutate(undefined).catch(() => undefined)} className="mb-3" /> : null}
      {/* QA2-S4 수정(axe link-in-text-block, serious): 문장 중간에 낀 링크가 밑줄 등 색 외의
          구분 수단 없이 hover 시에만 밑줄이 붙어 주변 회색 텍스트와 대비도 부족했다(1.06:1,
          기준 3:1) — 상시 underline 으로 색 없이도 구분되게 한다. */}
      <p className="mb-3 text-ad-xs text-ink-muted">예외 승인 대기는 별도 화면 → <Link to="/admin/wo/pending" className="text-brand-700 underline">ADM-17</Link></p>
      <section className="mb-4 flex flex-col gap-4 rounded-ad border border-line bg-surface p-4 lg:flex-row">
        <div className="shrink-0">
          {wo.design_thumbnail_url ? (
            <AuthImage src={wo.design_thumbnail_url} alt={`도안 v${wo.design_version ?? ''}`} width={160} height={160} className="rounded-ad border border-line object-cover" />
          ) : (
            <div className="flex h-40 w-40 items-center justify-center rounded-ad border border-dashed border-line text-ad-xs text-ink-faint">{wo.design_version !== null ? `도안 v${wo.design_version} (썸네일 없음)` : '도안 없음'}</div>
          )}
        </div>
        <DescriptionList
          cols={4}
          className="flex-1"
          items={[
            { label: 'WO', value: <CodeText code={wo.code} copy /> },
            { label: '수주', value: <Link to={`/admin/so/${encodeURIComponent(wo.so_code)}`} className="text-brand-700 hover:underline"><CodeText code={wo.so_code} /></Link> },
            { label: '거래처', value: wo.customer_name },
            { label: '품목', value: `${wo.item.name ?? wo.item.code} ${[wo.item.spec, wo.item.color].filter(Boolean).join(' · ')}` },
            { label: '가공방식', value: PrintMethodCodeLabel[wo.print_method] ?? wo.print_method },
            {
              label: '상태',
              value: (
                <span className="inline-flex items-center gap-2">
                  <StatusBadge kind="wo" status={wo.status} />
                  {wo.delay_risk ? <StatusBadge kind="delay" status={true} /> : null}
                </span>
              ),
            },
            { label: '현재 공정', value: wo.current_process_code ? `${wo.current_process_code} ${pname(wo.current_process_code)} #${wo.current_step_seq ?? ''}` : '—' },
            { label: '납기', value: <span className={isOverdue(wo.due_date, wo.status) ? 'font-semibold text-status-error-fg' : ''}>{formatDate(wo.due_date)}</span> },
            { label: '지시', value: formatQty(wo.qty_ordered) },
            { label: '입고', value: <span className="inline-flex items-center gap-1">{formatQty(wo.qty_received)} <StatusBadge kind="receipt" status={wo.receipt_status} /></span> },
            { label: '양품 / 불량', value: `${formatQty(wo.qty_good)} / ${formatQty(wo.qty_bad)}` },
            { label: '포장 / 발송', value: `${formatQty(wo.qty_packed)} / ${formatQty(wo.qty_shipped)}` },
            { label: '발행', value: formatDateTime(wo.issued_at) },
            { label: '종결', value: formatDateTime(wo.closed_at) },
            { label: '도안 버전', value: wo.design_version !== null ? `v${wo.design_version}` : '—' },
            { label: '상위 WO', value: wo.parent_wo_code ? <Link to={`/admin/wo/${encodeURIComponent(wo.parent_wo_code)}`} className="text-brand-700 hover:underline"><CodeText code={wo.parent_wo_code} /></Link> : '—' },
            ...(wo.status === 'ON_HOLD' ? [{ label: '보류 사유', value: <span className="text-status-warn-fg">{wo.hold_reason ?? '—'}</span>, span: true }] : []),
            ...(wo.children.length
              ? [
                  {
                    label: '하위 WO',
                    value: (
                      <span className="flex flex-wrap gap-2">
                        {wo.children.map((c) => (
                          <Link key={c.id} to={`/admin/wo/${encodeURIComponent(c.code)}`} className="text-brand-700 hover:underline">
                            <CodeText code={c.code} /> <StatusBadge kind="wo" status={c.status} />
                          </Link>
                        ))}
                      </span>
                    ),
                    span: true,
                  },
                ]
              : []),
          ]}
        />
      </section>
      <Tabs<Tab>
        tabs={[
          { key: 'timeline', label: '단계 타임라인', badge: wo.steps.length },
          { key: 'events', label: '이벤트 로그', badge: wo.recent_events.length },
          { key: 'issues', label: '발행 이력' },
        ]}
        value={tab}
        onChange={setTab}
      >
        {tab === 'timeline' ? <Timeline steps={wo.steps} formatDateTime={formatDateTime} formatQty={formatQty} /> : tab === 'events' ? <EventsTab wo={wo} refetchWo={refetch} /> : <IssuesTab wo={wo} />}
      </Tabs>

      <ReasonDialog
        open={dialog === 'hold'}
        title={`보류 — ${wo.code}`}
        confirmLabel="보류"
        loading={hold.loading}
        error={hold.error}
        onClose={() => setDialog(null)}
        onConfirm={(reason) => void hold.mutate(reason).then(() => after('보류 처리되었습니다')).catch(() => undefined)}
      >
        <p>
          현재 상태 <StatusBadge kind="wo" status={wo.status} /> → 보류. 단말 스캔은 거부됩니다.
        </p>
      </ReasonDialog>
      <ConfirmDialog open={dialog === 'resume'} title={`재개 — ${wo.code}`} confirmLabel="재개" loading={resume.loading} error={resume.error} onClose={() => setDialog(null)} onConfirm={() => void resume.mutate(undefined).then(() => after('재개되었습니다')).catch(() => undefined)}>
        <p>보류 사유: {wo.hold_reason ?? '—'}. ON_HOLD → 재계산.</p>
      </ConfirmDialog>
      <ReasonDialog
        open={dialog === 'cancel'}
        title={`취소 — ${wo.code}`}
        danger
        confirmLabel="WO 취소"
        loading={cancel.loading}
        error={cancel.error}
        onClose={() => setDialog(null)}
        onConfirm={(reason) => void cancel.mutate(reason).then(() => after('취소되었습니다')).catch(() => undefined)}
      >
        <p>
          현재 상태 <StatusBadge kind="wo" status={wo.status} />. 착수 WO 취소는 MANAGER/ADMIN 권한으로 갈음 (별도 PIN 없음, api-contract §12-8).
        </p>
      </ReasonDialog>
      <ConfirmDialog open={dialog === 'close'} title={`종결 — ${wo.code}`} confirmLabel="종결" loading={close.loading} error={close.error} onClose={() => setDialog(null)} onConfirm={() => void close.mutate(undefined).then(() => after('종결되었습니다')).catch(() => undefined)}>
        <p>
          현재 상태 <StatusBadge kind="wo" status={wo.status} /> → CLOSED. 이후 변경 불가.
        </p>
      </ConfirmDialog>
      <ReprintModal wo={wo} open={reprintOpen} onClose={() => setReprintOpen(false)} />
      <SplitModal
        wo={wo}
        open={splitOpen}
        onClose={() => setSplitOpen(false)}
        onDone={(res) => {
          setSplitOpen(false)
          toast.success(`분할되었습니다 — 하위 WO ${res.child.code}`)
          void refetch()
        }}
      />
      <ReworkModal
        wo={wo}
        open={reworkOpen}
        onClose={() => setReworkOpen(false)}
        onDone={(res) => {
          setReworkOpen(false)
          toast.success(`재작업 하위 WO ${res.child.code} 등록되었습니다`)
          void refetch()
        }}
      />
    </>
  )
}

export function WorkOrderDetailPage() {
  const { code = '' } = useParams<{ code: string }>()
  const wo = useApiQuery<WorkOrderDetail>(['res', 'wo', 'one', code], () => woApi.get(code), code !== '')
  if (wo.error instanceof ApiError && wo.error.status === 404) {
    return (
      <>
        <PageHeader title={`작업지시 ${code}`} breadcrumb="작업지시 › 상세 (ADM-16)" />
        <ErrorAlert title="찾을 수 없습니다" message={wo.error.message} />
        <Link to="/admin/wo" className="mt-3 inline-block text-brand-700 hover:underline">
          ← 작업지시 목록
        </Link>
      </>
    )
  }
  if (wo.data) return <Detail wo={wo.data} refetch={wo.refetch} />
  if (wo.error) return <ApiErrorAlert error={wo.error} onRetry={() => void wo.refetch()} />
  return (
    <div className="flex justify-center py-12">
      <Spinner label="불러오는 중…" />
    </div>
  )
}

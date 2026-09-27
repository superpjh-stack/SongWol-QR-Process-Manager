/**
 * ADM-14 수주 상세 (A2-02·03·04·06·07·09) — [S1-2·S1-3·S1-7]
 * 헤더 DescriptionList + 진행률 · [수정] [작업지시서 PDF] [수주 취소] [변경 이력]
 * 탭 1 라인·도안: 업로드(admin #25 png/jpg/jpeg/pdf/ai/svg 20MB) · 시안 확정 (NONE 면제)
 * 탭 2 작업지시: WO 목록 · [WO 분할 제안] → 초안 표(분리만, admin #26) → [확정·발행] → 결과(WO 코드·PDF)
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button, DataTable, DescriptionList, ErrorAlert, Modal, NumberInput, PageHeader, ProgressBar, Spinner, Tabs, useToast, type Column } from '@/shared/ui/admin'
import { StatusBadge } from '@/shared/ui'
import { useApiMutation, useApiQuery, useArray, useAuth } from '@/shared/hooks'
import { ApiError, pdfApi, soApi } from '@/shared/api'
import type { Design, IssueWoResponse, Process, SalesOrderDetail, SalesOrderLine, SoCancelResponse, WoDraft, WorkOrderSummary } from '@/shared/types'
import { PrintMethodCodeLabel } from '@/shared/labels'
import { formatDate, formatDateTime, formatMoney, formatQty, isOverdue } from '../../format'
import { canWrite } from '../../permissions'
import { ApiErrorAlert, AuthImage, CodeText, ConfirmDialog, FileDropzone, ReasonDialog, RowActions } from '../../components'
import { processNameFn, woColumns } from '../wo/woColumns'
import { draftQtyMismatch, mergeDraftsOfLine, splitDraft } from './woProposal'

const DESIGN_ACCEPT = '.png,.jpg,.jpeg,.pdf,.ai,.svg'
const DESIGN_MAX = 20 * 1024 * 1024
const DESIGN_EXT = /\.(png|jpe?g|pdf|ai|svg)$/i

/* ───────── 도안 업로드 ───────── */
function DesignUploadModal({ so, line, onClose, onDone }: { so: SalesOrderDetail; line: SalesOrderLine | null; onClose: () => void; onDone: (d: Design) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [clientErr, setClientErr] = useState<string | null>(null)
  const upload = useApiMutation(({ lineId, f }: { lineId: number; f: File }) => soApi.uploadDesign(so.id, lineId, f))
  useEffect(() => {
    if (line) {
      setFile(null)
      setClientErr(null)
      upload.reset()
    }
  }, [line])
  const pick = (f: File | null) => {
    setClientErr(null)
    if (f && !DESIGN_EXT.test(f.name)) setClientErr('지원하지 않는 파일 형식입니다 (png jpg jpeg pdf ai svg)')
    else if (f && f.size > DESIGN_MAX) setClientErr('파일이 너무 큽니다 (최대 20MB)')
    setFile(f)
  }
  const started = so.work_orders.some((w) => w.status !== 'DRAFT' && w.status !== 'CANCELLED')
  return (
    <Modal
      open={line !== null}
      title={`도안 업로드 — 라인 #${line?.line_no ?? ''} ${line?.item.name ?? ''}`}
      onClose={onClose}
      dismissible={!upload.loading}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={upload.loading}>
            취소
          </Button>
          <Button
            variant="primary"
            disabled={!file || clientErr !== null}
            loading={upload.loading}
            onClick={async () => {
              if (!line || !file) return
              try {
                onDone(await upload.mutate({ lineId: line.id, f: file }))
              } catch {
                /* upload.error 표시 */
              }
            }}
          >
            업로드 (v{(line?.design?.version ?? 0) + 1})
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {upload.error ? <ApiErrorAlert error={upload.error} /> : null}
        {started ? <ErrorAlert title="착수 후 업로드" message="WO 발행 시점 버전과 달라집니다 — P30 START 에서 WARN (api-contract §5.2)" /> : null}
        <FileDropzone accept={DESIGN_ACCEPT} file={file} onChange={pick} hint="png · jpg · jpeg · pdf · ai · svg, 최대 20MB (admin #25). 썸네일은 png/jpg 만 생성" disabled={upload.loading} />
        {clientErr ? <p role="alert" className="text-ad-xs text-status-error-fg">{clientErr}</p> : null}
        {line?.design ? (
          <p className="text-ad-xs text-ink-muted">
            현재 v{line.design.version} · {formatDateTime(line.design.created_at)} · {line.design.confirmed_at ? `확정 ${formatDateTime(line.design.confirmed_at)}` : '미확정'} — 업로드하면 버전이 +1 되고 확정이 풀린다
          </p>
        ) : null}
      </div>
    </Modal>
  )
}

/* ───────── WO 제안·발행 ───────── */
function ProposalModal({ so, open, drafts, setDrafts, processes, onClose, onIssued }: { so: SalesOrderDetail; open: boolean; drafts: WoDraft[]; setDrafts: (d: WoDraft[]) => void; processes: Process[]; onClose: () => void; onIssued: (r: IssueWoResponse) => void }) {
  const issue = useApiMutation((d: WoDraft[]) => soApi.issueWo(so.id, { drafts: d }))
  const [splitIdx, setSplitIdx] = useState<number | null>(null)
  const [splitQty, setSplitQty] = useState<number>(0)
  const pname = processNameFn(processes)
  const lineOf = (id: number) => so.lines.find((l) => l.id === id)
  const itemName = (d: WoDraft) => lineOf(d.so_line_id)?.item.name ?? `#${d.item_id}`
  const mismatch = draftQtyMismatch(
    drafts,
    so.lines.filter((l) => drafts.some((d) => d.so_line_id === l.id)),
  )
  const notConfirmed = so.lines.filter((l) => drafts.some((d) => d.so_line_id === l.id) && l.print_method !== 'NONE' && !l.design_confirmed)
  const countByLine = (id: number) => drafts.filter((d) => d.so_line_id === id).length
  return (
    <Modal
      open={open}
      title="WO 분할 제안 → 확정·발행"
      onClose={onClose}
      size="lg"
      dismissible={!issue.loading}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={issue.loading}>
            취소
          </Button>
          <Button
            variant="primary"
            disabled={drafts.length === 0 || mismatch.length > 0}
            loading={issue.loading}
            onClick={async () => {
              try {
                onIssued(await issue.mutate(drafts))
              } catch {
                /* issue.error 표시 */
              }
            }}
          >
            확정·발행 ({drafts.length}건)
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {issue.error ? <ApiErrorAlert error={issue.error} /> : null}
        {notConfirmed.length > 0 ? <ErrorAlert title="시안 미확정 라인" message={`라인 #${notConfirmed.map((l) => l.line_no).join(', ')} — 발행 시 409 DESIGN_NOT_CONFIRMED 가 됩니다 (NONE 가공은 면제)`} /> : null}
        {mismatch.length > 0 ? <ErrorAlert title="수량 불일치" message={`라인 ${mismatch.map((id) => `#${lineOf(id)?.line_no ?? id}`).join(', ')} 의 초안 수량 합이 라인 수량과 다릅니다`} /> : null}
        <p className="text-ad-xs text-ink-muted">아직 WO 가 없는 라인만 제안됩니다. 조정은 [분리] 만 (라인 간 병합 불가, admin #26). 인쇄+자수(PRINT_EMB)도 P30 1단계 (plan S1-3)</p>
        <table className="w-full border-collapse text-ad-body">
          <thead className="bg-surface-2 text-ad-xs font-semibold text-ink-muted">
            <tr>
              <th className="px-2 py-2 text-left">라인</th>
              <th className="px-2 py-2 text-left">품목</th>
              <th className="px-2 py-2 text-left">가공방식</th>
              <th className="px-2 py-2 text-right">수량</th>
              <th className="px-2 py-2 text-left">라우팅</th>
              <th className="px-2 py-2 text-left">단계 (표준 h · 허용 %)</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {drafts.map((d, i) => {
              const line = lineOf(d.so_line_id)
              return (
                <tr key={`${d.so_line_id}-${i}`} className="border-t border-line align-top">
                  <td className="px-2 py-2 tabular-nums">#{line?.line_no ?? d.so_line_id}</td>
                  <td className="px-2 py-2">{itemName(d)}</td>
                  <td className="px-2 py-2">{PrintMethodCodeLabel[d.print_method] ?? d.print_method}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {splitIdx === i ? (
                      <div className="flex items-center justify-end gap-1">
                        <NumberInput min={1} max={d.qty - 1} value={splitQty || ''} onChange={(e) => setSplitQty(Number(e.target.value))} wrapperClassName="w-24" aria-label="분리 수량" />
                        <span className="text-ad-xs text-ink-muted">+ {formatQty(d.qty - (splitQty || 0))}</span>
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={!(splitQty >= 1 && splitQty < d.qty)}
                          onClick={() => {
                            setDrafts(splitDraft(drafts, i, splitQty))
                            setSplitIdx(null)
                          }}
                        >
                          적용
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setSplitIdx(null)}>
                          취소
                        </Button>
                      </div>
                    ) : (
                      formatQty(d.qty)
                    )}
                  </td>
                  <td className="px-2 py-2 tabular-nums">#{d.routing_id}</td>
                  <td className="px-2 py-2 text-ad-xs">
                    {d.steps
                      .slice()
                      .sort((a, b) => a.seq - b.seq)
                      .map((s) => `${s.process_code}${pname(s.process_code) ? ` ${pname(s.process_code)}` : ''} (${s.std_lead_hours}h${s.tolerance_pct !== undefined && s.tolerance_pct !== null ? ` · ±${s.tolerance_pct}%` : ''})`)
                      .join(' → ')}
                  </td>
                  <td className="px-2 py-2">
                    <RowActions>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={d.qty < 2 || issue.loading}
                        onClick={() => {
                          setSplitIdx(i)
                          setSplitQty(Math.floor(d.qty / 2))
                        }}
                      >
                        분리
                      </Button>
                      {countByLine(d.so_line_id) > 1 ? (
                        <Button size="sm" variant="ghost" disabled={issue.loading} onClick={() => setDrafts(mergeDraftsOfLine(drafts, d.so_line_id))}>
                          분리 취소
                        </Button>
                      ) : null}
                    </RowActions>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}

function IssuedModal({ result, onClose }: { result: IssueWoResponse | null; onClose: () => void }) {
  const dl = useApiMutation((url: string) => pdfApi.byUrl(url, 'work-orders.pdf'))
  return (
    <Modal
      open={result !== null}
      title={`WO ${result?.work_orders.length ?? 0}건 발행`}
      onClose={onClose}
      footer={
        <>
          {result?.pdf_url ? (
            <Button variant="secondary" loading={dl.loading} onClick={() => void dl.mutate(result.pdf_url).catch(() => undefined)}>
              작업지시서 PDF
            </Button>
          ) : null}
          <Button variant="primary" onClick={onClose}>
            닫기
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {dl.error ? <ApiErrorAlert error={dl.error} onRetry={() => result && void dl.mutate(result.pdf_url).catch(() => undefined)} /> : null}
        <ul className="space-y-1">
          {result?.work_orders.map((w) => (
            <li key={w.id} className="flex items-center gap-2">
              <Link to={`/admin/wo/${encodeURIComponent(w.code)}`} className="text-brand-700 hover:underline">
                <CodeText code={w.code} />
              </Link>
              <span className="text-ad-xs text-ink-muted">
                {w.item.name} · {formatQty(w.qty_ordered)}
              </span>
              <StatusBadge kind="wo" status={w.status} />
            </li>
          ))}
        </ul>
        {result?.pdf_url ? <p className="text-ad-xs text-ink-muted">pdf_url: <span className="font-mono break-all">{result.pdf_url}</span></p> : null}
      </div>
    </Modal>
  )
}

function CancelResultModal({ result, onClose }: { result: SoCancelResponse | null; onClose: () => void }) {
  return (
    <Modal open={result !== null} title="수주 취소 결과" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>닫기</Button>}>
      {result ? (
        <div className="space-y-3">
          <DescriptionList cols={2} dense items={[{ label: '수주', value: <CodeText code={result.so.code} /> }, { label: '상태', value: <StatusBadge kind="so" status={result.so.status} /> }]} />
          <div>
            <div className="text-ad-xs font-semibold text-ink-muted">취소된 WO ({result.cancelled_wo.length})</div>
            {result.cancelled_wo.length ? <p className="font-mono text-ad-xs">{result.cancelled_wo.join(', ')}</p> : <p className="text-ad-xs text-ink-faint">없음</p>}
          </div>
          {result.pending_wo.length > 0 ? (
            <div>
              <ErrorAlert title="착수된 WO" message="다음 WO 는 착수되어 반장이 개별 취소해야 합니다 (WO 상세 [취소])" />
              <ul className="mt-2 space-y-1">
                {result.pending_wo.map((w) => (
                  <li key={w.id}>
                    <Link to={`/admin/wo/${encodeURIComponent(w.code)}`} className="text-brand-700 hover:underline">
                      <CodeText code={w.code} />
                    </Link>{' '}
                    <StatusBadge kind="wo" status={w.status} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  )
}

/* ───────── 페이지 ───────── */
type Tab = 'lines' | 'wo'

function Detail({ so, refetch }: { so: SalesOrderDetail; refetch: () => Promise<void> }) {
  const { role } = useAuth()
  const write = canWrite(role, 'so')
  const toast = useToast()
  const navigate = useNavigate()
  const [sp, setSp] = useSearchParams()
  const tab: Tab = sp.get('tab') === 'wo' ? 'wo' : 'lines'
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
  const [uploading, setUploading] = useState<SalesOrderLine | null>(null)
  const [confirming, setConfirming] = useState<SalesOrderLine | null>(null)
  const confirm = useApiMutation((lineId: number) => soApi.confirmDesign(so.id, lineId))
  const propose = useApiMutation(() => soApi.proposeWo(so.id))
  const [drafts, setDrafts] = useState<WoDraft[]>([])
  const [proposalOpen, setProposalOpen] = useState(false)
  const [issued, setIssued] = useState<IssueWoResponse | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const cancel = useApiMutation((reason: string) => soApi.cancel(so.id, reason))
  const [cancelResult, setCancelResult] = useState<SoCancelResponse | null>(null)
  const pdf = useApiMutation(() => pdfApi.salesOrder(so.code))

  const cancellable = so.status !== 'CANCELLED' && so.status !== 'CLOSED' && so.status !== 'SHIPPED'
  const editable = so.status !== 'CANCELLED' && so.status !== 'CLOSED'
  const linesWithoutWo = useMemo(() => so.lines.filter((l) => !so.work_orders.some((w) => w.status !== 'CANCELLED' && w.item.id === l.item.id && w.print_method === l.print_method)), [so])
  const woCols = useMemo(() => woColumns(processNameFn(processes.data), { withSo: false }), [processes.data])

  const doPropose = async () => {
    try {
      const p = await propose.mutate(undefined)
      setDrafts(p.items)
      setProposalOpen(true)
    } catch {
      /* propose.error 표시 */
    }
  }

  const lineCols: Column<SalesOrderLine>[] = [
    { key: 'line_no', header: '#', render: (r) => <span className="tabular-nums">{r.line_no}</span> },
    {
      key: 'item',
      header: '품목',
      render: (r) => (
        <span>
          <CodeText code={r.item.code} /> {r.item.name}
          <span className="ml-1 text-ad-xs text-ink-muted">{[r.item.spec, r.item.color].filter(Boolean).join(' · ')}</span>
        </span>
      ),
    },
    { key: 'print_method', header: '가공방식', render: (r) => PrintMethodCodeLabel[r.print_method] ?? r.print_method },
    { key: 'qty', header: '수량', align: 'right', render: (r) => <span className="tabular-nums">{formatQty(r.qty)}</span> },
    { key: 'unit_price', header: '단가', align: 'right', render: (r) => <span className="tabular-nums">{formatMoney(r.unit_price)}</span> },
    {
      key: 'design',
      header: '도안',
      render: (r) =>
        r.design ? (
          <span className="inline-flex items-center gap-2">
            {r.design.thumbnail_url ? (
              <a href={r.design.file_url} target="_blank" rel="noopener noreferrer">
                <AuthImage src={r.design.thumbnail_url} alt={`도안 v${r.design.version}`} width={40} height={40} className="rounded-ad border border-line object-cover" />
              </a>
            ) : (
              <a href={r.design.file_url} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">
                파일
              </a>
            )}
            <span className="text-ad-xs">
              v{r.design.version}
              <br />
              {r.design.confirmed_at ? `확정 ${formatDateTime(r.design.confirmed_at)}` : `업로드 ${formatDateTime(r.design.created_at)}`}
            </span>
          </span>
        ) : r.print_method === 'NONE' ? (
          <span className="text-ad-xs text-ink-muted">불필요 (NONE)</span>
        ) : (
          <span className="text-ink-faint">—</span>
        ),
    },
    {
      key: 'design_confirmed',
      header: '시안 확정',
      render: (r) => (r.print_method === 'NONE' ? <StatusBadge kind="active" status={true} labelOverride="면제" /> : r.design_confirmed ? <StatusBadge kind="step" status="DONE" labelOverride="확정" /> : <StatusBadge kind="step" status="WAITING" labelOverride="미확정" />),
    },
    {
      key: '_actions',
      header: '',
      render: (r) =>
        write && editable ? (
          <RowActions>
            <Button size="sm" variant="secondary" onClick={() => setUploading(r)}>
              도안 업로드
            </Button>
            <Button size="sm" variant="primary" disabled={r.print_method === 'NONE' || !r.design || r.design_confirmed} onClick={() => setConfirming(r)}>
              시안 확정
            </Button>
          </RowActions>
        ) : null,
    },
  ]

  return (
    <>
      <PageHeader
        title={`수주 ${so.code}`}
        breadcrumb={
          <>
            <Link to="/admin/so" className="hover:underline">
              수주
            </Link>{' '}
            › 상세 (ADM-14)
          </>
        }
        actions={
          <>
            <Button disabled={!write || !editable} onClick={() => navigate(`/admin/so/${encodeURIComponent(so.code)}/edit`)}>
              수정
            </Button>
            <Button disabled={so.wo_count === 0} loading={pdf.loading} onClick={() => void pdf.mutate(undefined).catch(() => undefined)} title={so.wo_count === 0 ? '발행 후 활성' : ''}>
              작업지시서 PDF
            </Button>
            <Button variant="danger" disabled={!write || !cancellable} onClick={() => setCancelOpen(true)}>
              수주 취소
            </Button>
            <Link to={`/admin/system/audit?table_name=sales_order&row_id=${so.id}`} className="text-ad-xs text-brand-700 hover:underline">
              변경 이력
            </Link>
          </>
        }
      />
      {pdf.error ? <ApiErrorAlert error={pdf.error} onRetry={() => void pdf.mutate(undefined).catch(() => undefined)} className="mb-3" /> : null}
      <section className="mb-4 rounded-ad border border-line bg-surface p-4">
        <DescriptionList
          cols={4}
          items={[
            { label: '수주번호', value: <CodeText code={so.code} copy /> },
            { label: '거래처', value: so.customer.name ?? so.customer.code },
            { label: '수주일', value: formatDate(so.order_date) },
            { label: '납기일', value: <span className={isOverdue(so.due_date, so.status) ? 'font-semibold text-status-error-fg' : ''}>{formatDate(so.due_date)}</span> },
            {
              label: '상태',
              value: (
                <span className="inline-flex items-center gap-2">
                  <StatusBadge kind="so" status={so.status} />
                  {so.delay_risk ? <StatusBadge kind="delay" status={true} /> : null}
                </span>
              ),
            },
            { label: '진행률', value: <ProgressBar value={so.progress_pct} size="md" /> },
            { label: '현재 공정', value: so.current_processes.length ? so.current_processes.join(', ') : '—' },
            { label: '완료 예상', value: formatDateTime(so.est_complete_at) },
            { label: '확정(첫 WO 발행)', value: formatDateTime(so.confirmed_at) },
            { label: '발송', value: formatDateTime(so.shipped_at) },
            { label: '라인 / WO', value: `${so.line_count} / ${so.wo_count}` },
            { label: '등록', value: `${so.created_by.name} · ${formatDateTime(so.created_at)}` },
            { label: '배송지', value: [so.ship_to.receiver, so.ship_to.phone, so.ship_to.postal_code, so.ship_to.address1, so.ship_to.address2].filter(Boolean).join(' '), span: true },
            { label: '비고', value: so.memo, span: true },
          ]}
        />
      </section>
      <Tabs<Tab>
        tabs={[
          { key: 'lines', label: '라인 · 도안', badge: so.lines.length },
          { key: 'wo', label: '작업지시 (WO)', badge: so.work_orders.length },
        ]}
        value={tab}
        onChange={setTab}
      >
        {tab === 'lines' ? (
          <DataTable<SalesOrderLine> columns={lineCols} rows={so.lines} rowKey={(r) => r.id} pageSize={0} emptyText="라인이 없습니다" />
        ) : (
          <div className="space-y-3">
            {propose.error ? (
              <div className="space-y-1">
                <ApiErrorAlert error={propose.error} />
                {propose.error.code === 'ROUTING_NOT_FOUND' ? (
                  <p className="text-ad-xs">
                    품목군×가공방식 라우팅이 없습니다 →{' '}
                    <Link to="/admin/master/routings" className="text-brand-700 hover:underline">
                      ADM-06 라우팅 등록
                    </Link>
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="flex items-center justify-between">
              <p className="text-ad-xs text-ink-muted">{linesWithoutWo.length > 0 ? `WO 가 없는 라인 ${linesWithoutWo.length}건 — 제안 대상` : '모든 라인에 WO 가 있습니다'}</p>
              <Button variant="primary" disabled={!write || !editable || so.lines.length === 0} loading={propose.loading} onClick={() => void doPropose()}>
                WO 분할 제안
              </Button>
            </div>
            <DataTable<WorkOrderSummary> columns={woCols} rows={so.work_orders} rowKey={(r) => r.id} pageSize={0} emptyText="발행된 WO 가 없습니다" onRowClick={(r) => navigate(`/admin/wo/${encodeURIComponent(r.code)}`)} />
          </div>
        )}
      </Tabs>

      <DesignUploadModal
        so={so}
        line={uploading}
        onClose={() => setUploading(null)}
        onDone={(d) => {
          setUploading(null)
          toast.success(`도안 v${d.version} 업로드`)
          void refetch()
        }}
      />
      <ConfirmDialog
        open={confirming !== null}
        title={`시안 확정 — 라인 #${confirming?.line_no ?? ''}`}
        confirmLabel="확정"
        loading={confirm.loading}
        error={confirm.error}
        onClose={() => setConfirming(null)}
        onConfirm={async () => {
          if (!confirming) return
          try {
            await confirm.mutate(confirming.id)
            toast.success('시안이 확정되었습니다')
            setConfirming(null)
            void refetch()
          } catch {
            /* confirm.error 표시 */
          }
        }}
      >
        <p>
          {confirming?.item.name} 도안 v{confirming?.design?.version ?? '—'} 을(를) 확정합니다. 확정 후 WO 발행이 가능합니다.
        </p>
      </ConfirmDialog>
      <ProposalModal
        so={so}
        open={proposalOpen}
        drafts={drafts}
        setDrafts={setDrafts}
        processes={processes.data ?? []}
        onClose={() => setProposalOpen(false)}
        onIssued={(r) => {
          setProposalOpen(false)
          setIssued(r)
          toast.success(`WO ${r.work_orders.length}건 발행`)
          void refetch()
        }}
      />
      <IssuedModal result={issued} onClose={() => setIssued(null)} />
      <ReasonDialog
        open={cancelOpen}
        title={`수주 취소 — ${so.code}`}
        danger
        confirmLabel="수주 취소"
        loading={cancel.loading}
        error={cancel.error}
        onClose={() => setCancelOpen(false)}
        onConfirm={async (reason) => {
          try {
            const r = await cancel.mutate(reason)
            setCancelOpen(false)
            setCancelResult(r)
            void refetch()
          } catch {
            /* cancel.error 표시 */
          }
        }}
      >
        <p>미착수 WO 는 취소되고, 착수한 WO 는 반장이 개별 취소해야 합니다 (A2-06).</p>
      </ReasonDialog>
      <CancelResultModal result={cancelResult} onClose={() => setCancelResult(null)} />
    </>
  )
}

export function SalesOrderDetailPage() {
  const { code = '' } = useParams<{ code: string }>()
  const so = useApiQuery<SalesOrderDetail>(['res', 'so', 'one', code], () => soApi.get(code), code !== '')
  if (so.error instanceof ApiError && so.error.status === 404) {
    return (
      <>
        <PageHeader title={`수주 ${code}`} breadcrumb="수주 › 상세 (ADM-14)" />
        <ErrorAlert title="찾을 수 없습니다" message={so.error.message} />
        <Link to="/admin/so" className="mt-3 inline-block text-brand-700 hover:underline">
          ← 수주 목록
        </Link>
      </>
    )
  }
  // 액션 후 refetch 중에도 상세(모달 상태 포함)를 유지한다 — 첫 로딩만 Spinner
  if (so.data) return <Detail so={so.data} refetch={so.refetch} />
  if (so.error) return <ApiErrorAlert error={so.error} onRetry={() => void so.refetch()} />
  return (
    <div className="flex justify-center py-12">
      <Spinner label="불러오는 중…" />
    </div>
  )
}

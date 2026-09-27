/**
 * ADM-09 라벨 양식 · 프린터 (A1-09) — [S1]
 * 탭 1 프린터: GET /printers(배열) · POST · PATCH · deactivate/activate · POST /printers/{id}/test (LabelJob zpl_sent/error, 503 재시도)
 * 탭 2 라벨 양식: label_type 4종 서브탭 · GET/PUT /label-templates/{type} · POST …/preview (ZPL 텍스트) · placeholders 칩 삽입 (admin #18)
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, DataTable, DescriptionList, ErrorAlert, Input, Modal, NumberInput, PageHeader, Select, Spinner, Tabs, useToast, type Column } from '@/shared/ui/admin'
import { useApiMutation, useApiQuery, useArray, useAuth, useCreate, useUpdate } from '@/shared/hooks'
import { ApiError, fieldErrorsOf, labelTemplatesApi, printersApi, type PrinterTestResult } from '@/shared/api'
import type { LabelTemplate, LabelType, Printer, PrinterCreate, PrinterUpdate } from '@/shared/types'
import { LabelTypeLabel, PrinterPurposeLabel } from '@/shared/labels'
import { formatDateTime } from '../../format'
import { canWrite } from '../../permissions'
import { ActiveBadge, ApiErrorAlert, CodeText, QueryState, RowActions, Textarea, ToggleActiveDialog, numOrUndef, upperCode, useFormApiError, zx } from '../../components'

/* ───────────────────────── 탭 1 프린터 ───────────────────────── */

const PURPOSES = ['PRODUCTION', 'PACKING'] as const
const printerSchema = z.object({
  id: zx.req(20, '프린터 ID').regex(/^[A-Z0-9][A-Z0-9_-]*$/, '영문 대문자·숫자·_·- 만'),
  name: zx.req(50, '이름'),
  host: zx.req(100, '호스트'),
  port: zx.int(1, 65535),
  purpose: z.enum(PURPOSES, { error: '용도를 선택하세요' }),
  location: zx.opt(100),
})
type PrinterForm = z.infer<typeof printerSchema>
const PRINTER_FIELDS = Object.keys(printerSchema.shape)
const PRINTER_EMPTY: PrinterForm = { id: '', name: '', host: '', port: 9100, purpose: 'PRODUCTION', location: '' }
const PURPOSE_OPTIONS = PURPOSES.map((p) => ({ value: p, label: `${p} ${PrinterPurposeLabel[p]}` }))

function PrinterFormModal({ open, initial, onClose, onSaved }: { open: boolean; initial: Printer | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = initial !== null
  const create = useCreate<Printer, PrinterCreate>('printers')
  const update = useUpdate<Printer, PrinterUpdate>('printers')
  const toForm = (p: Printer): PrinterForm => ({ id: p.id, name: p.name, host: p.host, port: p.port, purpose: p.purpose, location: p.location ?? '' })
  const { register, handleSubmit, reset, setError, formState } = useForm<PrinterForm>({ resolver: zodResolver(printerSchema), defaultValues: initial ? toForm(initial) : PRINTER_EMPTY })
  const { topError, apply, clear } = useFormApiError<PrinterForm>(setError, PRINTER_FIELDS, 'id')
  useEffect(() => {
    if (open) {
      reset(initial ? toForm(initial) : PRINTER_EMPTY)
      clear()
    }
  }, [open, initial, reset, clear])
  const busy = create.loading || update.loading
  const onSubmit = handleSubmit(async (v) => {
    clear()
    try {
      if (isEdit) {
        const body: PrinterUpdate = {}
        const d = formState.dirtyFields
        if (d.name) body.name = v.name
        if (d.host) body.host = v.host
        if (d.port) body.port = v.port
        if (d.purpose) body.purpose = v.purpose
        if (d.location) body.location = v.location || null
        await update.mutate({ id: initial.id, body })
      } else {
        const body: PrinterCreate = { id: v.id, name: v.name, host: v.host, port: v.port, purpose: v.purpose }
        if (v.location) body.location = v.location
        await create.mutate(body)
      }
      onSaved()
    } catch (e) {
      apply(e)
    }
  })
  const err = formState.errors
  return (
    <Modal
      open={open}
      title={isEdit ? `프린터 수정 — ${initial.id}` : '프린터 등록'}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button variant="primary" onClick={() => void onSubmit()} loading={busy}>
            저장
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2" noValidate>
        {topError ? (
          <div className="md:col-span-2">
            <ApiErrorAlert error={topError} />
          </div>
        ) : null}
        <Input label="프린터 ID" required maxLength={20} readOnly={isEdit} className="uppercase" placeholder="예 LP-PACK-1" hint={isEdit ? '수정 불가' : '대문자로 저장 (D28)'} error={err.id?.message} {...register('id', { setValueAs: upperCode })} />
        <Input label="이름" required maxLength={50} error={err.name?.message} {...register('name')} />
        <Input label="호스트" required maxLength={100} placeholder="IP 또는 호스트명" error={err.host?.message} {...register('host')} />
        <NumberInput label="포트" required min={1} max={65535} hint="TCP 9100 (api-contract §9)" error={err.port?.message} {...register('port', { setValueAs: numOrUndef })} />
        <Select label="용도" required options={PURPOSE_OPTIONS} hint="PRODUCTION = 인쇄 구역, QR 오류정정 Q (spec §6)" error={err.purpose?.message} {...register('purpose')} />
        <Input label="위치" maxLength={100} error={err.location?.message} {...register('location')} />
        <button type="submit" className="hidden" aria-hidden="true" />
      </form>
    </Modal>
  )
}

/** 테스트 출력 결과 — 200 이라도 zpl_sent=false / error 는 실패로 드러낸다 (조용한 실패 금지) */
function TestResultModal({ target, job, error, loading, onRetry, onClose }: { target: Printer | null; job: PrinterTestResult | null; error: unknown; loading: boolean; onRetry: () => void; onClose: () => void }) {
  return (
    <Modal open={target !== null} title={`테스트 출력 — ${target?.id ?? ''}`} onClose={onClose} size="sm" dismissible={!loading} footer={<Button onClick={onClose}>닫기</Button>}>
      {loading ? (
        <div className="flex justify-center py-6">
          <Spinner label="전송 중… (3초 타임아웃)" />
        </div>
      ) : error ? (
        <ApiErrorAlert error={error} onRetry={onRetry} />
      ) : job ? (
        job.zpl_sent && !job.error ? (
          <div className="space-y-2">
            <p className="font-semibold text-status-done-fg">테스트 라벨을 보냈습니다</p>
            <DescriptionList cols={2} dense items={[{ label: '프린터', value: <CodeText code={job.printer_id} /> }, { label: '호스트', value: <span className="font-mono">{job.host}:{job.port}</span> }, { label: '전송 시각', value: formatDateTime(job.sent_at) }]} />
            <details>
              <summary className="cursor-pointer text-ad-xs text-brand-700">보낸 ZPL</summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-ad bg-surface-2 p-2 font-mono text-ad-xs">{job.zpl}</pre>
            </details>
          </div>
        ) : (
          <div className="space-y-2">
            <ErrorAlert title="전송 실패 (HTTP 200 · zpl_sent=false)" message={`${job.error ?? 'ZPL 미전송'} — ${job.host}:${job.port}. 재시도 큐 없음, 다시 누른다`} onRetry={onRetry} />
            <details>
              <summary className="cursor-pointer text-ad-xs text-brand-700">보내려던 ZPL</summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-ad bg-surface-2 p-2 font-mono text-ad-xs">{job.zpl}</pre>
            </details>
          </div>
        )
      ) : null}
    </Modal>
  )
}

function PrintersTab({ write }: { write: boolean }) {
  const toast = useToast()
  const list = useArray<Printer>('printers')
  const test = useApiMutation((id: string) => printersApi.test(id))
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Printer | null>(null)
  const [toggling, setToggling] = useState<Printer | null>(null)
  const [testing, setTesting] = useState<Printer | null>(null)
  const [job, setJob] = useState<PrinterTestResult | null>(null)

  const runTest = async (p: Printer) => {
    setTesting(p)
    setJob(null)
    test.reset()
    try {
      const r = await test.mutate(p.id)
      setJob(r)
      if (r.zpl_sent && !r.error) toast.success('테스트 라벨을 보냈습니다')
    } catch {
      /* test.error 를 모달에 표시 */
    }
  }

  const columns: Column<Printer>[] = [
    { key: 'id', header: '프린터 ID', render: (r) => <CodeText code={r.id} className={r.active ? '' : 'text-ink-faint'} /> },
    { key: 'name', header: '이름' },
    { key: 'host', header: '호스트', render: (r) => <span className="font-mono">{r.host}</span> },
    { key: 'port', header: '포트', align: 'right', render: (r) => <span className="tabular-nums">{r.port}</span> },
    { key: 'purpose', header: '용도', render: (r) => `${r.purpose} ${PrinterPurposeLabel[r.purpose]}` },
    { key: 'location', header: '위치' },
    { key: 'active', header: '활성', render: (r) => <ActiveBadge active={r.active} /> },
    {
      key: '_actions',
      header: '',
      render: (r) => (
        <RowActions>
          <Button size="sm" variant="secondary" disabled={!write || !r.active} onClick={() => void runTest(r)}>
            테스트 출력
          </Button>
          {write ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(r)
                  setFormOpen(true)
                }}
              >
                수정
              </Button>
              <Button size="sm" variant={r.active ? 'danger' : 'secondary'} onClick={() => setToggling(r)}>
                {r.active ? '비활성' : '재활성'}
              </Button>
            </>
          ) : null}
        </RowActions>
      ),
    },
  ]

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button
          variant="primary"
          disabled={!write}
          onClick={() => {
            setEditing(null)
            setFormOpen(true)
          }}
        >
          프린터 등록
        </Button>
      </div>
      <DataTable<Printer>
        columns={columns}
        rows={list.data ?? []}
        rowKey={(r) => r.id}
        loading={list.loading}
        error={list.error ? <ApiErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : undefined}
        emptyText="등록된 프린터가 없습니다"
        pageSize={0}
      />
      <p className="mt-2 text-ad-xs text-ink-muted">전송은 TCP host:port, 3초 타임아웃. 실패하면 503 PRINTER_UNREACHABLE — 재시도 큐 없음, 다시 누른다 (api-contract §9)</p>
      <PrinterFormModal
        open={formOpen}
        initial={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false)
          toast.success('저장되었습니다')
          void list.refetch()
        }}
      />
      <ToggleActiveDialog<Printer>
        resource="printers"
        entityLabel="프린터"
        target={toggling}
        idOf={(r) => r.id}
        describe={(r) => (
          <>
            <CodeText code={r.id} /> {r.name}
          </>
        )}
        onClose={() => setToggling(null)}
        onDone={() => void list.refetch()}
      />
      <TestResultModal target={testing} job={job} error={test.error} loading={test.loading} onRetry={() => testing && void runTest(testing)} onClose={() => setTesting(null)} />
    </>
  )
}

/* ───────────────────────── 탭 2 라벨 양식 ───────────────────────── */

const LABEL_TYPES: readonly LabelType[] = ['WORK_ORDER_PDF', 'WO_LABEL', 'BOX_LABEL', 'WORKER_CARD']
const SPEC_HINT: Record<LabelType, string> = {
  WORK_ORDER_PDF: 'A4. 표지 SO QR 30×30 mm + 거래처·납기·WO 목록, 본문 WO 당 1페이지 (WO QR 30×30, 품목·규격·색상·가공방식·수량·도안 썸네일·라우팅 표·발행 차수)',
  WO_LABEL: '4인치. QR 최소 20×20 mm. 인쇄 구역 프린터(PRODUCTION)는 오류정정 Q (^BQN,2,{mag},Q)',
  BOX_LABEL: 'LT QR 20×20 mm 이상, 거래처명, 품목명·규격·색상, 입수, WO 코드, 박스 no/총수(인쇄 시점 누계)',
  WORKER_CARD: 'US QR + 이름 + 역할',
}

function TemplateEditor({ template, write, onSaved }: { template: LabelTemplate; write: boolean; onSaved: () => void }) {
  const toast = useToast()
  const [body, setBody] = useState(template.body)
  const [bodyError, setBodyError] = useState<string | null>(null)
  const [topError, setTopError] = useState<unknown>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [previewTarget, setPreviewTarget] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)
  const save = useApiMutation((b: string) => labelTemplatesApi.put(template.label_type, { body: b }))
  const previewMut = useApiMutation((target: string) => labelTemplatesApi.preview(template.label_type, target ? { target } : {}))
  useEffect(() => {
    setBody(template.body)
    setBodyError(null)
    setTopError(null)
    setPreview(null)
  }, [template])
  const dirty = body !== template.body

  const insertPlaceholder = (name: string) => {
    const ta = taRef.current
    const token = `{{ ${name} }}`
    if (!ta) {
      setBody((b) => b + token)
      return
    }
    const start = ta.selectionStart ?? body.length
    const end = ta.selectionEnd ?? body.length
    const next = body.slice(0, start) + token + body.slice(end)
    setBody(next)
    window.requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const applyError = (e: unknown) => {
    if (e instanceof ApiError && e.status === 422) {
      const fes = fieldErrorsOf(e)
      const bodyMsgs = fes.filter((f) => f.field === null || f.field === 'body').map((f) => f.msg)
      const extra = e.detail
        .map((d) => (d as { missing?: unknown; columns?: unknown }).missing ?? (d as { columns?: unknown }).columns)
        .filter((v): v is string[] => Array.isArray(v))
        .flat()
      const msg = [e.code === 'BAD_TEMPLATE' ? e.message : null, ...bodyMsgs, extra.length ? `누락: ${extra.join(', ')}` : null].filter(Boolean).join(' · ')
      setBodyError(msg || e.message)
      setTopError(bodyMsgs.length === 0 && e.code !== 'BAD_TEMPLATE' ? e : null)
      return
    }
    setTopError(e)
  }

  const doPreview = async () => {
    setTopError(null)
    setBodyError(null)
    try {
      const r = await previewMut.mutate(previewTarget.trim().toUpperCase())
      setPreview(r.body)
    } catch (e) {
      applyError(e)
    }
  }
  const doSave = async () => {
    setTopError(null)
    setBodyError(null)
    try {
      await save.mutate(body)
      toast.success('저장되었습니다')
      onSaved()
    } catch (e) {
      applyError(e)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        {topError ? <ApiErrorAlert error={topError} /> : null}
        <DescriptionList
          cols={4}
          dense
          items={[
            { label: '형식', value: <span className="font-mono">{template.format}</span> },
            { label: '버전', value: template.version },
            { label: '수정', value: formatDateTime(template.updated_at) },
            { label: '수정자', value: template.updated_by?.name ?? '—' },
          ]}
        />
        <p className="text-ad-xs text-ink-muted">규격: {SPEC_HINT[template.label_type]}</p>
        <div>
          <div className="mb-1 text-ad-xs font-semibold text-ink-muted">플레이스홀더 (클릭하면 커서 위치에 삽입 — Jinja2 변수, admin #18)</div>
          {template.placeholders.length === 0 ? (
            <p className="text-ad-xs text-ink-faint">서버가 내려준 플레이스홀더가 없습니다</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {template.placeholders.map((p) => (
                <Button key={p} size="sm" variant="secondary" disabled={!write} onClick={() => insertPlaceholder(p)} className="font-mono">
                  {p}
                </Button>
              ))}
            </div>
          )}
        </div>
        <Textarea
          ref={taRef}
          label={`본문 (${template.format})`}
          mono
          rows={22}
          spellCheck={false}
          readOnly={!write}
          value={body}
          onChange={(e) => {
            setBody(e.target.value)
            setBodyError(null)
          }}
          error={bodyError ?? undefined}
          hint={dirty ? '저장되지 않은 변경이 있습니다' : undefined}
          className="min-h-[28rem]"
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="ghost"
            disabled={!dirty || save.loading}
            onClick={() => {
              setBody(template.body)
              setBodyError(null)
            }}
          >
            되돌리기
          </Button>
          <Input value={previewTarget} onChange={(e) => setPreviewTarget(e.target.value)} placeholder="대상 코드 (선택, 예 WO-…)" wrapperClassName="w-56" className="font-mono uppercase" aria-label="미리보기 대상 코드" />
          <Button variant="secondary" onClick={() => void doPreview()} loading={previewMut.loading} title={dirty ? '저장된 버전을 렌더한다 — 편집 중 내용은 먼저 저장' : ''}>
            미리보기{dirty ? ' (저장본)' : ''}
          </Button>
          <Button variant="primary" disabled={!write || !dirty} onClick={() => void doSave()} loading={save.loading}>
            저장
          </Button>
        </div>
      </div>
      <div className="flex min-h-64 flex-col rounded-ad border border-line bg-surface-2">
        <div className="border-b border-line px-3 py-2 text-ad-xs font-semibold text-ink-muted">미리보기 — 저장된 v{template.version} 을 예시값(또는 대상 코드 실데이터)으로 렌더한 {template.format} 텍스트 (이미지 렌더 없음, api-contract §11-7)</div>
        {previewMut.loading ? (
          <div className="flex flex-1 items-center justify-center py-8">
            <Spinner label="렌더 중…" />
          </div>
        ) : preview === null ? (
          <p className="flex-1 px-3 py-8 text-center text-ink-faint">[미리보기] 를 누르면 서버가 렌더한 텍스트가 여기에 표시됩니다</p>
        ) : (
          <pre className="flex-1 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-ad-xs">{preview}</pre>
        )}
      </div>
    </div>
  )
}

function TemplatesTab({ write }: { write: boolean }) {
  const [sp, setSp] = useSearchParams()
  const typeRaw = sp.get('type')
  const labelType: LabelType = (LABEL_TYPES as readonly string[]).includes(typeRaw ?? '') ? (typeRaw as LabelType) : 'WORK_ORDER_PDF'
  const tpl = useApiQuery<LabelTemplate>(['label-templates', labelType], () => labelTemplatesApi.get(labelType))
  const tabs = useMemo(() => LABEL_TYPES.map((t) => ({ key: t, label: LabelTypeLabel[t] })), [])
  return (
    <Tabs
      tabs={tabs}
      value={labelType}
      onChange={(t) =>
        setSp(
          (prev) => {
            const n = new URLSearchParams(prev)
            n.set('type', t)
            return n
          },
          { replace: true },
        )
      }
    >
      <QueryState state={tpl}>{(t) => <TemplateEditor template={t} write={write} onSaved={() => void tpl.refetch()} />}</QueryState>
    </Tabs>
  )
}

/* ───────────────────────── 페이지 ───────────────────────── */

type Tab = 'printers' | 'templates'

export function LabelsPage() {
  const { role } = useAuth()
  const write = canWrite(role, 'master.labels')
  const [sp, setSp] = useSearchParams()
  const tab: Tab = sp.get('tab') === 'templates' ? 'templates' : 'printers'
  return (
    <>
      <PageHeader title="라벨 양식 · 프린터" breadcrumb="기준정보 › 라벨양식·프린터 (ADM-09)" description="라벨 프린터 등록·테스트 출력, 라벨 4종(작업지시서 A4·WO 라벨·박스 라벨·작업자 카드) 템플릿 편집·미리보기" />
      <Tabs<Tab>
        tabs={[
          { key: 'printers', label: '프린터' },
          { key: 'templates', label: '라벨 양식' },
        ]}
        value={tab}
        onChange={(t) =>
          setSp(
            (prev) => {
              const n = new URLSearchParams(prev)
              n.set('tab', t)
              return n
            },
            { replace: true },
          )
        }
      >
        {tab === 'printers' ? <PrintersTab write={write} /> : <TemplatesTab write={write} />}
      </Tabs>
    </>
  )
}

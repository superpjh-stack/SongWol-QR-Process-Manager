/** ADM-07 단말 — 목록·등록(API key 1회 표시 + 등록 QR URL)·수정·키 회전·비활성·재활성 */
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, DataTable, Input, Modal, PageHeader, Select, useToast, type Column } from '@/shared/ui/admin'
import { useApiMutation, useArray, useAuth, useList, useUpdate } from '@/shared/hooks'
import { stationsApi } from '@/shared/api'
import { STATION_TYPES, type Process, type Station, type StationCreate, type StationCreated, type StationKeyRotated, type StationUpdate } from '@/shared/types'
import { StationTypeLabel } from '@/shared/labels'
import { formatDateTime, relativeTime } from '../../format'
import { canWrite } from '../../permissions'
import { ActiveBadge, ApiErrorAlert, CodeText, ConfirmDialog, ListToolbar, RowActions, SecretReveal, ToggleActiveDialog, serverTable, useFormApiError, useListParams, zx } from '../../components'

const PROCESS_REQUIRED: readonly string[] = ['KIOSK', 'PDA', 'TOUCHPC']
const schema = z
  .object({
    id: zx.req(20, '단말 ID'),
    type: z.enum(STATION_TYPES, { error: '유형을 선택하세요' }),
    process_code: z.string(),
    location: zx.opt(100),
    printer_id: zx.opt(20),
  })
  .refine((v) => !PROCESS_REQUIRED.includes(v.type) || v.process_code !== '', { path: ['process_code'], message: '키오스크·PDA·터치PC 는 고정 공정코드가 필요합니다 (A1-07)' })
type Form = z.infer<typeof schema>
const FIELDS = Object.keys(schema.shape)
const EMPTY: Form = { id: '', type: 'KIOSK', process_code: '', location: '', printer_id: '' }
const TYPE_OPTIONS = STATION_TYPES.map((t) => ({ value: t, label: `${t} ${StationTypeLabel[t]}` }))

type Secret = { title: string; stationId: string } & StationKeyRotated

function SecretModal({ secret, onClose }: { secret: Secret | null; onClose: () => void }) {
  return (
    <Modal
      open={secret !== null}
      title={secret?.title ?? ''}
      onClose={onClose}
      dismissible={false}
      footer={
        <Button variant="primary" onClick={onClose}>
          닫기 (다시 볼 수 없음)
        </Button>
      }
    >
      {secret ? (
        <div className="space-y-4">
          <SecretReveal label={`단말 ${secret.stationId} API key`} value={secret.api_key} />
          <div>
            <div className="mb-1 text-ad-xs font-semibold text-ink-muted">단말 등록 QR (스캐너·카메라로 열면 단말에 키가 주입됩니다 — api-contract §13.2 admin #15)</div>
            <div className="flex flex-wrap items-start gap-4">
              {secret.setup_qr_png ? <img src={`data:image/png;base64,${secret.setup_qr_png}`} alt="단말 등록 QR" width={220} height={220} className="rounded-ad border border-line bg-white" /> : null}
              <div className="min-w-0 flex-1">
                <SecretReveal label="등록 URL (현황판은 TV 브라우저에서 1회 열기)" value={secret.setup_url} />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}

function StationFormModal({ open, initial, processes, onClose, onSaved }: { open: boolean; initial: Station | null; processes: Process[]; onClose: () => void; onSaved: (created: StationCreated | null) => void }) {
  const isEdit = initial !== null
  const create = useApiMutation((body: StationCreate) => stationsApi.create(body), [['res', 'stations']])
  const update = useUpdate<Station, StationUpdate>('stations')
  const toForm = (s: Station): Form => ({ id: s.id, type: s.type, process_code: s.process_code ?? '', location: s.location ?? '', printer_id: s.printer_id ?? '' })
  const { register, handleSubmit, reset, setError, watch, formState } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: initial ? toForm(initial) : EMPTY })
  const { topError, apply, clear } = useFormApiError<Form>(setError, FIELDS, 'id')
  useEffect(() => {
    if (open) {
      reset(initial ? toForm(initial) : EMPTY)
      clear()
    }
  }, [open, initial, reset, clear])
  const type = watch('type')
  const busy = create.loading || update.loading
  const onSubmit = handleSubmit(async (v) => {
    clear()
    try {
      if (isEdit) {
        const body: StationUpdate = {}
        const d = formState.dirtyFields
        if (d.type) body.type = v.type
        if (d.process_code) body.process_code = v.process_code || null
        if (d.location) body.location = v.location || null
        if (d.printer_id) body.printer_id = v.printer_id || null
        await update.mutate({ id: initial.id, body })
        onSaved(null)
      } else {
        const body: StationCreate = { id: v.id, type: v.type }
        if (v.process_code) body.process_code = v.process_code
        if (v.location) body.location = v.location
        if (v.printer_id) body.printer_id = v.printer_id
        onSaved(await create.mutate(body))
      }
    } catch (e) {
      apply(e)
    }
  })
  const err = formState.errors
  return (
    <Modal
      open={open}
      title={isEdit ? `단말 수정 — ${initial.id}` : '단말 등록'}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button variant="primary" onClick={() => void onSubmit()} loading={busy}>
            {isEdit ? '저장' : '등록 (API key 발급)'}
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
        <Input label="단말 ID" required maxLength={20} readOnly={isEdit} placeholder="예 K-P30-1, PDA-P20-1" hint={isEdit ? '수정 불가' : undefined} error={err.id?.message} {...register('id')} />
        <Select label="유형" required options={TYPE_OPTIONS} error={err.type?.message} {...register('type')} />
        <Select
          label="고정 공정코드"
          required={PROCESS_REQUIRED.includes(type)}
          options={processes.filter((p) => p.active).sort((a, b) => a.seq - b.seq).map((p) => ({ value: p.code, label: `${p.code} ${p.name}` }))}
          placeholder={PROCESS_REQUIRED.includes(type) ? '선택' : '— (현황판·관리자는 비움)'}
          hint="스캔 위치는 단말의 공정으로 판별 (spec §2.2)"
          error={err.process_code?.message}
          {...register('process_code')}
        />
        <Input label="설치 위치" maxLength={100} error={err.location?.message} {...register('location')} />
        <Input label="프린터 ID" maxLength={20} hint="포장 라벨 프린터 (StationCreate.printer_id, 선택). 프린터 등록은 ADM-09 [S1]" error={err.printer_id?.message} {...register('printer_id')} />
        <button type="submit" className="hidden" aria-hidden="true" />
      </form>
    </Modal>
  )
}

export function StationsPage() {
  const { role } = useAuth()
  const write = canWrite(role, 'master.stations')
  const toast = useToast()
  const params = useListParams({ defaultSort: 'id' })
  const list = useList<Station>('stations', params.query)
  const processes = useArray<Process>('processes')
  const procName = useMemo(() => new Map((processes.data ?? []).map((p) => [p.code, p.name])), [processes.data])
  const rotate = useApiMutation((id: string) => stationsApi.rotateKey(id))
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Station | null>(null)
  const [toggling, setToggling] = useState<Station | null>(null)
  const [rotating, setRotating] = useState<Station | null>(null)
  const [secret, setSecret] = useState<Secret | null>(null)

  const columns: Column<Station>[] = [
    { key: 'id', header: '단말 ID', sortable: true, render: (r) => <CodeText code={r.id} className={r.active ? '' : 'text-ink-faint'} /> },
    { key: 'type', header: '유형', sortable: true, render: (r) => `${r.type} ${StationTypeLabel[r.type]}` },
    { key: 'process_code', header: '공정', render: (r) => (r.process_code ? `${r.process_code} ${procName.get(r.process_code) ?? ''}` : '—') },
    { key: 'location', header: '설치 위치' },
    { key: 'api_key_prefix', header: '키 식별 ※', render: (r) => <CodeText code={r.api_key_prefix} /> },
    {
      key: 'last_seen_at',
      header: '마지막 접속',
      sortable: true,
      render: (r) => (
        <span title={formatDateTime(r.last_seen_at)}>
          {formatDateTime(r.last_seen_at)} <span className="text-ad-xs text-ink-muted">{r.last_seen_at ? `(${relativeTime(r.last_seen_at)})` : ''}</span>
        </span>
      ),
    },
    { key: 'active', header: '활성', render: (r) => <ActiveBadge active={r.active} /> },
    {
      key: '_actions',
      header: '',
      render: (r) =>
        write ? (
          <RowActions>
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
            <Button size="sm" variant="secondary" onClick={() => setRotating(r)}>
              키 회전
            </Button>
            <Button size="sm" variant={r.active ? 'danger' : 'secondary'} onClick={() => setToggling(r)}>
              {r.active ? '비활성' : '재활성'}
            </Button>
          </RowActions>
        ) : null,
    },
  ]

  return (
    <>
      <PageHeader
        title="단말"
        breadcrumb="기준정보 › 단말 (ADM-07)"
        description="단말 ID·유형·고정 공정코드·설치 위치·마지막 접속. API key 발급·회전 (미접속 강조는 [S4-8])"
        actions={
          <Button
            variant="primary"
            disabled={!write}
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
          >
            등록
          </Button>
        }
      />
      <ListToolbar params={params} />
      <DataTable<Station>
        columns={columns}
        rows={list.data?.items ?? []}
        rowKey={(r) => r.id}
        loading={list.loading}
        error={list.error ? <ApiErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : undefined}
        emptyText="조회 조건에 해당하는 데이터가 없습니다"
        emptyAction={
          <Button variant="secondary" onClick={params.reset}>
            필터 초기화
          </Button>
        }
        {...serverTable(params, list.data)}
      />
      <p className="mt-2 text-ad-xs text-ink-muted">비활성 단말의 요청은 403 STATION_INACTIVE · 개발 시드 6대: K-P30-1 K-P30-2 K-P50-1 PDA-P20-1 PDA-P60-1 BOARD-1</p>
      <StationFormModal
        open={formOpen}
        initial={editing}
        processes={processes.data ?? []}
        onClose={() => setFormOpen(false)}
        onSaved={(created) => {
          setFormOpen(false)
          toast.success('저장되었습니다')
          void list.refetch()
          if (created) setSecret({ title: `단말 ${created.id} 등록 완료 — API key`, stationId: created.id, api_key: created.api_key, setup_url: created.setup_url, setup_qr_png: created.setup_qr_png })
        }}
      />
      <ConfirmDialog
        open={rotating !== null}
        title={`키 회전 — ${rotating?.id ?? ''}`}
        danger
        confirmLabel="키 회전"
        loading={rotate.loading}
        error={rotate.error}
        onClose={() => setRotating(null)}
        onConfirm={async () => {
          if (!rotating) return
          try {
            const r = await rotate.mutate(rotating.id)
            setRotating(null)
            void list.refetch()
            setSecret({ title: `단말 ${rotating.id} 새 API key`, stationId: rotating.id, ...r })
          } catch {
            /* rotate.error 표시 */
          }
        }}
      >
        <p>기존 키는 즉시 무효가 됩니다. 새 키는 1회만 표시되며 단말에 다시 입력해야 합니다.</p>
      </ConfirmDialog>
      <SecretModal secret={secret} onClose={() => setSecret(null)} />
      <ToggleActiveDialog<Station>
        resource="stations"
        entityLabel="단말"
        target={toggling}
        idOf={(r) => r.id}
        describe={(r) => (
          <>
            <CodeText code={r.id} /> {r.location ?? ''}
          </>
        )}
        onClose={() => setToggling(null)}
        onDone={() => void list.refetch()}
      />
    </>
  )
}

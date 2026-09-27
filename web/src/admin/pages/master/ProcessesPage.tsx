/** ADM-04 공정 — seq 순 목록·등록(ADMIN)·수정·순서 변경(POST /processes/reorder)·비활성·재활성. P40 은 없다 */
import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, DataTable, Input, Modal, NumberInput, PageHeader, useToast, type Column } from '@/shared/ui/admin'
import { useApiMutation, useArray, useAuth, useCreate, useUpdate } from '@/shared/hooks'
import { processesApi } from '@/shared/api'
import { REQUIRED_INPUTS, type Process, type ProcessCreate, type ProcessUpdate, type RequiredInput } from '@/shared/types'
import { RequiredInputLabel } from '@/shared/labels'
import { canCreateProcess, canWrite } from '../../permissions'
import { ActiveBadge, ApiErrorAlert, CheckboxGroup, Checkbox, CodeText, RowActions, ToggleActiveDialog, numOrUndef, upperCode, useFormApiError, zx } from '../../components'

const schema = z.object({
  code: z.string().trim().min(1, '코드를 입력하세요').max(3, '3자 이하 (VARCHAR(3))'),
  name: zx.req(30, '공정명'),
  seq: z.number({ error: '순서를 입력하세요' }).int('정수').min(0, '0 이상').max(32767, '32767 이하'),
  requires_equipment: z.boolean(),
  required_inputs: z.array(z.enum(REQUIRED_INPUTS)),
})
type Form = z.infer<typeof schema>
const FIELDS = Object.keys(schema.shape)
const EMPTY: Partial<Form> = { code: '', name: '', requires_equipment: false, required_inputs: [] } // seq 는 빈칸 (NaN 금지, DEF-QA2-006)
const INPUT_OPTIONS = REQUIRED_INPUTS.map((v) => ({ value: v, label: `${v} ${RequiredInputLabel[v]}` }))
const toForm = (p: Process): Form => ({ code: p.code, name: p.name, seq: p.seq, requires_equipment: p.requires_equipment, required_inputs: p.required_inputs.filter((v): v is RequiredInput => (REQUIRED_INPUTS as readonly string[]).includes(v)) })

function ProcessFormModal({ open, initial, onClose, onSaved }: { open: boolean; initial: Process | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = initial !== null
  const create = useCreate<Process, ProcessCreate>('processes')
  const update = useUpdate<Process, ProcessUpdate>('processes')
  const { register, handleSubmit, reset, setError, control, formState } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: initial ? toForm(initial) : EMPTY })
  const { topError, apply, clear } = useFormApiError<Form>(setError, FIELDS, 'code')
  useEffect(() => {
    if (open) {
      reset(initial ? toForm(initial) : EMPTY)
      clear()
    }
  }, [open, initial, reset, clear])
  const busy = create.loading || update.loading
  const onSubmit = handleSubmit(async (v) => {
    clear()
    try {
      if (isEdit) {
        const body: ProcessUpdate = {}
        const d = formState.dirtyFields
        if (d.name) body.name = v.name
        if (d.seq) body.seq = v.seq
        if (d.requires_equipment) body.requires_equipment = v.requires_equipment
        if (d.required_inputs) body.required_inputs = v.required_inputs
        await update.mutate({ id: initial.code, body })
      } else {
        await create.mutate({ code: v.code, name: v.name, seq: v.seq, requires_equipment: v.requires_equipment, required_inputs: v.required_inputs })
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
      title={isEdit ? `공정 수정 — ${initial.code}` : '공정 등록'}
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
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4" noValidate>
        {topError ? <ApiErrorAlert error={topError} /> : null}
        <div className="grid grid-cols-2 gap-4">
          <Input label="코드" required maxLength={3} readOnly={isEdit} className="uppercase" hint={isEdit ? '수정 불가' : '시드는 P + 2자리. 대문자로 저장 (D28)'} error={err.code?.message} {...register('code', { setValueAs: upperCode })} />
          <NumberInput label="순서" required min={0} step={1} hint="UK — 중복이면 409" error={err.seq?.message} {...register('seq', { setValueAs: numOrUndef })} />
        </div>
        <Input label="공정명" required maxLength={30} error={err.name?.message} {...register('name')} />
        <Checkbox label="설비 필수" hint="true 면 스캔 시 equipment_code 필수 (api-contract §5.1)" {...register('requires_equipment')} />
        <Controller
          control={control}
          name="required_inputs"
          render={({ field }) => (
            <CheckboxGroup<RequiredInput> label="필수 입력" options={INPUT_OPTIONS} value={field.value} onChange={field.onChange} hint="허용 값 8종 (admin #11). 그 외는 422 BAD_REQUIRED_INPUT" error={err.required_inputs?.message} />
          )}
        />
        <button type="submit" className="hidden" aria-hidden="true" />
      </form>
    </Modal>
  )
}

export function ProcessesPage() {
  const { role } = useAuth()
  const write = canWrite(role, 'master.processes')
  const canCreate = canCreateProcess(role)
  const toast = useToast()
  const list = useArray<Process>('processes')
  const reorder = useApiMutation((codes: string[]) => processesApi.reorder(codes), [['res', 'processes']])
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Process | null>(null)
  const [toggling, setToggling] = useState<Process | null>(null)
  const [order, setOrder] = useState<Process[] | null>(null) // 순서 변경 모드

  const sorted = [...(list.data ?? [])].sort((a, b) => a.seq - b.seq)
  const rows = order ?? sorted
  const move = (i: number, dir: -1 | 1) => {
    if (!order) return
    const j = i + dir
    if (j < 0 || j >= order.length) return
    const next = [...order]
    const a = next[i]!
    next[i] = next[j]!
    next[j] = a
    setOrder(next)
  }

  const columns: Column<Process>[] = [
    {
      key: 'seq',
      header: '순서',
      align: 'right',
      render: (r, i) =>
        order ? (
          <RowActions>
            <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label="위로">
              ↑
            </Button>
            <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label="아래로">
              ↓
            </Button>
            <span className="tabular-nums text-ink-muted">{i + 1}</span>
          </RowActions>
        ) : (
          <span className="tabular-nums">{r.seq}</span>
        ),
    },
    { key: 'code', header: '코드', render: (r) => <CodeText code={r.code} /> },
    { key: 'name', header: '공정명', render: (r) => <span className={r.active ? '' : 'text-ink-faint'}>{r.name}</span> },
    { key: 'requires_equipment', header: '설비 필수', render: (r) => (r.requires_equipment ? '필수' : '') },
    {
      key: 'required_inputs',
      header: '필수 입력',
      render: (r) => (
        <span className="flex flex-wrap gap-1">
          {r.required_inputs.map((v) => (
            <span key={v} className="rounded-full border border-line bg-surface-2 px-2 font-mono text-ad-xs">
              {v}
            </span>
          ))}
        </span>
      ),
    },
    { key: 'active', header: '활성', render: (r) => <ActiveBadge active={r.active} /> },
    {
      key: '_actions',
      header: '',
      render: (r) =>
        write && !order ? (
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
        title="공정"
        breadcrumb="기준정보 › 공정 (ADM-04)"
        description="P10 수주 등록 · P20 입고 · P30 인쇄 · P50 포장 · P60 발송 — P40 은 없다. 자수는 P30 의 설비(EMB)"
        actions={
          order ? (
            <>
              <Button variant="ghost" onClick={() => setOrder(null)} disabled={reorder.loading}>
                취소
              </Button>
              <Button
                variant="primary"
                loading={reorder.loading}
                onClick={async () => {
                  try {
                    await reorder.mutate(order.map((p) => p.code))
                    toast.success('순서가 저장되었습니다')
                    setOrder(null)
                    void list.refetch()
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : String(e))
                  }
                }}
              >
                순서 저장
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" disabled={!write || sorted.length === 0} onClick={() => setOrder(sorted)}>
                순서 변경
              </Button>
              <Button
                variant="primary"
                disabled={!canCreate}
                title={canCreate ? undefined : '공정 등록은 ADMIN 만 (api-contract §7.2)'}
                onClick={() => {
                  setEditing(null)
                  setFormOpen(true)
                }}
              >
                등록
              </Button>
            </>
          )
        }
      />
      {reorder.error ? <ApiErrorAlert error={reorder.error} className="mb-3" /> : null}
      <DataTable<Process>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.code}
        loading={list.loading}
        error={list.error ? <ApiErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : undefined}
        emptyText="등록된 공정이 없습니다"
        pageSize={0}
      />
      <p className="mt-2 text-ad-xs text-ink-muted">활성 라우팅 단계가 참조하는 공정의 비활성은 409 PROCESS_IN_USE (admin #11)</p>
      <ProcessFormModal
        open={formOpen}
        initial={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false)
          toast.success('저장되었습니다')
          void list.refetch()
        }}
      />
      <ToggleActiveDialog<Process>
        resource="processes"
        entityLabel="공정"
        target={toggling}
        idOf={(r) => r.code}
        describe={(r) => (
          <>
            <CodeText code={r.code} /> {r.name}
          </>
        )}
        onClose={() => setToggling(null)}
        onDone={() => void list.refetch()}
      />
    </>
  )
}

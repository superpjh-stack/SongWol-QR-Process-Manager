/** ADM-05 설비 — 목록(q·active·equip_type·process_code)·등록·수정·비활성·재활성. 모두 P30 소속(기본) */
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, DataTable, Input, Modal, PageHeader, Select, useToast, type Column } from '@/shared/ui/admin'
import { useArray, useAuth, useCreate, useList, useUpdate } from '@/shared/hooks'
import { EQUIP_TYPES, type Equipment, type EquipmentCreate, type EquipmentUpdate, type Process } from '@/shared/types'
import { EquipTypeLabel } from '@/shared/labels'
import { canWrite } from '../../permissions'
import { ActiveBadge, ApiErrorAlert, CodeText, ListToolbar, RowActions, ToggleActiveDialog, serverTable, useFormApiError, useListParams, zx } from '../../components'

const schema = z.object({
  code: zx.req(20, '코드'),
  name: zx.req(50, '설비명'),
  process_code: z.string().min(1, '공정을 선택하세요'),
  equip_type: z.enum(EQUIP_TYPES, { error: '설비 유형을 선택하세요' }),
})
type Form = z.infer<typeof schema>
const FIELDS = Object.keys(schema.shape)
const EMPTY: Form = { code: '', name: '', process_code: 'P30', equip_type: 'PRINT' }
const TYPE_OPTIONS = EQUIP_TYPES.map((t) => ({ value: t, label: `${t} ${EquipTypeLabel[t]}` }))

function EquipmentFormModal({ open, initial, processes, onClose, onSaved }: { open: boolean; initial: Equipment | null; processes: Process[]; onClose: () => void; onSaved: () => void }) {
  const isEdit = initial !== null
  const create = useCreate<Equipment, EquipmentCreate>('equipment')
  const update = useUpdate<Equipment, EquipmentUpdate>('equipment')
  const toForm = (e: Equipment): Form => ({ code: e.code, name: e.name, process_code: e.process_code, equip_type: e.equip_type })
  const { register, handleSubmit, reset, setError, formState } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: initial ? toForm(initial) : EMPTY })
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
        const body: EquipmentUpdate = {}
        const d = formState.dirtyFields
        if (d.name) body.name = v.name
        if (d.process_code) body.process_code = v.process_code
        if (d.equip_type) body.equip_type = v.equip_type
        await update.mutate({ id: initial.id, body })
      } else await create.mutate(v)
      onSaved()
    } catch (e) {
      apply(e)
    }
  })
  const err = formState.errors
  // requires_equipment=true 우선 표시
  const procOptions = [...processes.filter((p) => p.active)]
    .sort((a, b) => Number(b.requires_equipment) - Number(a.requires_equipment) || a.seq - b.seq)
    .map((p) => ({ value: p.code, label: `${p.code} ${p.name}${p.requires_equipment ? ' (설비 필수)' : ''}` }))
  return (
    <Modal
      open={open}
      title={isEdit ? `설비 수정 — ${initial.code}` : '설비 등록'}
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
        <Input label="코드" required maxLength={20} readOnly={isEdit} placeholder="예 PRT-02, EMB-01" hint={isEdit ? '수정 불가' : undefined} error={err.code?.message} {...register('code')} />
        <Input label="설비명" required maxLength={50} error={err.name?.message} {...register('name')} />
        <Select label="공정" required options={procOptions} hint="모두 P30 소속 (A1-05)" error={err.process_code?.message} {...register('process_code')} />
        <Select label="설비 유형" required options={TYPE_OPTIONS} hint="가공방식 equip_types 와 맞아야 키오스크 설비 목록에 뜹니다" error={err.equip_type?.message} {...register('equip_type')} />
        <button type="submit" className="hidden" aria-hidden="true" />
      </form>
    </Modal>
  )
}

export function EquipmentPage() {
  const { role } = useAuth()
  const write = canWrite(role, 'master.equipment')
  const toast = useToast()
  const params = useListParams({ defaultSort: 'code', extraKeys: ['equip_type', 'process_code'] })
  const list = useList<Equipment>('equipment', params.query)
  const processes = useArray<Process>('processes')
  const procName = useMemo(() => new Map((processes.data ?? []).map((p) => [p.code, p.name])), [processes.data])
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Equipment | null>(null)
  const [toggling, setToggling] = useState<Equipment | null>(null)
  const openForm = (e: Equipment | null) => {
    setEditing(e)
    setFormOpen(true)
  }

  const columns: Column<Equipment>[] = [
    { key: 'code', header: '코드', sortable: true, render: (r) => <CodeText code={r.code} /> },
    { key: 'name', header: '설비명', sortable: true, render: (r) => <span className={r.active ? '' : 'text-ink-faint'}>{r.name}</span> },
    { key: 'process_code', header: '공정', render: (r) => `${r.process_code}${procName.get(r.process_code) ? ` ${procName.get(r.process_code)}` : ''}` },
    { key: 'equip_type', header: '설비 유형', render: (r) => `${r.equip_type} ${EquipTypeLabel[r.equip_type]}` },
    { key: 'active', header: '활성', render: (r) => <ActiveBadge active={r.active} /> },
    {
      key: '_actions',
      header: '',
      render: (r) =>
        write ? (
          <RowActions>
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
        title="설비"
        breadcrumb="기준정보 › 설비 (ADM-05)"
        actions={
          <Button variant="primary" disabled={!write} onClick={() => openForm(null)}>
            등록
          </Button>
        }
      />
      <ListToolbar params={params}>
        <Select label="설비 유형" value={params.extra.equip_type ?? ''} onChange={(e) => params.setExtra('equip_type', e.target.value)} options={TYPE_OPTIONS} placeholder="전체" wrapperClassName="w-40" />
        <Select
          label="공정"
          value={params.extra.process_code ?? ''}
          onChange={(e) => params.setExtra('process_code', e.target.value)}
          options={(processes.data ?? []).map((p) => ({ value: p.code, label: `${p.code} ${p.name}` }))}
          placeholder="전체"
          wrapperClassName="w-40"
        />
      </ListToolbar>
      <DataTable<Equipment>
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
        {...(write ? { onRowClick: (r: Equipment) => openForm(r) } : {})}
        {...serverTable(params, list.data)}
      />
      <EquipmentFormModal
        open={formOpen}
        initial={editing}
        processes={processes.data ?? []}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false)
          toast.success('저장되었습니다')
          void list.refetch()
        }}
      />
      <ToggleActiveDialog<Equipment>
        resource="equipment"
        entityLabel="설비"
        target={toggling}
        idOf={(r) => r.id}
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

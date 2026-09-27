/** ADM-03 가공방식 — 배열 응답 목록(admin #7)·등록·수정(name·equip_types)·비활성·재활성 */
import { useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, DataTable, Input, Modal, PageHeader, Select, useToast, type Column } from '@/shared/ui/admin'
import { useArray, useAuth, useCreate, useUpdate } from '@/shared/hooks'
import { EQUIP_TYPES, type EquipType, type PrintMethod, type PrintMethodCreate, type PrintMethodUpdate } from '@/shared/types'
import { EquipTypeLabel } from '@/shared/labels'
import { canWrite } from '../../permissions'
import { ActiveBadge, ApiErrorAlert, CheckboxGroup, Checkbox, CodeText, RowActions, ToggleActiveDialog, upperCode, useFormApiError, zx, type ActiveFilter } from '../../components'

const schema = z.object({
  code: zx.upperCode(20, '코드'),
  name: zx.req(30, '명'),
  equip_types: z.array(z.enum(EQUIP_TYPES)),
  skips_p30: z.boolean(),
})
type Form = z.infer<typeof schema>
const FIELDS = Object.keys(schema.shape)
const EMPTY: Form = { code: '', name: '', equip_types: [], skips_p30: false }
const EQUIP_OPTIONS = EQUIP_TYPES.map((t) => ({ value: t, label: `${t} ${EquipTypeLabel[t]}` }))

function PrintMethodFormModal({ open, initial, onClose, onSaved }: { open: boolean; initial: PrintMethod | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = initial !== null
  const create = useCreate<PrintMethod, PrintMethodCreate>('print-methods')
  const update = useUpdate<PrintMethod, PrintMethodUpdate>('print-methods')
  const { register, handleSubmit, reset, setError, control, formState } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: initial ? { code: initial.code, name: initial.name, equip_types: initial.equip_types, skips_p30: initial.skips_p30 } : EMPTY,
  })
  const { topError, apply, clear } = useFormApiError<Form>(setError, FIELDS, 'code')
  useEffect(() => {
    if (open) {
      reset(initial ? { code: initial.code, name: initial.name, equip_types: initial.equip_types, skips_p30: initial.skips_p30 } : EMPTY)
      clear()
    }
  }, [open, initial, reset, clear])
  const busy = create.loading || update.loading
  const onSubmit = handleSubmit(async (v) => {
    clear()
    try {
      if (isEdit) {
        const body: PrintMethodUpdate = {}
        if (formState.dirtyFields.name) body.name = v.name
        if (formState.dirtyFields.equip_types) body.equip_types = v.equip_types
        await update.mutate({ id: initial.code, body })
      } else {
        await create.mutate({ code: v.code, name: v.name, equip_types: v.equip_types, skips_p30: v.skips_p30 })
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
      title={isEdit ? `가공방식 수정 — ${initial.code}` : '가공방식 등록'}
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
        <Input label="코드" required maxLength={20} readOnly={isEdit} className="uppercase" hint={isEdit ? '수정 불가' : '영문 대문자 (api-contract §1)'} error={err.code?.message} {...register('code', { setValueAs: upperCode })} />
        <Input label="명" required maxLength={30} error={err.name?.message} {...register('name')} />
        <Controller
          control={control}
          name="equip_types"
          render={({ field }) => (
            <CheckboxGroup<EquipType> label="설비 유형" options={EQUIP_OPTIONS} value={field.value} onChange={field.onChange} hint="표시 필터, 강제 아님 (db §12-6). 무가공(NONE)은 비움" error={err.equip_types?.message} />
          )}
        />
        <Checkbox label="P30 생략" hint={isEdit ? '수정 불가 — PrintMethodUpdate 에 skips_p30 없음 (ts-types §4)' : '무가공(NONE)만 true — 라우팅에서 P30 을 뺀다'} disabled={isEdit} {...register('skips_p30')} />
        <button type="submit" className="hidden" aria-hidden="true" />
      </form>
    </Modal>
  )
}

export function PrintMethodsPage() {
  const { role } = useAuth()
  const write = canWrite(role, 'master.print-methods')
  const toast = useToast()
  const [active, setActive] = useState<ActiveFilter>('true')
  const list = useArray<PrintMethod>('print-methods', { active: active === 'all' ? undefined : active })
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<PrintMethod | null>(null)
  const [toggling, setToggling] = useState<PrintMethod | null>(null)
  const openForm = (pm: PrintMethod | null) => {
    setEditing(pm)
    setFormOpen(true)
  }

  const columns: Column<PrintMethod>[] = [
    { key: 'code', header: '코드', render: (r) => <CodeText code={r.code} /> },
    { key: 'name', header: '명', render: (r) => <span className={r.active ? '' : 'text-ink-faint'}>{r.name}</span> },
    {
      key: 'equip_types',
      header: '설비 유형',
      render: (r) => (
        <span className="flex flex-wrap gap-1">
          {r.equip_types.length === 0 ? <span className="text-ink-faint">—</span> : null}
          {r.equip_types.map((t) => (
            <span key={t} className="rounded-full border border-line bg-surface-2 px-2 text-ad-xs">
              {t} {EquipTypeLabel[t]}
            </span>
          ))}
        </span>
      ),
    },
    { key: 'skips_p30', header: 'P30 생략', render: (r) => (r.skips_p30 ? <span className="rounded-full border border-status-warn-line bg-status-warn-bg px-2 text-ad-xs text-status-warn-fg">P30 생략</span> : '') },
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
        title="가공방식"
        breadcrumb="기준정보 › 가공방식 (ADM-03)"
        description="나염·전사(승화)·DTF·자수·인쇄+자수·무가공. 각 방식이 P30 에서 거치는 설비 유형 목록"
        actions={
          <Button variant="primary" disabled={!write} onClick={() => openForm(null)}>
            등록
          </Button>
        }
      />
      <div className="mb-3 flex items-end gap-2">
        <Select
          label="활성"
          value={active}
          onChange={(e) => setActive(e.target.value as ActiveFilter)}
          options={[
            { value: 'true', label: '활성' },
            { value: 'false', label: '비활성' },
            { value: 'all', label: '전체' },
          ]}
          wrapperClassName="w-28"
        />
      </div>
      <DataTable<PrintMethod>
        columns={columns}
        rows={list.data ?? []}
        rowKey={(r) => r.code}
        loading={list.loading}
        error={list.error ? <ApiErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : undefined}
        emptyText="조회 조건에 해당하는 데이터가 없습니다"
        pageSize={0}
        {...(write ? { onRowClick: (r: PrintMethod) => openForm(r) } : {})}
      />
      <p className="mt-2 text-ad-xs text-ink-muted">시드 6종(SCREEN·TRANSFER·DTF·EMB·PRINT_EMB·NONE)은 비활성만 가능. 코드 변경 불가</p>
      <PrintMethodFormModal
        open={formOpen}
        initial={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false)
          toast.success('저장되었습니다')
          void list.refetch()
        }}
      />
      <ToggleActiveDialog<PrintMethod>
        resource="print-methods"
        entityLabel="가공방식"
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

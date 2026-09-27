/** ADM-02b 품목군 (D32 · admin #9) — 배열 응답 목록·등록·수정(name)·비활성·재활성. GET/POST /item-groups · PATCH /item-groups/{code} · activate/deactivate */
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, DataTable, Input, Modal, PageHeader, Select, useToast, type Column } from '@/shared/ui/admin'
import { useArray, useAuth, useCreate, useUpdate } from '@/shared/hooks'
import type { ItemGroup, ItemGroupCreate, ItemGroupUpdate } from '@/shared/types'
import { canWrite } from '../../permissions'
import { ActiveBadge, ApiErrorAlert, CodeText, RowActions, ToggleActiveDialog, upperCode, useFormApiError, zx, type ActiveFilter } from '../../components'

const schema = z.object({
  code: zx.upperCode(30, '코드'),
  name: zx.req(50, '명'),
})
type Form = z.infer<typeof schema>
const FIELDS = Object.keys(schema.shape)
const EMPTY: Form = { code: '', name: '' }

function ItemGroupFormModal({ open, initial, onClose, onSaved }: { open: boolean; initial: ItemGroup | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = initial !== null
  const create = useCreate<ItemGroup, ItemGroupCreate>('item-groups')
  const update = useUpdate<ItemGroup, ItemGroupUpdate>('item-groups')
  const { register, handleSubmit, reset, setError, formState } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: initial ? { code: initial.code, name: initial.name } : EMPTY })
  const { topError, apply, clear } = useFormApiError<Form>(setError, FIELDS, 'code')
  useEffect(() => {
    if (open) {
      reset(initial ? { code: initial.code, name: initial.name } : EMPTY)
      clear()
    }
  }, [open, initial, reset, clear])
  const busy = create.loading || update.loading
  const onSubmit = handleSubmit(async (v) => {
    clear()
    try {
      if (isEdit) await update.mutate({ id: initial.code, body: formState.dirtyFields.name ? { name: v.name } : {} })
      else await create.mutate({ code: v.code, name: v.name })
      onSaved()
    } catch (e) {
      apply(e)
    }
  })
  const err = formState.errors
  return (
    <Modal
      open={open}
      title={isEdit ? `품목군 수정 — ${initial.code}` : '품목군 등록'}
      onClose={onClose}
      size="sm"
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
        <Input label="코드" required maxLength={30} readOnly={isEdit} className="uppercase" hint={isEdit ? '수정 불가' : '영문 대문자·숫자·_ (예 TOWEL_40). 품목·라우팅의 item_group 값'} error={err.code?.message} {...register('code', { setValueAs: upperCode })} />
        <Input label="명" required maxLength={50} error={err.name?.message} {...register('name')} />
        <button type="submit" className="hidden" aria-hidden="true" />
      </form>
    </Modal>
  )
}

export function ItemGroupsPage() {
  const { role } = useAuth()
  const write = canWrite(role, 'master.item-groups')
  const toast = useToast()
  const [active, setActive] = useState<ActiveFilter>('true')
  const list = useArray<ItemGroup>('item-groups', { active: active === 'all' ? undefined : active })
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ItemGroup | null>(null)
  const [toggling, setToggling] = useState<ItemGroup | null>(null)
  const openForm = (g: ItemGroup | null) => {
    setEditing(g)
    setFormOpen(true)
  }
  const columns: Column<ItemGroup>[] = [
    { key: 'code', header: '코드', render: (r) => <CodeText code={r.code} /> },
    { key: 'name', header: '명', render: (r) => <span className={r.active ? '' : 'text-ink-faint'}>{r.name}</span> },
    { key: 'active', header: '활성', render: (r) => <ActiveBadge active={r.active} /> },
    {
      key: '_actions',
      header: '',
      render: (r) =>
        write ? (
          <RowActions>
            <Button size="sm" variant="ghost" onClick={() => openForm(r)}>
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
        title="품목군"
        breadcrumb="기준정보 › 품목군 (ADM-02b)"
        description="라우팅 결정 단위. 품목(ADM-02)의 item_group 은 활성 품목군 코드여야 합니다 (admin #9). 값 목록은 미결 U-1"
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
      <DataTable<ItemGroup>
        columns={columns}
        rows={list.data ?? []}
        rowKey={(r) => r.code}
        loading={list.loading}
        error={list.error ? <ApiErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : undefined}
        emptyText="조회 조건에 해당하는 데이터가 없습니다"
        emptyAction={
          write ? (
            <Button variant="primary" onClick={() => openForm(null)}>
              등록
            </Button>
          ) : undefined
        }
        pageSize={0}
      />
      <ItemGroupFormModal
        open={formOpen}
        initial={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false)
          toast.success('저장되었습니다')
          void list.refetch()
        }}
      />
      <ToggleActiveDialog<ItemGroup>
        resource="item-groups"
        entityLabel="품목군"
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

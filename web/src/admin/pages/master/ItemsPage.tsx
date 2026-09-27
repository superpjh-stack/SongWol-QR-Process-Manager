/** ADM-02 품목 — 목록(q·active·item_group·barcode)·등록·수정·비활성·재활성 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, DataTable, Input, Modal, NumberInput, PageHeader, Select, useToast, type Column } from '@/shared/ui/admin'
import { useArray, useAuth, useCreate, useList, useUpdate } from '@/shared/hooks'
import type { Item, ItemCreate, ItemGroup, ItemUpdate } from '@/shared/types'
import { formatQty } from '../../format'
import { canWrite } from '../../permissions'
import { ActiveBadge, ApiErrorAlert, CodeText, ListToolbar, RowActions, ToggleActiveDialog, numOrUndef, patchOf, serverTable, stripEmpty, upperCode, useFormApiError, useListParams, zx } from '../../components'

const schema = z.object({
  code: zx.req(30, '코드'),
  name: zx.req(100, '명'),
  item_group: zx.req(30, '품목군'),
  spec: zx.opt(50),
  color: zx.opt(30),
  weight_g: zx.optInt(0),
  vendor_item_code: zx.opt(50),
  vendor_barcode: zx.opt(64),
  qty_tolerance_pct: zx.num(0, 50, 0.1),
  legacy_id: zx.opt(50),
})
type Form = z.infer<typeof schema>
const FIELDS = Object.keys(schema.shape)
const EMPTY: Form = { code: '', name: '', item_group: '', spec: '', color: '', weight_g: undefined, vendor_item_code: '', vendor_barcode: '', qty_tolerance_pct: 3.0, legacy_id: '' }
const toForm = (i: Item): Form => ({
  code: i.code,
  name: i.name,
  item_group: i.item_group,
  spec: i.spec ?? '',
  color: i.color ?? '',
  weight_g: i.weight_g ?? undefined,
  vendor_item_code: i.vendor_item_code ?? '',
  vendor_barcode: i.vendor_barcode ?? '',
  qty_tolerance_pct: i.qty_tolerance_pct,
  legacy_id: i.legacy_id ?? '',
})

function ItemFormModal({ open, initial, groups, onClose, onSaved }: { open: boolean; initial: Item | null; groups: ItemGroup[]; onClose: () => void; onSaved: () => void }) {
  const isEdit = initial !== null
  const create = useCreate<Item, ItemCreate>('items')
  const update = useUpdate<Item, ItemUpdate>('items')
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
      if (isEdit) await update.mutate({ id: initial.id, body: patchOf(v, formState.dirtyFields, ['code']) as ItemUpdate })
      else await create.mutate(stripEmpty(v) as ItemCreate)
      onSaved()
    } catch (e) {
      apply(e)
    }
  })
  const err = formState.errors
  return (
    <Modal
      open={open}
      title={isEdit ? `품목 수정 — ${initial.code}` : '품목 등록'}
      onClose={onClose}
      size="lg"
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
        <Input label="코드" required maxLength={30} readOnly={isEdit} className="uppercase" hint={isEdit ? '수정 불가' : '대문자로 저장됩니다 (D28)'} error={err.code?.message} {...register('code', { setValueAs: upperCode })} />
        <Input label="명" required maxLength={100} error={err.name?.message} {...register('name')} />
        <Input
          label="품목군"
          required
          maxLength={30}
          list="item-group-list"
          hint="라우팅(ADM-06) 헤더와 같은 값이어야 WO 발행 시 ROUTING_NOT_FOUND 가 나지 않습니다. 활성 품목군 코드만 허용 (admin #9)"
          className="uppercase"
          error={err.item_group?.message}
          {...register('item_group', { setValueAs: upperCode })}
        />
        <datalist id="item-group-list">
          {groups.map((g) => (
            <option key={g.code} value={g.code}>
              {g.name}
            </option>
          ))}
        </datalist>
        <Input label="규격" maxLength={50} placeholder="예 40×80" error={err.spec?.message} {...register('spec')} />
        <Input label="색상" maxLength={30} error={err.color?.message} {...register('color')} />
        <NumberInput label="중량" unit="g" min={0} step={1} error={err.weight_g?.message} {...register('weight_g', { setValueAs: numOrUndef })} />
        <Input label="협력업체 품번" maxLength={50} error={err.vendor_item_code?.message} {...register('vendor_item_code')} />
        <Input label="협력업체 바코드" maxLength={64} hint="협력업체 바코드 규격 확인 전 (spec §16-5) — 중복을 막지 않습니다" error={err.vendor_barcode?.message} {...register('vendor_barcode')} />
        <NumberInput label="수량 허용오차" unit="%" required min={0} max={50} step={0.1} hint="기본 ±3% (B4-02)" error={err.qty_tolerance_pct?.message} {...register('qty_tolerance_pct', { valueAsNumber: true })} />
        <Input label="IMS 코드" maxLength={50} error={err.legacy_id?.message} {...register('legacy_id')} />
        <button type="submit" className="hidden" aria-hidden="true" />
      </form>
    </Modal>
  )
}

export function ItemsPage() {
  const { role } = useAuth()
  const write = canWrite(role, 'master.items')
  const navigate = useNavigate()
  const toast = useToast()
  const params = useListParams({ defaultSort: 'code', extraKeys: ['item_group', 'barcode'] })
  const list = useList<Item>('items', params.query)
  const groups = useArray<ItemGroup>('item-groups', { active: true })
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Item | null>(null)
  const [toggling, setToggling] = useState<Item | null>(null)
  const groupOptions = useMemo(() => (groups.data ?? []).map((g) => ({ value: g.code, label: `${g.code} ${g.name}` })), [groups.data])

  const columns: Column<Item>[] = [
    { key: 'code', header: '코드', sortable: true, render: (r) => <CodeText code={r.code} /> },
    { key: 'name', header: '명', sortable: true, render: (r) => <span className={r.active ? '' : 'text-ink-faint'}>{r.name}</span> },
    { key: 'item_group', header: '품목군 ※', sortable: true },
    { key: 'spec', header: '규격' },
    { key: 'color', header: '색상' },
    { key: 'weight_g', header: '중량(g)', align: 'right', render: (r) => <span className="tabular-nums">{formatQty(r.weight_g)}</span> },
    { key: 'vendor_item_code', header: '협력업체 품번' },
    { key: 'vendor_barcode', header: '협력업체 바코드', render: (r) => <CodeText code={r.vendor_barcode} /> },
    { key: 'qty_tolerance_pct', header: '허용오차(%) ※', align: 'right', render: (r) => <span className="tabular-nums">{formatQty(r.qty_tolerance_pct, 1)}</span> },
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

  const openForm = (it: Item | null) => {
    setEditing(it)
    setFormOpen(true)
  }

  return (
    <>
      <PageHeader
        title="품목"
        breadcrumb="기준정보 › 품목 (ADM-02)"
        actions={
          <>
            {write ? (
              <Button variant="secondary" onClick={() => navigate('/admin/master/import?entity=item')}>
                엑셀 일괄 등록
              </Button>
            ) : null}
            <Button variant="primary" disabled={!write} onClick={() => openForm(null)}>
              등록
            </Button>
          </>
        }
      />
      <ListToolbar params={params}>
        <Select label="품목군" value={params.extra.item_group ?? ''} onChange={(e) => params.setExtra('item_group', e.target.value)} options={groupOptions} placeholder="전체" wrapperClassName="w-44" />
        <Input label="업체 바코드" placeholder="정확 검색" defaultValue={params.extra.barcode ?? ''} onBlur={(e) => params.setExtra('barcode', e.target.value.trim())} wrapperClassName="w-44" />
      </ListToolbar>
      {groups.error ? <ApiErrorAlert error={groups.error} onRetry={() => void groups.refetch()} className="mb-3" /> : null}
      <DataTable<Item>
        columns={columns}
        rows={list.data?.items ?? []}
        rowKey={(r) => r.id}
        loading={list.loading}
        error={list.error ? <ApiErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : undefined}
        emptyText="조회 조건에 해당하는 데이터가 없습니다"
        emptyAction={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={params.reset}>
              필터 초기화
            </Button>
            {write ? (
              <Button variant="primary" onClick={() => openForm(null)}>
                등록
              </Button>
            ) : null}
          </div>
        }
        {...(write ? { onRowClick: (r: Item) => openForm(r) } : {})}
        {...serverTable(params, list.data)}
      />
      <p className="mt-2 text-ad-xs text-ink-muted">※ 표시명은 PM 확정 대상 · 품목군 값은 미결 U-1 (개발 시드 TOWEL_40·TOWEL_50)</p>

      <ItemFormModal
        open={formOpen}
        initial={editing}
        groups={groups.data ?? []}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false)
          toast.success('저장되었습니다')
          void list.refetch()
        }}
      />
      <ToggleActiveDialog<Item>
        resource="items"
        entityLabel="품목"
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

/** ADM-01 거래처 — 목록·등록·수정·비활성·재활성. 상세(배송지)는 CustomerDetailPage */
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, DataTable, Input, Modal, PageHeader, useToast, type Column } from '@/shared/ui/admin'
import { useAuth, useCreate, useList, useUpdate } from '@/shared/hooks'
import type { Customer, CustomerCreate, CustomerUpdate } from '@/shared/types'
import { formatDateTime } from '../../format'
import { canWrite } from '../../permissions'
import { ActiveBadge, ApiErrorAlert, CodeText, ListToolbar, RowActions, ToggleActiveDialog, patchOf, serverTable, stripEmpty, upperCode, useFormApiError, useListParams, zx } from '../../components'

const schema = z.object({
  code: zx.req(20, '코드'),
  name: zx.req(100, '명'),
  contact_name: zx.opt(50),
  phone: zx.opt(30),
  email: zx.email(100),
  default_carrier: zx.opt(20),
  legacy_id: zx.opt(50),
})
type Form = z.infer<typeof schema>
const FIELDS = Object.keys(schema.shape)
const EMPTY: Form = { code: '', name: '', contact_name: '', phone: '', email: '', default_carrier: '', legacy_id: '' }

function toForm(c: Customer): Form {
  return {
    code: c.code,
    name: c.name,
    contact_name: c.contact_name ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    default_carrier: c.default_carrier ?? '',
    legacy_id: c.legacy_id ?? '',
  }
}

export function CustomerFormModal({ open, initial, onClose, onSaved }: { open: boolean; initial: Customer | null; onClose: () => void; onSaved: (c: Customer) => void }) {
  const isEdit = initial !== null
  const create = useCreate<Customer, CustomerCreate>('customers')
  const update = useUpdate<Customer, CustomerUpdate>('customers')
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: initial ? toForm(initial) : EMPTY })
  const { register, handleSubmit, reset, setError, formState } = form
  const { topError, apply, clear } = useFormApiError<Form>(setError, FIELDS, 'code')
  useEffect(() => {
    if (open) {
      reset(initial ? toForm(initial) : EMPTY)
      clear()
    }
  }, [open, initial, reset, clear])

  const onSubmit = handleSubmit(async (v) => {
    clear()
    try {
      const saved = isEdit
        ? await update.mutate({ id: initial.id, body: patchOf(v, formState.dirtyFields, ['code']) as CustomerUpdate })
        : await create.mutate(stripEmpty(v) as CustomerCreate)
      onSaved(saved)
    } catch (e) {
      apply(e)
    }
  })
  const busy = create.loading || update.loading
  const err = formState.errors
  return (
    <Modal
      open={open}
      title={isEdit ? `거래처 수정 — ${initial.code}` : '거래처 등록'}
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
        <Input label="코드" required maxLength={20} readOnly={isEdit} className="uppercase" hint={isEdit ? '수정 불가' : 'IMS 엑셀 코드 유지(있으면). 대문자로 저장 (D28)'} error={err.code?.message} {...register('code', { setValueAs: upperCode })} />
        <Input label="명" required maxLength={100} error={err.name?.message} {...register('name')} />
        <Input label="담당자" maxLength={50} error={err.contact_name?.message} {...register('contact_name')} />
        <Input label="연락처" maxLength={30} error={err.phone?.message} {...register('phone')} />
        <Input label="이메일" type="email" maxLength={100} error={err.email?.message} {...register('email')} />
        <Input label="기본 택배사" maxLength={20} hint="택배사 값 목록 정의 없음 — 자유 입력 (§3 #6)" error={err.default_carrier?.message} {...register('default_carrier')} />
        <Input label="IMS 코드" maxLength={50} hint="이관 시 자동 채움. 수기 등록은 비움" error={err.legacy_id?.message} {...register('legacy_id')} />
        <button type="submit" className="hidden" aria-hidden="true" />
      </form>
    </Modal>
  )
}

export function CustomersPage() {
  const { role } = useAuth()
  const write = canWrite(role, 'master.customers')
  const navigate = useNavigate()
  const toast = useToast()
  const params = useListParams({ defaultSort: 'code' })
  const list = useList<Customer>('customers', params.query)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [toggling, setToggling] = useState<Customer | null>(null)

  const columns: Column<Customer>[] = [
    { key: 'code', header: '코드', sortable: true, render: (r) => <CodeText code={r.code} /> },
    { key: 'name', header: '명', sortable: true, render: (r) => <span className={r.active ? '' : 'text-ink-faint'}>{r.name}</span> },
    { key: 'contact_name', header: '담당자' },
    { key: 'phone', header: '연락처' },
    { key: 'email', header: '이메일 ※' },
    { key: 'default_carrier', header: '기본 택배사' },
    { key: 'legacy_id', header: 'IMS 코드 ※', render: (r) => <CodeText code={r.legacy_id} /> },
    { key: 'active', header: '활성', render: (r) => <ActiveBadge active={r.active} /> },
    { key: 'updated_at', header: '수정일 ※', sortable: true, render: (r) => formatDateTime(r.updated_at) },
    {
      key: '_actions',
      header: '',
      render: (r) => (
        <RowActions>
          <Button size="sm" variant="ghost" onClick={() => navigate(`/admin/master/customers/${r.id}`)}>
            상세
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
      <PageHeader
        title="거래처"
        breadcrumb="기준정보 › 거래처 (ADM-01)"
        actions={
          <>
            {write ? (
              <Button variant="secondary" onClick={() => navigate('/admin/master/import?entity=customer')}>
                엑셀 일괄 등록
              </Button>
            ) : null}
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
          </>
        }
      />
      <ListToolbar params={params} />
      <DataTable<Customer>
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
              <Button
                variant="primary"
                onClick={() => {
                  setEditing(null)
                  setFormOpen(true)
                }}
              >
                등록
              </Button>
            ) : null}
          </div>
        }
        onRowClick={(r) => navigate(`/admin/master/customers/${r.id}`)}
        {...serverTable(params, list.data)}
      />
      <p className="mt-2 text-ad-xs text-ink-muted">
        ※ 표시명은 PM 확정 대상 · 정렬 허용 컬럼: 코드·명·수정일 (api-contract §13.1) · <Link className="underline" to="/admin/master/import?entity=customer">엑셀 일괄 등록</Link>
      </p>

      <CustomerFormModal
        open={formOpen}
        initial={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false)
          toast.success('저장되었습니다')
          void list.refetch()
        }}
      />
      <ToggleActiveDialog<Customer>
        resource="customers"
        entityLabel="거래처"
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

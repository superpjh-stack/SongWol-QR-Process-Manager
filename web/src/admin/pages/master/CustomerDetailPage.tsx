/** ADM-01 거래처 상세 — 헤더 + 배송지 탭 (GET/POST/PATCH /customers/{id}/addresses, deactivate/activate) */
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, DataTable, Input, Modal, PageHeader, useToast, type Column } from '@/shared/ui/admin'
import { useApiMutation, useApiQuery, useAuth, useOne } from '@/shared/hooks'
import { customersApi } from '@/shared/api'
import type { Customer, CustomerAddress, CustomerAddressInput } from '@/shared/types'
import { formatDateTime } from '../../format'
import { canWrite } from '../../permissions'
import { ActiveBadge, ApiErrorAlert, Checkbox, CodeText, ConfirmDialog, QueryState, RowActions, useFormApiError, zx } from '../../components'
import { CustomerFormModal } from './CustomersPage'

const schema = z.object({
  label: zx.req(50, '배송지명'),
  receiver: zx.opt(50),
  phone: zx.opt(30),
  postal_code: zx.opt(10),
  address1: zx.req(200, '주소'),
  address2: zx.opt(200),
  is_default: z.boolean(),
})
type Form = z.infer<typeof schema>
const FIELDS = Object.keys(schema.shape)
const EMPTY: Form = { label: '', receiver: '', phone: '', postal_code: '', address1: '', address2: '', is_default: false }
const toForm = (a: CustomerAddress): Form => ({
  label: a.label,
  receiver: a.receiver ?? '',
  phone: a.phone ?? '',
  postal_code: a.postal_code ?? '',
  address1: a.address1,
  address2: a.address2 ?? '',
  is_default: a.is_default,
})
const toInput = (v: Form): CustomerAddressInput => ({
  label: v.label,
  receiver: v.receiver || null,
  phone: v.phone || null,
  postal_code: v.postal_code || null,
  address1: v.address1,
  address2: v.address2 || null,
  is_default: v.is_default,
})

function AddressFormModal({ customerId, open, initial, onClose, onSaved }: { customerId: number; open: boolean; initial: CustomerAddress | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = initial !== null
  const create = useApiMutation((body: CustomerAddressInput) => customersApi.addresses.create(customerId, body))
  const update = useApiMutation(({ id, body }: { id: number; body: CustomerAddressInput }) => customersApi.addresses.update(customerId, id, body))
  const { register, handleSubmit, reset, setError, formState } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: initial ? toForm(initial) : EMPTY })
  const { topError, apply, clear } = useFormApiError<Form>(setError, FIELDS)
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
      if (isEdit) await update.mutate({ id: initial.id, body: toInput(v) })
      else await create.mutate(toInput(v))
      onSaved()
    } catch (e) {
      apply(e)
    }
  })
  const err = formState.errors
  return (
    <Modal
      open={open}
      title={isEdit ? `배송지 수정 — ${initial.label}` : '배송지 추가'}
      onClose={onClose}
      size="md"
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
        <Input label="배송지명" required maxLength={50} placeholder="예: 본사, 물류창고" error={err.label?.message} {...register('label')} />
        <Input label="수령인" maxLength={50} error={err.receiver?.message} {...register('receiver')} />
        <Input label="연락처" maxLength={30} error={err.phone?.message} {...register('phone')} />
        <Input label="우편번호" maxLength={10} error={err.postal_code?.message} {...register('postal_code')} />
        <Input label="주소" required maxLength={200} wrapperClassName="md:col-span-2" error={err.address1?.message} {...register('address1')} />
        <Input label="상세 주소" maxLength={200} wrapperClassName="md:col-span-2" error={err.address2?.message} {...register('address2')} />
        <Checkbox label="기본 배송지" hint="기본으로 설정하면 기존 기본 배송지가 해제됩니다" wrapperClassName="md:col-span-2" {...register('is_default')} />
        <button type="submit" className="hidden" aria-hidden="true" />
      </form>
    </Modal>
  )
}

export function CustomerDetailPage() {
  const { id: idParam } = useParams<{ id: string }>()
  const id = Number(idParam)
  const { role } = useAuth()
  const write = canWrite(role, 'master.customers')
  const toast = useToast()
  const customer = useOne<Customer>('customers', Number.isFinite(id) ? id : null)
  const addresses = useApiQuery<CustomerAddress[]>(['res', 'customers', id, 'addresses'], () => customersApi.addresses.list(id), Number.isFinite(id))
  const toggle = useApiMutation((a: CustomerAddress) => (a.active ? customersApi.addresses.deactivate(id, a.id) : customersApi.addresses.activate(id, a.id)))
  const [editOpen, setEditOpen] = useState(false)
  const [addrOpen, setAddrOpen] = useState(false)
  const [addrEditing, setAddrEditing] = useState<CustomerAddress | null>(null)
  const [toggling, setToggling] = useState<CustomerAddress | null>(null)

  const columns: Column<CustomerAddress>[] = [
    { key: 'label', header: '배송지명' },
    { key: 'receiver', header: '수령인' },
    { key: 'phone', header: '연락처' },
    { key: 'postal_code', header: '우편번호' },
    { key: 'address1', header: '주소' },
    { key: 'address2', header: '상세 주소' },
    { key: 'is_default', header: '기본', render: (r) => (r.is_default ? '기본' : '') },
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
                setAddrEditing(r)
                setAddrOpen(true)
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
    <QueryState state={customer}>
      {(c) => (
        <>
          <PageHeader
            title={`${c.code} ${c.name}`}
            breadcrumb={
              <>
                기준정보 › <Link className="underline" to="/admin/master/customers">거래처</Link> › 상세 (ADM-01)
              </>
            }
            actions={
              <>
                <ActiveBadge active={c.active} />
                <Button variant="primary" disabled={!write} onClick={() => setEditOpen(true)}>
                  수정
                </Button>
              </>
            }
          />
          <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-2 rounded-ad border border-line bg-surface p-4 md:grid-cols-4">
            {[
              ['코드', <CodeText key="c" code={c.code} copy />],
              ['명', c.name],
              ['담당자', c.contact_name ?? '—'],
              ['연락처', c.phone ?? '—'],
              ['이메일 ※', c.email ?? '—'],
              ['기본 택배사', c.default_carrier ?? '—'],
              ['IMS 코드 ※', <CodeText key="l" code={c.legacy_id} />],
              ['수정일 ※', formatDateTime(c.updated_at)],
            ].map(([k, v], i) => (
              <div key={i}>
                <dt className="text-ad-xs text-ink-muted">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-ad-lg font-semibold">배송지</h2>
              <Button
                variant="primary"
                size="sm"
                disabled={!write}
                onClick={() => {
                  setAddrEditing(null)
                  setAddrOpen(true)
                }}
              >
                배송지 추가
              </Button>
            </div>
            <DataTable<CustomerAddress>
              columns={columns}
              rows={addresses.data ?? []}
              rowKey={(r) => r.id}
              loading={addresses.loading}
              error={addresses.error ? <ApiErrorAlert error={addresses.error} onRetry={() => void addresses.refetch()} /> : undefined}
              emptyText="등록된 배송지가 없습니다 — 수주 등록 시 직접 입력할 수 있습니다"
              pageSize={0}
            />
            <p className="mt-2 text-ad-xs text-ink-muted">변경 이력: 감사 로그(ADM-30) — [S4-8]</p>
          </section>

          <CustomerFormModal
            open={editOpen}
            initial={c}
            onClose={() => setEditOpen(false)}
            onSaved={() => {
              setEditOpen(false)
              toast.success('저장되었습니다')
              void customer.refetch()
            }}
          />
          <AddressFormModal
            customerId={c.id}
            open={addrOpen}
            initial={addrEditing}
            onClose={() => setAddrOpen(false)}
            onSaved={() => {
              setAddrOpen(false)
              toast.success('저장되었습니다')
              void addresses.refetch()
            }}
          />
          <ConfirmDialog
            open={toggling !== null}
            title={toggling?.active ? '배송지 비활성' : '배송지 재활성'}
            danger={Boolean(toggling?.active)}
            loading={toggle.loading}
            error={toggle.error}
            onClose={() => setToggling(null)}
            onConfirm={async () => {
              if (!toggling) return
              try {
                await toggle.mutate(toggling)
                toast.success(toggling.active ? '비활성 처리되었습니다' : '재활성 처리되었습니다')
                setToggling(null)
                void addresses.refetch()
              } catch (e) {
                toast.error(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            {toggling ? (
              <p>
                배송지 「{toggling.label}」 을(를) {toggling.active ? '비활성 처리합니다. 기존 거래 데이터는 유지됩니다.' : '다시 활성화합니다.'}
              </p>
            ) : null}
          </ConfirmDialog>
        </>
      )}
    </QueryState>
  )
}

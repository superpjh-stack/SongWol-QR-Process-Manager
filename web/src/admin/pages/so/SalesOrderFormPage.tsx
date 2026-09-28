/**
 * ADM-13 수주 등록·수정 (A2-01, A2-05) — [S1-1]
 * 헤더: 거래처(SearchSelect) · 수주일 · 납기일 · 배송지(등록 배송지 라디오 / 직접 입력 ShipTo) · 비고
 * 라인: 품목(SearchSelect, 선택 시 규격·색상 읽기 전용) · 가공방식(활성 print-methods) · 수량 · 단가(선택)
 * 저장 POST /so (201) → ADM-14. 수정 PATCH /so/{id} {due_date?, ship_to?, memo?, lines?} — 착수 라인 qty 변경 409 STATE_CONFLICT 는 상단
 */
import { useCallback, useEffect, useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Controller, useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, DateInput, ErrorAlert, Input, NumberInput, PageHeader, SearchSelect, Select, Spinner, useToast } from '@/shared/ui/admin'
import { useApiMutation, useApiQuery, useArray, useAuth } from '@/shared/hooks'
import { customersApi, itemsApi, soApi } from '@/shared/api'
import { PRINT_METHOD_CODES, type Customer, type CustomerAddress, type Item, type PrintMethod, type PrintMethodCode, type SalesOrderCreate, type SalesOrderDetail, type SalesOrderLineInput, type SalesOrderUpdate, type ShipTo } from '@/shared/types'
import { PrintMethodCodeLabel } from '@/shared/labels'
import { todayIso } from '../../format'
import { canWrite } from '../../permissions'
import { ApiErrorAlert, CodeText, RadioGroup, Textarea, numOrUndef, useFormApiError, zx } from '../../components'
import { apiErrorText, customerLabel, searchCustomers } from './customerSearch'

const customerRef = z.object({ id: z.number(), code: z.string(), name: z.string() })
const itemRef = z.object({ id: z.number(), code: z.string(), name: z.string(), spec: z.string().nullable(), color: z.string().nullable() })
const lineSchema = z.object({
  id: z.number().optional(),
  item: itemRef.nullable(),
  print_method: z.enum(PRINT_METHOD_CODES as unknown as [PrintMethodCode, ...PrintMethodCode[]], { error: '가공방식을 선택하세요' }),
  qty: z.number({ error: '수량을 입력하세요' }).int('정수').min(1, '1 이상'),
  unit_price: z.number({ error: '숫자를 입력하세요' }).min(0, '0 이상').optional(),
})
const schema = z
  .object({
    customer: customerRef.nullable(),
    order_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '수주일을 입력하세요'),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '납기일을 입력하세요'),
    ship_mode: z.enum(['ADDRESS', 'DIRECT']),
    address_id: z.string(),
    ship_to: z.object({ receiver: zx.opt(50), phone: zx.opt(30), postal_code: zx.opt(10), address1: zx.opt(200), address2: zx.opt(200) }),
    memo: z.string(),
    lines: z.array(lineSchema).min(1, '라인을 1행 이상 입력하세요'),
  })
  .superRefine((v, ctx) => {
    if (v.customer === null) ctx.addIssue({ code: 'custom', path: ['customer'], message: '거래처를 선택하세요' })
    v.lines.forEach((l, i) => {
      if (l.item === null) ctx.addIssue({ code: 'custom', path: ['lines', i, 'item'], message: '품목을 선택하세요' })
    })
  })
  .refine((v) => v.ship_mode !== 'ADDRESS' || v.address_id !== '', { path: ['address_id'], message: '배송지를 선택하세요' })
  .refine((v) => v.ship_mode !== 'DIRECT' || v.ship_to.address1.trim() !== '', { path: ['ship_to', 'address1'], message: '주소를 입력하세요' })
type Form = z.infer<typeof schema>
const FIELDS = ['customer_id', 'order_date', 'due_date', 'address_id', 'ship_to', 'memo', 'lines']

const searchItems = async (q: string, signal: AbortSignal): Promise<Item[]> => (await itemsApi.list({ q, active: true, size: 20 }, signal)).items
const itemLabel = (i: Item) => `${i.code} ${i.name}`

function toShipTo(v: Form['ship_to']): ShipTo {
  return { receiver: v.receiver || null, phone: v.phone || null, postal_code: v.postal_code || null, address1: v.address1.trim(), address2: v.address2 || null }
}
function toLineInput(l: Form['lines'][number]): SalesOrderLineInput {
  const out: SalesOrderLineInput = { item_id: l.item!.id, print_method: l.print_method, qty: l.qty }
  if (l.id !== undefined) out.id = l.id
  if (l.unit_price !== undefined) out.unit_price = l.unit_price
  return out
}
function fromDetail(so: SalesOrderDetail): Form {
  return {
    customer: { id: so.customer.id, code: so.customer.code, name: so.customer.name ?? '' },
    order_date: so.order_date,
    due_date: so.due_date,
    ship_mode: 'DIRECT',
    address_id: '',
    ship_to: { receiver: so.ship_to.receiver ?? '', phone: so.ship_to.phone ?? '', postal_code: so.ship_to.postal_code ?? '', address1: so.ship_to.address1, address2: so.ship_to.address2 ?? '' },
    memo: so.memo ?? '',
    lines: so.lines.map((l) => ({
      id: l.id,
      item: { id: l.item.id, code: l.item.code, name: l.item.name ?? '', spec: l.item.spec, color: l.item.color },
      print_method: l.print_method,
      qty: l.qty,
      ...(l.unit_price !== null ? { unit_price: l.unit_price } : {}),
    })),
  }
}
const EMPTY_LINE: Form['lines'][number] = { item: null, print_method: 'SCREEN', qty: 0 }
const EMPTY: Form = { customer: null, order_date: todayIso(), due_date: '', ship_mode: 'ADDRESS', address_id: '', ship_to: { receiver: '', phone: '', postal_code: '', address1: '', address2: '' }, memo: '', lines: [{ ...EMPTY_LINE }] }

function SoForm({ initial, printMethods, onSaved }: { initial: SalesOrderDetail | null; printMethods: PrintMethod[]; onSaved: (code: string) => void }) {
  const isEdit = initial !== null
  const navigate = useNavigate()
  const create = useApiMutation((b: SalesOrderCreate) => soApi.create(b))
  const update = useApiMutation(({ id, body }: { id: number; body: SalesOrderUpdate }) => soApi.update(id, body))
  const { control, register, handleSubmit, setError, watch, setValue, formState } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: initial ? fromDetail(initial) : EMPTY, mode: 'onBlur' })
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  const { topError, apply, clear } = useFormApiError<Form>(setError, FIELDS)
  const customer = watch('customer')
  const shipMode = watch('ship_mode')
  const orderDate = watch('order_date')
  const dueDate = watch('due_date')
  const lines = watch('lines')
  const addresses = useApiQuery<CustomerAddress[]>(['res', 'customers', customer?.id ?? 0, 'addresses'], () => customersApi.addresses.list(customer!.id), customer !== null)
  const activeAddresses = useMemo(() => (addresses.data ?? []).filter((a) => a.active), [addresses.data])
  // 거래처 선택 시 기본 배송지 자동 선택 (등록 모드)
  useEffect(() => {
    if (isEdit || !customer || !addresses.data) return
    const def = activeAddresses.find((a) => a.is_default) ?? activeAddresses[0]
    setValue('address_id', def ? String(def.id) : '')
    setValue('ship_mode', def ? 'ADDRESS' : 'DIRECT')
  }, [isEdit, customer, addresses.data, activeAddresses, setValue])
  const searchC = useCallback(searchCustomers, [])
  const searchI = useCallback(searchItems, [])
  const pmOptions = useMemo(() => printMethods.filter((p) => p.active).map((p) => ({ value: p.code, label: `${p.code} ${p.name || PrintMethodCodeLabel[p.code]}` })), [printMethods])
  const busy = create.loading || update.loading
  const dueWarn = orderDate && dueDate && dueDate < orderDate ? '납기일이 수주일보다 빠릅니다 (규칙 정의 없음 — 경고만)' : undefined

  const onSubmit = handleSubmit(async (v) => {
    clear()
    try {
      if (isEdit) {
        const body: SalesOrderUpdate = { due_date: v.due_date, memo: v.memo, lines: v.lines.map(toLineInput) }
        if (v.ship_mode === 'DIRECT') body.ship_to = toShipTo(v.ship_to)
        else {
          const a = activeAddresses.find((x) => String(x.id) === v.address_id)
          if (a) body.ship_to = { receiver: a.receiver, phone: a.phone, postal_code: a.postal_code, address1: a.address1, address2: a.address2 }
        }
        const so = await update.mutate({ id: initial.id, body })
        onSaved(so.code)
      } else {
        const body: SalesOrderCreate = { customer_id: v.customer!.id, order_date: v.order_date, due_date: v.due_date, lines: v.lines.map(toLineInput) }
        if (v.ship_mode === 'ADDRESS') body.address_id = Number(v.address_id)
        else body.ship_to = toShipTo(v.ship_to)
        if (v.memo.trim()) body.memo = v.memo.trim()
        const so = await create.mutate(body)
        onSaved(so.code)
      }
    } catch (e) {
      apply(e)
    }
  })
  const err = formState.errors

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      {topError ? <ApiErrorAlert error={topError} /> : null}
      <section className="rounded-ad border border-line bg-surface p-4">
        <h2 className="mb-3 text-ad-lg font-semibold">헤더</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Controller
            control={control}
            name="customer"
            render={({ field }) => (
              <SearchSelect<Customer | NonNullable<Form['customer']>>
                label="거래처"
                required
                value={field.value}
                onChange={(c) => field.onChange(c ? { id: c.id, code: c.code, name: c.name } : null)}
                search={searchC}
                getKey={(c) => c.id}
                getLabel={(c) => customerLabel(c as Customer)}
                errorText={apiErrorText}
                disabled={isEdit}
                hint={isEdit ? '수정 불가' : '코드·상호 검색 (활성 거래처)'}
                error={err.customer?.message}
              />
            )}
          />
          <DateInput label="수주일" required readOnly={isEdit} hint={isEdit ? '수정 불가' : '기본 오늘 (KST)'} error={err.order_date?.message} {...register('order_date')} />
          <DateInput label="납기일" required hint={dueWarn ?? '납기 시각은 18:00 KST 로 간주 (db §12-22)'} error={err.due_date?.message} {...register('due_date')} />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          <Controller
            control={control}
            name="ship_mode"
            render={({ field }) => (
              <RadioGroup<'ADDRESS' | 'DIRECT'>
                label="배송지"
                required
                name="ship_mode"
                value={field.value}
                onChange={field.onChange}
                options={[
                  { value: 'ADDRESS', label: '등록 배송지에서 선택', hint: customer ? `${activeAddresses.length}건 (ADM-01 배송지)` : '거래처를 먼저 선택' },
                  { value: 'DIRECT', label: '직접 입력', hint: '서버가 ship_to JSONB 로 스냅샷' },
                ]}
              />
            )}
          />
          {shipMode === 'ADDRESS' ? (
            <div className="md:col-span-2">
              {addresses.loading ? (
                <Spinner label="배송지 불러오는 중…" />
              ) : addresses.error ? (
                <ApiErrorAlert error={addresses.error} onRetry={() => void addresses.refetch()} />
              ) : (
                <Select
                  label="등록 배송지"
                  required
                  options={activeAddresses.map((a) => ({ value: String(a.id), label: `${a.label}${a.is_default ? ' (기본)' : ''} — ${a.address1} ${a.address2 ?? ''}` }))}
                  placeholder={customer ? (activeAddresses.length ? '선택' : '활성 배송지 없음 — 직접 입력') : '거래처를 먼저 선택'}
                  disabled={!customer}
                  error={err.address_id?.message}
                  {...register('address_id')}
                />
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:col-span-2 md:grid-cols-2">
              <Input label="수령인" maxLength={50} error={err.ship_to?.receiver?.message} {...register('ship_to.receiver')} />
              <Input label="연락처" maxLength={30} error={err.ship_to?.phone?.message} {...register('ship_to.phone')} />
              <Input label="우편번호" maxLength={10} error={err.ship_to?.postal_code?.message} {...register('ship_to.postal_code')} />
              <Input label="주소" required maxLength={200} error={err.ship_to?.address1?.message} {...register('ship_to.address1')} />
              <Input label="상세 주소" maxLength={200} wrapperClassName="md:col-span-2" error={err.ship_to?.address2?.message} {...register('ship_to.address2')} />
            </div>
          )}
        </div>
        <Textarea label="비고" wrapperClassName="mt-4" rows={3} error={err.memo?.message} {...register('memo')} />
      </section>

      <section className="rounded-ad border border-line bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-ad-lg font-semibold">라인 ({fields.length})</h2>
          <Button variant="secondary" size="sm" onClick={() => append({ ...EMPTY_LINE })}>
            라인 추가
          </Button>
        </div>
        {err.lines?.root?.message || (typeof err.lines?.message === 'string' ? err.lines.message : null) ? <p className="mb-2 text-ad-xs text-status-error-fg">{err.lines?.root?.message ?? err.lines?.message}</p> : null}
        <div className="overflow-visible">
          <table className="w-full border-collapse text-ad-body">
            <thead className="bg-surface-2 text-ad-xs font-semibold text-ink-muted">
              <tr>
                <th className="px-2 py-2 text-left">#</th>
                <th className="min-w-64 px-2 py-2 text-left">품목</th>
                <th className="px-2 py-2 text-left">규격 · 색상</th>
                <th className="min-w-40 px-2 py-2 text-left">가공방식</th>
                <th className="min-w-28 px-2 py-2 text-left">수량</th>
                <th className="min-w-32 px-2 py-2 text-left">단가(선택)</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {fields.map((f, i) => {
                const le = err.lines?.[i]
                const item = lines[i]?.item ?? null
                return (
                  <tr key={f.id} className="border-t border-line align-top">
                    <td className="px-2 py-2 tabular-nums text-ink-muted">{i + 1}</td>
                    <td className="px-2 py-2">
                      <Controller
                        control={control}
                        name={`lines.${i}.item`}
                        render={({ field }) => (
                          <SearchSelect<Item | NonNullable<Form['lines'][number]['item']>>
                            value={field.value}
                            onChange={(it) => field.onChange(it ? { id: it.id, code: it.code, name: it.name, spec: it.spec, color: it.color } : null)}
                            search={searchI}
                            getKey={(it) => it.id}
                            getLabel={(it) => itemLabel(it as Item)}
                            renderOption={(it) => (
                              <span>
                                <CodeText code={it.code} /> {it.name}
                                <span className="ml-1 text-ad-xs text-ink-muted">{[it.spec, it.color].filter(Boolean).join(' · ')}</span>
                              </span>
                            )}
                            errorText={apiErrorText}
                            ariaLabel={`라인 ${i + 1} 품목`}
                            placeholder="품목 코드·명 검색"
                            error={le?.item?.message}
                          />
                        )}
                      />
                      {lines[i]?.id !== undefined ? <span className="text-ad-xs text-ink-faint">라인 id {lines[i]?.id}</span> : null}
                    </td>
                    <td className="px-2 py-2 text-ink-muted">{item ? [item.spec, item.color].filter(Boolean).join(' · ') || '—' : '—'}</td>
                    <td className="px-2 py-2">
                      <Select aria-label={`라인 ${i + 1} 가공방식`} options={pmOptions} placeholder="선택" error={le?.print_method?.message} hint={lines[i]?.print_method === 'NONE' ? '도안 불필요' : undefined} {...register(`lines.${i}.print_method`)} />
                    </td>
                    <td className="px-2 py-2">
                      <NumberInput aria-label={`라인 ${i + 1} 수량`} min={1} step={1} error={le?.qty?.message} {...register(`lines.${i}.qty`, { setValueAs: numOrUndef })} />
                    </td>
                    <td className="px-2 py-2">
                      <NumberInput aria-label={`라인 ${i + 1} 단가`} min={0} step={0.01} unit="원" error={le?.unit_price?.message} {...register(`lines.${i}.unit_price`, { setValueAs: numOrUndef })} />
                    </td>
                    <td className="px-2 py-2">
                      <Button size="sm" variant="ghost" disabled={fields.length <= 1} onClick={() => remove(i)} aria-label={`라인 ${i + 1} 삭제`}>
                        삭제
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-ad-xs text-ink-muted">도안은 등록 후 수주 상세(ADM-14)에서 라인별로 업로드한다. 착수한 WO 가 있는 라인의 수량 변경은 409 STATE_CONFLICT (A2-05)</p>
      </section>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={() => navigate(isEdit ? `/admin/so/${encodeURIComponent(initial.code)}` : '/admin/so')}>
          취소
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          {isEdit ? '저장' : '수주 등록'}
        </Button>
      </div>
    </form>
  )
}

export function SalesOrderFormPage() {
  const { code } = useParams<{ code?: string }>()
  const { role } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const isEdit = code !== undefined
  const so = useApiQuery<SalesOrderDetail>(['res', 'so', 'one', code], () => soApi.get(code!), isEdit)
  const pms = useArray<PrintMethod>('print-methods')
  const write = canWrite(role, 'so')
  const title = isEdit ? `수주 수정 — ${code}` : '수주 등록'
  return (
    <>
      <PageHeader
        title={title}
        breadcrumb={
          <>
            <Link to="/admin/so" className="hover:underline">
              수주
            </Link>{' '}
            › {isEdit ? '수정' : '등록'} (ADM-13)
          </>
        }
        description={isEdit ? '납기·배송지·비고·라인(미착수만) 변경' : '헤더 + 라인(품목·가공방식·수량·단가). 코드(SO-YYMMDD-NNNN)는 서버 채번'}
      />
      {!write ? <ErrorAlert title="접근 권한이 없습니다" message="수주 등록·변경은 ADMIN/MANAGER/SALES 만 할 수 있습니다" /> : null}
      {pms.error ? <ApiErrorAlert error={pms.error} onRetry={() => void pms.refetch()} /> : null}
      {write && !pms.loading && pms.data ? (
        isEdit ? (
          so.loading ? (
            <div className="flex justify-center py-12">
              <Spinner label="불러오는 중…" />
            </div>
          ) : so.error ? (
            <ApiErrorAlert error={so.error} onRetry={() => void so.refetch()} />
          ) : so.data ? (
            <SoForm
              initial={so.data}
              printMethods={pms.data}
              onSaved={(c) => {
                toast.success('저장되었습니다')
                navigate(`/admin/so/${encodeURIComponent(c)}`)
              }}
            />
          ) : null
        ) : (
          <SoForm
            initial={null}
            printMethods={pms.data}
            onSaved={(c) => {
              toast.success(`수주 ${c} 등록`)
              navigate(`/admin/so/${encodeURIComponent(c)}`)
            }}
          />
        )
      ) : pms.loading ? (
        <div className="flex justify-center py-12">
          <Spinner label="불러오는 중…" />
        </div>
      ) : null}
    </>
  )
}

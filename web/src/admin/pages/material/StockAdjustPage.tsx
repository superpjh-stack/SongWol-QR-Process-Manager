/**
 * ADM-20 재고 조정 (A3-06) — [S3-5]
 * `/admin/material/stock/adjust?item_id=` → `POST /stock/adjust {item_id, qty_delta, reason}` → StockTxn. ADMIN/MANAGER 전용.
 * `source` 는 서버가 NEW/COUNT 로 기록 — 실사(COUNT) 지정 방법이 계약에 없다 (§3 #12).
 */
import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, ErrorAlert, NumberInput, PageHeader, SearchSelect, Spinner, useToast } from '@/shared/ui/admin'
import { useApiMutation, useAuth, useList, useOne } from '@/shared/hooks'
import { stockApi } from '@/shared/api'
import type { Item, StockAdjust, StockRow } from '@/shared/types'
import { formatQty } from '../../format'
import { canWrite } from '../../permissions'
import { ApiErrorAlert, Textarea, useFormApiError, zx } from '../../components'
import { apiErrorText, itemLabel, searchItems } from './itemSearch'
import { previewStock } from './stockAdjust'

const itemRef = z.object({ id: z.number(), code: z.string(), name: z.string() })
const schema = z
  .object({
    item: itemRef.nullable(),
    qty_delta: z.number({ error: '수량을 입력하세요' }).int('정수'),
    reason: zx.req(200, '사유'),
  })
  .superRefine((v, ctx) => {
    if (v.item === null) ctx.addIssue({ code: 'custom', path: ['item'], message: '품목을 선택하세요' })
    if (v.qty_delta === 0) ctx.addIssue({ code: 'custom', path: ['qty_delta'], message: '0 이 아닌 값을 입력하세요 (CHECK ≠ 0)' })
  })
type Form = z.infer<typeof schema>
const FIELDS = ['item_id', 'qty_delta', 'reason']

export function StockAdjustPage() {
  const { role } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [sp] = useSearchParams()
  const write = canWrite(role, 'material.adjust')
  const initialItemId = sp.get('item_id')
  const initialItem = useOne<Item>('items', initialItemId)

  const { control, register, handleSubmit, setError, watch, setValue, formState } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { item: null, qty_delta: 0, reason: '' },
  })
  const { topError, apply, clear } = useFormApiError<Form>(setError, FIELDS)
  const item = watch('item')
  const qtyDelta = watch('qty_delta')

  useEffect(() => {
    if (initialItem.data && item === null) setValue('item', { id: initialItem.data.id, code: initialItem.data.code, name: initialItem.data.name })
  }, [initialItem.data, item, setValue])

  const stock = useList<StockRow>('stock', { q: item?.code, size: 5 }, item !== null)
  const stockRow = (stock.data?.items ?? []).find((r) => r.item_id === item?.id) ?? null
  const current = stockRow?.qty_on_hand ?? null
  const preview = previewStock(current, Number.isFinite(qtyDelta) ? qtyDelta : null)

  const adjust = useApiMutation((body: StockAdjust) => stockApi.adjust(body))

  const onSubmit = handleSubmit(async (v) => {
    clear()
    try {
      await adjust.mutate({ item_id: v.item!.id, qty_delta: v.qty_delta, reason: v.reason.trim() })
      toast.success(`조정 ${v.qty_delta > 0 ? '+' : ''}${v.qty_delta} 반영`)
      navigate(`/admin/material/txns?item_id=${v.item!.id}`)
    } catch (e) {
      apply(e)
    }
  })
  const err = formState.errors

  return (
    <>
      <PageHeader title="재고 조정" breadcrumb="입고·재고 › 재고 조정 (ADM-20)" description="qty_delta 는 ± 허용, 0 은 저장되지 않습니다 (CHECK ≠ 0). audit_log 필수 (spec §13)" />
      {!write ? (
        <ErrorAlert title="접근 권한이 없습니다" message="재고 조정은 ADMIN/MANAGER 만 할 수 있습니다" />
      ) : (
        <form onSubmit={onSubmit} noValidate className="max-w-xl space-y-4 rounded-ad border border-line bg-surface p-4">
          {topError ? <ApiErrorAlert error={topError} /> : null}
          <Controller
            control={control}
            name="item"
            render={({ field }) => (
              <SearchSelect<Item | NonNullable<Form['item']>>
                label="품목"
                required
                value={field.value}
                onChange={(v) => field.onChange(v ? { id: v.id, code: v.code, name: v.name } : null)}
                search={searchItems}
                getKey={(i) => i.id}
                getLabel={(i) => itemLabel(i as Item)}
                errorText={apiErrorText}
                error={err.item?.message}
              />
            )}
          />
          {item ? (
            stock.loading ? (
              <Spinner label="현재고 확인 중…" />
            ) : stock.error ? (
              <ApiErrorAlert error={stock.error} onRetry={() => void stock.refetch()} />
            ) : (
              <p className="text-ad-body">
                현재고 <span className="font-semibold tabular-nums">{formatQty(current)}</span>
                {preview !== null ? (
                  <>
                    {' '}
                    → 조정 후 <span className="font-semibold tabular-nums">{formatQty(preview)}</span>
                  </>
                ) : null}
              </p>
            )
          ) : null}
          <NumberInput label="조정 수량 (qty_delta)" required hint="± 허용, 0 은 저장되지 않습니다" error={err.qty_delta?.message} {...register('qty_delta', { valueAsNumber: true })} />
          <Textarea label="사유" required maxLength={200} error={err.reason?.message} hint="ADJUST 는 사유 필수 (stock_txn.reason)" {...register('reason')} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" type="button" onClick={() => navigate('/admin/material/stock')}>
              취소
            </Button>
            <Button type="submit" variant="primary" loading={adjust.loading}>
              저장
            </Button>
          </div>
        </form>
      )}
    </>
  )
}

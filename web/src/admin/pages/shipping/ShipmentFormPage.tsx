/**
 * ADM-23 발송 등록 (A4-02·03·04) — [S3-7]
 * 주 경로는 PDA/터치PC(§9.3). 웹은 같은 API 로 만든다 — `POST /shipments {so_code?, box_codes[], tracking_no, carrier?, confirm:true}`.
 * so_code 를 주면 `GET /boxes?so_code&unshipped=true` 로 미발송 박스를 자동 로드한다. ADMIN/MANAGER 전용.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, ErrorAlert, Input, PageHeader, SearchSelect, useToast } from '@/shared/ui/admin'
import { useApiMutation, useApiQuery, useAuth } from '@/shared/hooks'
import { boxesApi, shipmentsApi, soApi } from '@/shared/api'
import type { PackBox, SalesOrderDetail, SalesOrderSummary, ShipmentCreate } from '@/shared/types'
import { formatQty } from '../../format'
import { canWrite } from '../../permissions'
import { ApiErrorAlert, CodeText } from '../../components'
import { addBoxCode, removeBoxCode } from './boxCodes'

const searchSo = async (q: string): Promise<SalesOrderSummary[]> => (await soApi.list({ q, size: 20 })).items
const soLabel = (s: SalesOrderSummary) => `${s.code} ${s.customer.name ?? ''}`

export function ShipmentFormPage() {
  const { role } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const write = canWrite(role, 'shipping.new')
  const [sp] = useSearchParams()
  const initialSoCode = sp.get('so_code')

  const [so, setSo] = useState<SalesOrderSummary | null>(null)
  const [boxCodes, setBoxCodes] = useState<string[]>([])
  const [scanInput, setScanInput] = useState('')
  const [trackingNo, setTrackingNo] = useState('')
  const [carrier, setCarrier] = useState('')
  const [submitError, setSubmitError] = useState<unknown>(null)

  const initialSo = useApiQuery<SalesOrderDetail>(['res', 'so', 'one', initialSoCode ?? ''], () => soApi.get(initialSoCode!), Boolean(initialSoCode))
  useEffect(() => {
    if (initialSo.data && so === null) setSo(initialSo.data)
  }, [initialSo.data, so])

  const unshipped = useApiQuery<PackBox[]>(['boxes', 'unshipped', so?.code ?? ''], async () => (await boxesApi.list({ so_code: so!.code, unshipped: true, size: 200 })).items, so !== null)

  const create = useApiMutation((body: ShipmentCreate) => shipmentsApi.create(body))

  const addScan = () => {
    setBoxCodes((prev) => addBoxCode(prev, scanInput))
    setScanInput('')
  }

  const submit = async () => {
    setSubmitError(null)
    if (boxCodes.length === 0) {
      setSubmitError(new Error('박스 코드를 1개 이상 입력하세요'))
      return
    }
    if (!trackingNo.trim()) {
      setSubmitError(new Error('송장번호를 입력하세요'))
      return
    }
    if (trackingNo.trim().length > 40) {
      setSubmitError(new Error('송장번호는 40자 이하입니다'))
      return
    }
    try {
      const body: ShipmentCreate = { box_codes: boxCodes, tracking_no: trackingNo.trim(), confirm: true }
      if (so) body.so_code = so.code
      if (carrier.trim()) body.carrier = carrier.trim()
      const res = await create.mutate(body)
      toast.success(`발송 확정 — 잔량 ${formatQty(res.so_remaining_qty)}`)
      navigate('/admin/shipping')
    } catch (e) {
      setSubmitError(e)
    }
  }

  return (
    <>
      <PageHeader
        title="발송 등록"
        breadcrumb="포장·출하 › 발송 등록 (ADM-23)"
        description="박스 코드 스캔/입력 → 송장번호 → 발송 확정. 같은 SO·같은 송장의 READY 출하가 있으면 합류한다 (api-contract §6.4)"
      />
      {!write ? (
        <ErrorAlert title="접근 권한이 없습니다" message="발송 등록은 ADMIN/MANAGER 만 할 수 있습니다" />
      ) : (
        <div className="max-w-2xl space-y-4 rounded-ad border border-line bg-surface p-4">
          {submitError || create.error ? <ApiErrorAlert error={submitError ?? create.error} /> : null}
          <SearchSelect<SalesOrderSummary>
            label="수주 (선택)"
            value={so}
            onChange={setSo}
            search={searchSo}
            getKey={(s) => s.id}
            getLabel={soLabel}
            hint="선택하면 미발송 박스를 아래에서 고를 수 있습니다"
          />
          {so ? (
            unshipped.loading ? (
              <p className="text-ad-xs text-ink-muted">미발송 박스 확인 중…</p>
            ) : unshipped.error ? (
              <ApiErrorAlert error={unshipped.error} onRetry={() => void unshipped.refetch()} />
            ) : (unshipped.data ?? []).length > 0 ? (
              <div>
                <p className="mb-1 text-ad-xs text-ink-muted">
                  {so.code} 미발송 박스 {unshipped.data!.length}건 — 클릭해 추가
                </p>
                <div className="flex flex-wrap gap-1">
                  {unshipped.data!.map((b) => (
                    <button
                      key={b.code}
                      type="button"
                      disabled={boxCodes.includes(b.code)}
                      onClick={() => setBoxCodes((prev) => addBoxCode(prev, b.code))}
                      className="rounded-full border border-line px-2 py-1 text-ad-xs hover:bg-surface-3 disabled:opacity-40"
                    >
                      <CodeText code={b.code} /> ({formatQty(b.qty)})
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-ad-xs text-ink-muted">{so.code} 미발송 박스가 없습니다</p>
            )
          ) : null}

          <Input
            label="박스 코드 입력"
            placeholder="LT-… (스캐너 또는 타이핑, Enter 로 추가)"
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addScan()
              }
            }}
            hint="연속으로 스캔·입력할 수 있습니다"
          />
          <div className="flex flex-wrap gap-1">
            {boxCodes.length === 0 ? (
              <span className="text-ad-xs text-ink-faint">추가된 박스가 없습니다</span>
            ) : (
              boxCodes.map((c) => (
                <span key={c} className="flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2 py-1 text-ad-xs">
                  <CodeText code={c} />
                  <button type="button" onClick={() => setBoxCodes((prev) => removeBoxCode(prev, c))} aria-label={`${c} 제거`} className="text-ink-muted hover:text-status-error-fg">
                    ×
                  </button>
                </span>
              ))
            )}
          </div>

          <Input label="송장번호" required maxLength={40} value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} />
          <Input label="택배사" maxLength={20} value={carrier} onChange={(e) => setCarrier(e.target.value)} hint="비우면 거래처 기본 택배사 (default_carrier)" />

          <div className="flex items-center justify-between border-t border-line pt-3 text-ad-body">
            <span className="text-ink-muted">박스 {boxCodes.length}건</span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => navigate('/admin/shipping')}>
                취소
              </Button>
              <Button variant="primary" loading={create.loading} onClick={() => void submit()}>
                발송 확정
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

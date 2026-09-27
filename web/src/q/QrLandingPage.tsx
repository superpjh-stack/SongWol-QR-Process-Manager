/**
 * QRL-01 QR 착지 조회 페이지 — `/q/:code?c=` (spec §9.4, api-contract §10). 비로그인 읽기 전용, 로그인 시 allowed_actions 버튼.
 * 휴대폰 세로(MobilePage, density-shopfloor). useScannerInput 없음 (카메라로 URL 을 연다). 단말 키 안 씀.
 * 401(토큰 만료) → 비로그인 표시로 전환 + [로그인]. 400 BAD_CHECKCODE/BAD_CODE_FORMAT → 「유효하지 않은 코드」 (재시도 없음).
 */
import { useEffect } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { BigButton, MobileCard, MobilePage, WarnBanner } from '@/shared/ui/shopfloor'
import { StatusBadge } from '@/shared/ui'
import { Spinner } from '@/shared/ui/admin'
import { useApiMutation, useApiQuery, useAuth } from '@/shared/hooks'
import { ApiError, pdfApi, qApi, toErrorView } from '@/shared/api'
import type { AllowedAction, QrLanding } from '@/shared/types'
import { AllowedActionLabel, PrintMethodCodeLabel, RoleLabel, TargetTypeLabel } from '@/shared/labels'
import { formatDate, formatDateTime, formatQty } from '@/admin/format'
import { ProgressBar } from '@/shared/ui/admin'
import { AuthImage } from '@/admin/components'
import { ACTION_SPRINT, classifyLanding, detailPathOf, hasPdf, isActionEnabledInS1, type LandingView } from './landing'

function Body({ v }: { v: LandingView }) {
  switch (v.kind) {
    case 'SO': {
      const s = v.summary
      return (
        <>
          <MobileCard
            items={[
              { label: '거래처', value: s.customer.name ?? s.customer.code },
              { label: '수주일', value: formatDate(s.order_date) },
              { label: '납기일', value: formatDate(s.due_date) },
              { label: '라인 / WO', value: `${s.line_count} / ${s.wo_count}` },
              { label: '확정', value: formatDateTime(s.confirmed_at) },
              { label: '발송', value: formatDateTime(s.shipped_at) },
            ]}
          />
          <MobileCard title="진행률">
            <ProgressBar value={s.progress_pct} size="md" />
            {s.delay_risk ? (
              <div className="mt-2">
                <StatusBadge kind="delay" status={true} density="shopfloor" />
              </div>
            ) : null}
          </MobileCard>
        </>
      )
    }
    case 'WO': {
      const w = v.summary
      return (
        <>
          <MobileCard
            items={[
              ...(w.parent_wo_code ? [{ label: '상위 WO', value: <span className="font-mono">{w.parent_wo_code}</span> }] : []),
              { label: '수주', value: <span className="font-mono">{w.so_code}</span> },
              { label: '거래처', value: w.customer_name },
              { label: '품목', value: w.item.name ?? w.item.code },
              { label: '규격 · 색상', value: [w.item.spec, w.item.color].filter(Boolean).join(' · ') },
              { label: '가공방식', value: PrintMethodCodeLabel[w.print_method] ?? w.print_method },
              { label: '현재 공정', value: w.current_process_code ?? '—' },
              { label: '납기일', value: formatDate(w.due_date) },
            ]}
          />
          <MobileCard
            title="수량"
            items={[
              { label: '지시', value: formatQty(w.qty_ordered) },
              { label: '입고', value: <span className="inline-flex items-center gap-2">{formatQty(w.qty_received)} <StatusBadge kind="receipt" status={w.receipt_status} /></span> },
              { label: '양품 / 불량', value: `${formatQty(w.qty_good)} / ${formatQty(w.qty_bad)}` },
              { label: '포장 / 발송', value: `${formatQty(w.qty_packed)} / ${formatQty(w.qty_shipped)}` },
            ]}
          />
          {w.delay_risk ? <StatusBadge kind="delay" status={true} density="shopfloor" /> : null}
          {w.design_thumbnail_url ? (
            <MobileCard title={`도안 v${w.design_version ?? ''}`}>
              <AuthImage src={w.design_thumbnail_url} alt="도안" className="mx-auto max-h-48 rounded-sf border border-line object-contain" />
            </MobileCard>
          ) : null}
        </>
      )
    }
    case 'LT_PACK': {
      const b = v.summary
      return (
        <MobileCard
          title="포장 박스"
          items={[
            { label: 'WO', value: <span className="font-mono">{b.wo_code}</span> },
            { label: '박스 No', value: b.box_no },
            { label: '수량', value: formatQty(b.qty) },
            { label: '포장 시각', value: formatDateTime(b.packed_at) },
            { label: '발송', value: b.shipment_id !== null ? '발송 완료' : '미발송' },
          ]}
        />
      )
    }
    case 'LT_INBOUND': {
      const l = v.summary
      return (
        <MobileCard
          title="입고 LOT"
          items={[
            { label: '품목', value: l.item.name ?? l.item.code },
            { label: '협력업체', value: l.vendor },
            { label: '입고 시각', value: formatDateTime(l.received_at) },
            { label: '수량', value: formatQty(l.qty) },
            { label: '상태', value: <StatusBadge kind="lot" status={l.status} /> },
          ]}
        />
      )
    }
    case 'US': {
      const u = v.summary
      return <MobileCard title="작업자 카드" items={[{ label: '이름', value: u.name }, { label: '역할', value: RoleLabel[u.role] }, { label: '카드', value: <span className="font-mono">{u.card_code ?? '—'}</span> }]} />
    }
    default:
      return <MobileCard title="알 수 없는 유형">{JSON.stringify(v.summary)}</MobileCard>
  }
}

function badgeOf(v: LandingView) {
  switch (v.kind) {
    case 'SO':
      return <StatusBadge kind="so" status={v.summary.status} density="shopfloor" />
    case 'WO':
      return <StatusBadge kind="wo" status={v.summary.status} density="shopfloor" />
    case 'LT_INBOUND':
      return <StatusBadge kind="lot" status={v.summary.status} density="shopfloor" />
    case 'LT_PACK':
      return <StatusBadge kind="step" status="DONE" density="shopfloor" labelOverride={v.summary.shipment_id !== null ? '발송 완료' : '포장 완료'} />
    case 'US':
      return <StatusBadge kind="role" status={v.summary.role} density="shopfloor" />
    default:
      return null
  }
}

export function QrLandingPage() {
  const { code = '' } = useParams<{ code: string }>()
  const [sp] = useSearchParams()
  const check = sp.get('c')
  const auth = useAuth()
  const navigate = useNavigate()
  const authSettled = auth.status !== 'idle' && auth.status !== 'loading'
  // 로그인 여부에 따라 응답 필드가 다르다 (admin #30) → 키에 포함
  const landing = useApiQuery<QrLanding>(['q', code, check, auth.isAuthenticated], () => qApi.landing(code, check), code !== '' && authSettled)
  const pdf = useApiMutation((v: LandingView) => (v.kind === 'SO' ? pdfApi.salesOrder(code) : pdfApi.workOrder(code)))
  const loginTo = `/login?next=${encodeURIComponent(`/q/${code}${check ? `?c=${check}` : ''}`)}`

  // 401 (로그인 후 만료): client 가 토큰을 지우고 anon 으로 바꿨다 → 비로그인으로 재조회
  useEffect(() => {
    if (landing.error instanceof ApiError && landing.error.status === 401 && !auth.isAuthenticated) void landing.refetch()
  }, [landing.error, auth.isAuthenticated])

  const view = landing.data ? classifyLanding(landing.data) : null
  const expired = landing.error instanceof ApiError && landing.error.status === 401
  const err = landing.error && !expired ? toErrorView(landing.error) : null
  const invalid = landing.error instanceof ApiError && landing.error.status === 400

  return (
    <MobilePage
      code={code}
      typeLabel={landing.data ? TargetTypeLabel[landing.data.type] : 'QR 조회'}
      badge={view ? badgeOf(view) : null}
      banner={
        err ? (
          <WarnBanner
            kind="error"
            message={invalid ? '유효하지 않은 코드 — 라벨 오염·오타를 확인하세요' : err.message}
            {...(err.retryable ? { action: { label: '다시 시도', onClick: () => void landing.refetch() } } : {})}
          />
        ) : auth.status === 'anon' && landing.data ? (
          <WarnBanner kind="warning" message="읽기 전용 — 로그인하면 담당 액션이 표시됩니다" />
        ) : null
      }
      actions={
        <>
          {auth.isAuthenticated && landing.data && view ? (
            <>
              {landing.data.allowed_actions.map((a: AllowedAction) =>
                a === 'VIEW_DETAIL' ? (
                  <BigButton key={a} fullWidth onClick={() => navigate(detailPathOf(view, code))}>
                    {AllowedActionLabel[a]}
                  </BigButton>
                ) : (
                  <BigButton key={a} fullWidth variant="secondary" disabled title={`${ACTION_SPRINT[a]} 에서 동작`}>
                    {AllowedActionLabel[a]} {isActionEnabledInS1(a) ? '' : ACTION_SPRINT[a]}
                  </BigButton>
                ),
              )}
              {hasPdf(view) ? (
                <BigButton fullWidth variant="secondary" loading={pdf.loading} onClick={() => void pdf.mutate(view).catch(() => undefined)}>
                  작업지시서 PDF
                </BigButton>
              ) : null}
              {landing.data.allowed_actions.length === 0 && !hasPdf(view) ? <p className="text-center text-sf-body text-ink-muted">이 역할에 허용된 액션이 없습니다</p> : null}
            </>
          ) : auth.status === 'anon' || expired ? (
            <Link to={loginTo} className="block">
              <BigButton fullWidth variant="secondary">
                로그인
              </BigButton>
            </Link>
          ) : null}
        </>
      }
    >
      {pdf.error ? <WarnBanner kind="error" message={toErrorView(pdf.error).message} action={{ label: '다시 시도', onClick: () => view && void pdf.mutate(view).catch(() => undefined) }} /> : null}
      {landing.loading || !authSettled ? (
        <div className="flex justify-center py-10">
          <Spinner size={32} label="조회 중…" />
        </div>
      ) : view ? (
        <Body v={view} />
      ) : null}
      {auth.isAuthenticated && auth.user ? (
        <p className="text-center text-sf-body text-ink-muted">
          {auth.user.name} ({RoleLabel[auth.user.role]}) 로 로그인됨
        </p>
      ) : null}
    </MobilePage>
  )
}

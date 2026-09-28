/**
 * 스캔 결과 카드 — WO 요약 (spec §9.2 스캔 결과, B2-07 다음 작업 안내).
 * 액션 버튼(시작/완료·설비 선택)은 화면이 `children`(footer 슬롯)으로 넣는다.
 *
 * `variant` 를 주면 상단에 결과 띠(색+아이콘+문구, §0.7)가 붙는다 — ok/warn/approval/reject 는 기존
 * 9종 상태색(done/warn/error)을 그대로 재사용하고, saved(오프라인 저장)는 새 CSS 토큰을 만들지 않고
 * 기존 회색 계열(skipped tone)을 재사용했다(디자인 에이전트 권한 밖 — tokens.css 는 건드리지 않는다).
 * `autoDismissMs` 를 주면 원형 카운트다운 후 `onDismiss` 를 부른다(OK·saved 는 2000ms, 그 외는 생략해
 * 탭까지 유지한다 — spec §0.7).
 */
import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { cn } from '../cn'
import { IconCheck, IconImage, IconKey, IconSave, IconWarning, IconX } from '../icons'
import { StatusBadge } from '../StatusBadge'
import { TONE_CLASS, type StatusTone, type StepStatus, type WoStatus } from '../status'

export type ScanResultWo = {
  code: string
  customerName: string
  itemName: string
  /** 규격 (예: 40×80) */
  spec?: string | undefined
  color?: string | undefined
  qty: number
  /** 가공방식 명 (예: 나염, 전사+자수) */
  printMethod: string
  /** 도안 썸네일 URL. 없으면 자리만 표시 */
  designThumbUrl?: string | undefined
  /** 응답의 next_process 를 화면이 공정명으로 바꿔 넣는다 */
  nextProcessName?: string | undefined
  /** 응답의 remaining_qty */
  remainingQty?: number | undefined
  /** 이 공정 단계 상태 */
  stepStatus?: StepStatus | undefined
  woStatus?: WoStatus | undefined
  /** spec §4.4 "인쇄 중 (자수 대기)" 같은 단계 문구 대체 */
  stepLabelOverride?: string | undefined
  dueDate?: string | undefined
}

/** api-contract §3.3 result × requires_approval × 오프라인 4+1 분기 (§0.7) */
export type ScanResultVariant = 'ok' | 'warn' | 'approval' | 'reject' | 'saved'

const VARIANT_META: Record<ScanResultVariant, { tone: StatusTone; Icon: ComponentType<{ size?: number | string; className?: string }>; title: string }> = {
  ok: { tone: 'done', Icon: IconCheck, title: '완료' },
  warn: { tone: 'warn', Icon: IconWarning, title: '확인이 필요합니다' },
  approval: { tone: 'warn', Icon: IconKey, title: '반장 승인 필요' },
  reject: { tone: 'error', Icon: IconX, title: '반영되지 않았습니다' },
  saved: { tone: 'skipped', Icon: IconSave, title: '저장됨 (미전송)' },
}

function CountdownRing({ ms, onComplete, className }: { ms: number; onComplete?: (() => void) | undefined; className?: string | undefined }) {
  const [go, setGo] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setGo(true))
    const t = window.setTimeout(() => onComplete?.(), ms)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(t)
    }
    // ms·onComplete 는 마운트 시점 값으로 고정 — 카드가 다시 뜨면 key 를 바꿔 새로 마운트한다
  }, [])
  const r = 18
  const c = 2 * Math.PI * r
  return (
    <svg width={44} height={44} viewBox="0 0 44 44" className={className} aria-hidden="true">
      <circle cx={22} cy={22} r={r} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={4} />
      <circle
        cx={22}
        cy={22}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={go ? c : 0}
        style={{ transition: `stroke-dashoffset ${ms}ms linear` }}
        transform="rotate(-90 22 22)"
      />
    </svg>
  )
}

export type ScanResultCardProps = {
  wo: ScanResultWo
  /** 결과 색 변형 (§0.7). 생략하면 기존처럼 중립 카드만 그린다 */
  variant?: ScanResultVariant
  /** ScanResponse.message 그대로 — 작업자용 한국어 문구를 그대로 보여준다 */
  message?: string
  /** ScanResponse.warnings[] — 주황 줄로 각각 나열 */
  warnings?: string[]
  /** OK·saved 는 2000, 그 외 undefined 로 두면 탭까지 유지된다 (§0.7) */
  autoDismissMs?: number | undefined
  onDismiss?: () => void
  /** 하단 액션 슬롯 */
  children?: ReactNode
  className?: string
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="w-[88px] shrink-0 text-sf-body text-ink-muted">{k}</dt>
      <dd className="min-w-0 truncate text-sf-lg font-semibold">{v ?? '—'}</dd>
    </div>
  )
}

export function ScanResultCard({ wo, variant, message, warnings, autoDismissMs, onDismiss, children, className }: ScanResultCardProps) {
  const meta = variant ? VARIANT_META[variant] : null
  return (
    <section
      className={cn('flex flex-col gap-4 rounded-sf border-2 border-line bg-surface p-5 shadow-card', className)}
      data-component="ScanResultCard"
      data-variant={variant}
      aria-label={`작업지시 ${wo.code}`}
    >
      {meta ? (
        <div
          className={cn('flex items-center gap-3 rounded-sf px-4 py-3', TONE_CLASS[meta.tone])}
          role={variant === 'reject' ? 'alert' : 'status'}
          aria-live={variant === 'reject' ? 'assertive' : 'polite'}
        >
          <meta.Icon size={32} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sf-lg font-bold">{meta.title}</div>
            {message ? <div className="text-sf-body">{message}</div> : null}
            {warnings && warnings.length > 0 ? (
              <ul className="mt-1 list-inside list-disc text-sf-body">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            ) : null}
          </div>
          {autoDismissMs !== undefined ? <CountdownRing key={autoDismissMs} ms={autoDismissMs} onComplete={onDismiss} className="shrink-0" /> : null}
        </div>
      ) : null}

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-mono text-sf-xl font-bold tracking-tight">{wo.code}</div>
        <div className="flex flex-wrap gap-2">
          {wo.stepStatus ? (
            <StatusBadge kind="step" status={wo.stepStatus} density="shopfloor" labelOverride={wo.stepLabelOverride} />
          ) : null}
          {wo.woStatus ? <StatusBadge kind="wo" status={wo.woStatus} density="shopfloor" /> : null}
        </div>
      </header>

      <div className="flex gap-5">
        <dl className="flex min-w-0 flex-1 flex-col gap-2">
          <Row k="거래처" v={wo.customerName} />
          <Row k="품목" v={wo.itemName} />
          <Row k="규격·색상" v={[wo.spec, wo.color].filter(Boolean).join(' · ') || undefined} />
          <Row k="수량" v={<span className="tabular-nums">{wo.qty.toLocaleString('ko-KR')}</span>} />
          <Row k="가공방식" v={wo.printMethod} />
          {wo.dueDate ? <Row k="납기" v={wo.dueDate} /> : null}
        </dl>
        <figure
          className="flex h-[160px] w-[160px] shrink-0 items-center justify-center overflow-hidden rounded-sf border-2 border-dashed border-line bg-surface-2 text-ink-faint"
          aria-label="도안 썸네일"
        >
          {wo.designThumbUrl ? (
            <img src={wo.designThumbUrl} alt="도안" className="h-full w-full object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-1 text-sf-body">
              <IconImage size={40} />
              <span>도안 없음</span>
            </div>
          )}
        </figure>
      </div>

      {wo.nextProcessName !== undefined || wo.remainingQty !== undefined ? (
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-sf bg-brand-50 px-5 py-3 text-sf-lg">
          {wo.nextProcessName !== undefined ? (
            <span>
              <span className="text-ink-muted">다음 공정 </span>
              <strong className="text-brand-700">{wo.nextProcessName}</strong>
            </span>
          ) : null}
          {wo.remainingQty !== undefined ? (
            <span>
              <span className="text-ink-muted">잔량 </span>
              <strong className="tabular-nums text-brand-700">{wo.remainingQty.toLocaleString('ko-KR')}</strong>
            </span>
          ) : null}
        </div>
      ) : null}

      {children ? <footer className="flex flex-wrap gap-touch-gap pt-1">{children}</footer> : null}
    </section>
  )
}

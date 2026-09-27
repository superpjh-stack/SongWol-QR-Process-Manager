/**
 * 스캔 결과 카드 — WO 요약 (spec §9.2 스캔 결과, B2-07 다음 작업 안내).
 * 액션 버튼(시작/완료·설비 선택)은 화면이 `children`(footer 슬롯)으로 넣는다.
 */
import type { ReactNode } from 'react'
import { cn } from '../cn'
import { IconImage } from '../icons'
import { StatusBadge } from '../StatusBadge'
import type { StepStatus, WoStatus } from '../status'

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

export type ScanResultCardProps = {
  wo: ScanResultWo
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

export function ScanResultCard({ wo, children, className }: ScanResultCardProps) {
  return (
    <section
      className={cn('flex flex-col gap-4 rounded-sf border-2 border-line bg-surface p-5 shadow-card', className)}
      data-component="ScanResultCard"
      aria-label={`작업지시 ${wo.code}`}
    >
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

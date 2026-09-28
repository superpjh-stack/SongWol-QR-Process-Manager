/**
 * 현황판 KPI 타일 (BRD-01 SO 진행 현황판, screens-shopfloor §3·§4.2 A9).
 * 단일 큰 숫자(예: `output_per_hour_today` 시간당 생산량)는 `value` 로, 한 타일에 여러 숫자를 담아야
 * 하는 항목(예: `today_shipments` {planned, done, overdue})은 `items` 로 넘긴다.
 *
 * 크기: 3m 거리 가독(§3) — 단일 `value` 는 수치 하한 그대로 `text-tv-num`(64px). `items` 복합값은
 * 한 타일 폭에 여러 개를 나란히 담아야 해서 `text-tv-so`(32px, SO 코드 하한과 동일)로 낮췄다 — spec 의
 * "수치 ≥64px" 은 §3 의 4개 필수 표시 항목 기준이고 이 보조 타일들은 계약에 있어 기본값으로 추가한
 * 항목이라 그대로 적용하면 한 타일 안에서 겹친다. 진행 판단은 design-tokens.md·spec 에 기준이 없어
 * 디자인이 내린 기본값이다.
 *
 * `overdue > 0` 처럼 상태에 따른 빨강 등은 화면이 `tone`(전체) 또는 `items[].tone`(항목별)으로 넘긴다 —
 * 이 컴포넌트는 값이 무엇을 의미하는지 모른다(색 로직을 새로 만들지 않고 status.ts 의 tone 팔레트만 재사용).
 */
import type { ReactNode } from 'react'
import { cn } from '../cn'

export type KpiTileTone = 'default' | 'warn' | 'error'

export type KpiTileItem = {
  label: string
  value: ReactNode
  tone?: KpiTileTone | undefined
}

export type KpiTileProps = {
  label: string
  /** 단일 큰 숫자. `items` 와 함께 쓰지 않는다(둘 다 오면 `items` 우선) */
  value?: ReactNode
  /** value 옆에 작게 붙는 단위 (예: "장/시간") */
  unit?: string | undefined
  /** 복합값 — 한 타일에 여러 숫자 (예: 오늘 발송 계획/완료/초과) */
  items?: KpiTileItem[] | undefined
  /** 전체 톤(단일 value 또는 items 기본 톤). 개별 항목은 items[].tone 으로 덮어쓴다 */
  tone?: KpiTileTone | undefined
  className?: string | undefined
}

const TONE_TEXT: Record<KpiTileTone, string> = {
  default: 'text-ink',
  warn: 'text-status-warn-fg',
  error: 'text-status-error-fg',
}

export function KpiTile({ label, value, unit, items, tone = 'default', className }: KpiTileProps) {
  const hasItems = !!items && items.length > 0
  return (
    <div className={cn('flex flex-col gap-2 rounded-sf border-2 border-line bg-surface px-6 py-4', className)} data-component="KpiTile">
      <div className="text-tv-body font-semibold text-ink-muted">{label}</div>
      {hasItems ? (
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-1">
          {items!.map((it, i) => (
            <div key={i} className="flex items-baseline gap-2">
              <span className="text-tv-body text-ink-muted">{it.label}</span>
              <span className={cn('text-tv-so font-bold tabular-nums', TONE_TEXT[it.tone ?? tone])}>{it.value}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className={cn('flex items-baseline gap-2 text-tv-num font-bold tabular-nums', TONE_TEXT[tone])}>
          <span>{value}</span>
          {unit ? <span className="text-tv-so font-semibold text-ink-muted">{unit}</span> : null}
        </div>
      )}
    </div>
  )
}

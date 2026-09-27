/** KPI 카드 (screens-admin §2 #13): 숫자 + 라벨 + 선택 링크 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '../cn'

export type StatCardProps = { label: ReactNode; value: ReactNode; hint?: ReactNode; to?: string | undefined; tone?: 'default' | 'warn' | 'error' | undefined; className?: string | undefined }

const TONE = { default: 'text-ink', warn: 'text-status-warn-fg', error: 'text-status-error-fg' } as const

export function StatCard({ label, value, hint, to, tone = 'default', className }: StatCardProps) {
  const body = (
    <>
      <div className="text-ad-xs font-semibold text-ink-muted">{label}</div>
      <div className={cn('mt-1 text-ad-title font-bold tabular-nums', TONE[tone])}>{value}</div>
      {hint ? <div className="mt-0.5 text-ad-xs text-ink-muted">{hint}</div> : null}
    </>
  )
  const cls = cn('block rounded-ad border border-line bg-surface px-4 py-3', to && 'hover:border-brand-500 hover:bg-brand-50', className)
  return to ? (
    <Link to={to} className={cls} data-component="StatCard">
      {body}
    </Link>
  ) : (
    <div className={cls} data-component="StatCard">
      {body}
    </div>
  )
}

import type { ReactNode } from 'react'
import { cn } from '../cn'

export type PageHeaderProps = {
  title: string
  description?: ReactNode
  /** 우측 액션 버튼 슬롯 */
  actions?: ReactNode
  /** 상단 경로 표시 (예: 기준정보 › 품목) */
  breadcrumb?: ReactNode
  className?: string
}

export function PageHeader({ title, description, actions, breadcrumb, className }: PageHeaderProps) {
  return (
    <header className={cn('mb-4 flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        {breadcrumb ? <div className="mb-1 text-ad-xs text-ink-muted">{breadcrumb}</div> : null}
        <h1 className="text-ad-title font-bold">{title}</h1>
        {description ? <p className="mt-1 text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

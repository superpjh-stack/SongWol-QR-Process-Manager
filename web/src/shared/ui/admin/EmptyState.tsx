import type { ReactNode } from 'react'
import { cn } from '../cn'
import { IconInbox } from '../icons'

export type EmptyStateProps = {
  title: string
  description?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-6 py-12 text-center text-ink-muted', className)}>
      <span className="text-ink-faint">{icon ?? <IconInbox size={40} />}</span>
      <div className="text-ad-lg font-semibold text-ink">{title}</div>
      {description ? <div className="max-w-md">{description}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

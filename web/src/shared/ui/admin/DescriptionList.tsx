/** 상세 헤더 key-value (screens-admin §2 #10). 2~3열 그리드, 긴 값은 `span` 으로 전폭 */
import type { ReactNode } from 'react'
import { cn } from '../cn'

export type DescriptionItem = { label: ReactNode; value: ReactNode; span?: boolean | undefined }

export type DescriptionListProps = { items: DescriptionItem[]; cols?: 2 | 3 | 4; className?: string | undefined; dense?: boolean | undefined }

const COLS = { 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4' } as const

export function DescriptionList({ items, cols = 3, className, dense }: DescriptionListProps) {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6', dense ? 'gap-y-1.5' : 'gap-y-3', COLS[cols], className)} data-component="DescriptionList">
      {items.map((it, i) => (
        <div key={i} className={cn('min-w-0', it.span && 'md:col-span-full')}>
          <dt className="text-ad-xs font-semibold text-ink-muted">{it.label}</dt>
          <dd className="mt-0.5 break-words">{it.value === null || it.value === undefined || it.value === '' ? <span className="text-ink-faint">—</span> : it.value}</dd>
        </div>
      ))}
    </dl>
  )
}

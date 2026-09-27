/** 탭 (screens-admin §2 #10). controlled — 화면이 value 를 URL/state 로 들고 있다 */
import type { ReactNode } from 'react'
import { cn } from '../cn'

export type TabItem<K extends string = string> = { key: K; label: ReactNode; badge?: number | string | undefined; disabled?: boolean | undefined }

export type TabsProps<K extends string> = {
  tabs: Array<TabItem<K>>
  value: K
  onChange: (key: K) => void
  className?: string | undefined
  /** 탭 아래 내용. 생략하면 탭 바만 */
  children?: ReactNode
}

export function Tabs<K extends string>({ tabs, value, onChange, className, children }: TabsProps<K>) {
  return (
    <div className={cn('flex flex-col', className)} data-component="Tabs">
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-line">
        {tabs.map((t) => {
          const active = t.key === value
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={t.disabled}
              onClick={() => onChange(t.key)}
              className={cn(
                '-mb-px inline-flex h-ctl items-center gap-1.5 border-b-2 px-3 text-ad-body font-medium',
                active ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-muted hover:text-ink',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {t.label}
              {t.badge !== undefined && t.badge !== '' ? (
                <span className={cn('rounded-full px-1.5 text-ad-xs tabular-nums', active ? 'bg-brand-100 text-brand-700' : 'bg-surface-3 text-ink-muted')}>{t.badge}</span>
              ) : null}
            </button>
          )
        })}
      </div>
      {children !== undefined ? (
        <div role="tabpanel" className="pt-4">
          {children}
        </div>
      ) : null}
    </div>
  )
}

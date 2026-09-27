/**
 * 휴대폰 세로 레이아웃 (screens-admin §2 #15, QRL-01 전용). AppLayout 없이
 * 상단 코드(고정폭·큰 글씨)+유형 라벨+상태 배지 → 본문 카드 → 하단 버튼(≥48px). `density-shopfloor` 루트.
 */
import type { ReactNode } from 'react'
import { cn } from '../cn'

export type MobilePageProps = {
  code: string
  typeLabel?: ReactNode
  badge?: ReactNode
  children: ReactNode
  /** 하단 고정 버튼 슬롯 (BigButton) */
  actions?: ReactNode
  banner?: ReactNode
  className?: string | undefined
}

export function MobilePage({ code, typeLabel, badge, children, actions, banner, className }: MobilePageProps) {
  return (
    <main className={cn('density-shopfloor mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-surface-2', className)} data-component="MobilePage">
      {banner}
      <header className="border-b border-line bg-surface px-5 pb-4 pt-6">
        {typeLabel ? <div className="text-sf-body text-ink-muted">{typeLabel}</div> : null}
        <h1 className="break-all font-mono text-sf-xl font-bold tabular-nums">{code}</h1>
        {badge ? <div className="mt-2">{badge}</div> : null}
      </header>
      <section className="flex-1 space-y-4 px-4 py-4">{children}</section>
      {actions ? <footer className="sticky bottom-0 flex flex-col gap-touch-gap border-t border-line bg-surface px-4 py-3">{actions}</footer> : null}
    </main>
  )
}

/** 본문 카드 — 라벨·값 목록 (현장 밀도) */
export function MobileCard({ title, items, children }: { title?: ReactNode; items?: Array<{ label: ReactNode; value: ReactNode }>; children?: ReactNode }) {
  return (
    <div className="rounded-sf border border-line bg-surface p-4 text-sf-body">
      {title ? <div className="mb-2 font-bold">{title}</div> : null}
      {items ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          {items.map((it, i) => (
            <div key={i} className="contents">
              <dt className="text-ink-muted">{it.label}</dt>
              <dd className="min-w-0 break-words text-right">{it.value === null || it.value === undefined || it.value === '' ? <span className="text-ink-faint">—</span> : it.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {children}
    </div>
  )
}

import type { ReactNode } from 'react'
import { StatusBadge } from '@/shared/ui'

export function ActiveBadge({ active }: { active: boolean }) {
  return <StatusBadge kind="active" status={active} />
}

/** 행 액션 묶음 — 행 클릭(상세) 전파를 막는다 */
export function RowActions({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  )
}

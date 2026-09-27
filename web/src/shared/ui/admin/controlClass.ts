import { cn } from '../cn'

/** 관리자 입력 컨트롤 공통 클래스 (Input·Select·NumberInput 과 커스텀 컨트롤이 공유) */
export const CONTROL_CLASS =
  'h-ctl w-full rounded-ad border bg-surface px-3 text-ad-body text-ink placeholder:text-ink-faint ' +
  'focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-surface-2 disabled:text-ink-muted'

export function controlClass(invalid: boolean, extra?: string) {
  return cn(CONTROL_CLASS, invalid ? 'border-status-error-line' : 'border-line-strong', extra)
}

import { cn } from '../cn'

export type SpinnerProps = { size?: number; label?: string; className?: string }

/** 회전 스피너. `label` 이 있으면 옆에 문구 표시(스크린리더에도 읽힌다). */
export function Spinner({ size = 20, label, className }: SpinnerProps) {
  return (
    <span role="status" aria-live="polite" className={cn('inline-flex items-center gap-2', className)}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="animate-spin">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.2" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label ? <span>{label}</span> : <span className="sr-only">불러오는 중</span>}
    </span>
  )
}

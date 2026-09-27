/**
 * 현장 대형 버튼. 최소 높이 64px(md) / 88px(lg), 글씨 24px, 장갑 터치 여백.
 * 버튼 사이 간격은 부모가 `gap-touch-gap`(12px) 이상으로 둔다.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../cn'
import { Spinner } from '../admin/Spinner'

export type BigButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  variant?: 'primary' | 'secondary' | 'danger'
  /** md=64px · lg=88px (완료·확인 같은 주요 동작) */
  size?: 'md' | 'lg'
  fullWidth?: boolean
  icon?: ReactNode
  /** 처리 중 — 스피너 표시 + 비활성. 문구는 그대로 둔다 */
  loading?: boolean
  children: ReactNode
}

const VARIANT: Record<NonNullable<BigButtonProps['variant']>, string> = {
  primary: 'bg-brand-600 text-white border-brand-700 hover:bg-brand-700 active:bg-brand-900',
  secondary: 'bg-surface text-ink border-line-strong hover:bg-surface-3 active:bg-line',
  danger: 'bg-status-error-fg text-white border-status-error-fg hover:brightness-95 active:brightness-90',
}

export function BigButton({
  variant = 'primary',
  size = 'md',
  fullWidth,
  icon,
  loading,
  disabled,
  className,
  type = 'button',
  children,
  ...rest
}: BigButtonProps) {
  const isDisabled = disabled || loading
  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-3 rounded-sf border-2 px-8 font-bold select-none',
        'touch-manipulation transition-[transform,background-color] active:scale-[0.98]',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        size === 'lg' ? 'min-h-touch-lg text-sf-xl' : 'min-h-touch text-sf-lg',
        fullWidth && 'w-full',
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={size === 'lg' ? 32 : 24} className="text-current" /> : icon}
      <span>{children}</span>
    </button>
  )
}

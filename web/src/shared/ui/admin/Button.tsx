/** 관리자 밀도 버튼 (높이 36px). 현장 화면에는 <BigButton> 을 쓴다. */
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../cn'
import { Spinner } from './Spinner'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md'
  icon?: ReactNode
  loading?: boolean
}

const VARIANT: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-brand-600 text-white border-brand-600 hover:bg-brand-700',
  secondary: 'bg-surface text-ink border-line-strong hover:bg-surface-3',
  danger: 'bg-status-error-fg text-white border-status-error-fg hover:brightness-95',
  ghost: 'bg-transparent text-ink border-transparent hover:bg-surface-3',
}

export function Button({ variant = 'secondary', size = 'md', icon, loading, disabled, className, type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-ad border font-medium whitespace-nowrap',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-ad-xs' : 'h-ctl px-3.5 text-ad-body',
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={16} className="text-current" /> : icon}
      {children}
    </button>
  )
}

import type { ReactNode } from 'react'
import { cn } from '../cn'
import { IconError } from '../icons'
import { TONE_CLASS } from '../status'
import { Button } from './Button'

export type ErrorAlertProps = {
  message: ReactNode
  title?: string
  onRetry?: () => void
  retryLabel?: string
  className?: string
}

/** 오류 표시 + 선택적 재시도. 조용한 실패 금지 — API 오류는 화면에 이 컴포넌트로 드러낸다. */
export function ErrorAlert({ message, title = '오류', onRetry, retryLabel = '다시 시도', className }: ErrorAlertProps) {
  return (
    <div role="alert" className={cn('flex items-start gap-3 rounded-ad border px-4 py-3', TONE_CLASS.error, className)}>
      <IconError size={20} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{title}</div>
        <div className="break-words">{message}</div>
      </div>
      {onRetry ? (
        <Button size="sm" variant="secondary" onClick={onRetry} className="shrink-0">
          {retryLabel}
        </Button>
      ) : null}
    </div>
  )
}

/**
 * 반장 PIN 다이얼로그 (E1 승인 · E6 취소 · 예외 승인). 4~6자리, NumPad(masked) 재사용.
 * 열려 있는 동안 화면은 useScannerInput 을 `enabled:false` 로 끄는 것을 권장한다 (Enter 충돌 방지).
 * 검증·API 호출은 화면이 한다. 실패 시 `error` 로 문구를 넘기면 값이 지워지고 다시 입력받는다.
 */
import { useEffect, useState } from 'react'
import { cn } from '../cn'
import { IconKey, IconX } from '../icons'
import { NumPad } from './NumPad'

export type PinDialogProps = {
  open: boolean
  title?: string
  description?: string
  onSubmit: (pin: string) => void
  onCancel: () => void
  minLength?: number
  maxLength?: number
  error?: string | null
  /** 서버 확인 중 */
  busy?: boolean
}

export function PinDialog({
  open,
  title = '반장 PIN 입력',
  description,
  onSubmit,
  onCancel,
  minLength = 4,
  maxLength = 6,
  error,
  busy,
}: PinDialogProps) {
  const [pin, setPin] = useState('')

  useEffect(() => {
    if (open) setPin('')
  }, [open])
  useEffect(() => {
    if (error) setPin('')
  }, [error])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/60 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pin-dialog-title"
      data-component="PinDialog"
    >
      <div className="flex w-full max-w-[520px] flex-col gap-4 rounded-sf bg-surface p-6 shadow-modal">
        <header className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <IconKey size={32} className="text-status-warn-fg" />
            <h2 id="pin-dialog-title" className="text-sf-xl font-bold">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="취소"
            className="flex h-touch-min w-touch-min items-center justify-center rounded-sf border-2 border-line"
          >
            <IconX size={28} />
          </button>
        </header>
        {description ? <p className="text-sf-body text-ink-muted">{description}</p> : null}
        <p className={cn('min-h-[28px] text-sf-body font-semibold', error ? 'text-status-error-fg' : 'text-ink-muted')} role="alert">
          {error ?? `${minLength}~${maxLength}자리`}
        </p>
        <NumPad
          value={pin}
          onChange={setPin}
          onConfirm={onSubmit}
          masked
          maxLength={maxLength}
          confirmLabel={busy ? '확인 중…' : '승인'}
          confirmDisabled={busy || pin.length < minLength}
          className="mx-auto"
        />
      </div>
    </div>
  )
}

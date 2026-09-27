/** 사유 필수 확인 모달 (screens-admin §2 #8 ReasonDialog). reason ≤200 (hold_reason VARCHAR(200) 준용). 409 등은 ConfirmDialog 가 ErrorAlert 로 */
import { useEffect, useState, type ReactNode } from 'react'
import { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog'
import { Textarea } from './formFields'

export const REASON_MAX = 200

export type ReasonDialogProps = Omit<ConfirmDialogProps, 'onConfirm' | 'children'> & {
  onConfirm: (reason: string) => void
  children?: ReactNode
  reasonLabel?: string
  presets?: readonly string[]
}

export function ReasonDialog({ open, onConfirm, children, reasonLabel = '사유', presets, ...rest }: ReasonDialogProps) {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (open) {
      setReason('')
      setTouched(false)
    }
  }, [open])
  const trimmed = reason.trim()
  const err = touched && trimmed.length === 0 ? `${reasonLabel}을(를) 입력하세요` : trimmed.length > REASON_MAX ? `${REASON_MAX}자 이하로 입력하세요` : undefined
  return (
    <ConfirmDialog
      open={open}
      {...rest}
      onConfirm={() => {
        setTouched(true)
        if (trimmed.length === 0 || trimmed.length > REASON_MAX) return
        onConfirm(trimmed)
      }}
    >
      <div className="space-y-3">
        {children}
        {presets && presets.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {presets.map((p) => (
              <button key={p} type="button" onClick={() => setReason(p)} className="rounded-full border border-line px-2 py-0.5 text-ad-xs hover:bg-surface-3">
                {p}
              </button>
            ))}
          </div>
        ) : null}
        <Textarea label={reasonLabel} required maxLength={REASON_MAX} value={reason} error={err} onBlur={() => setTouched(true)} onChange={(e) => setReason(e.target.value)} hint={`${trimmed.length}/${REASON_MAX}`} />
      </div>
    </ConfirmDialog>
  )
}

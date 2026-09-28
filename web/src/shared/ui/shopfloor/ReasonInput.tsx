/**
 * 수량 차이·승인 사유 입력 (screens-shopfloor §4.2 A4). KSK-31(E2 사유, 필수) · KSK-60(승인 note, 선택)
 * 이 공유한다. 프리셋 5종은 계약으로 고정(contracts/ts-types.md VarianceReasonCode, api-contract §13.5 ⑨):
 * SHORT_INPUT·MISCOUNT·DEFECT_EXTRA·SPLIT_MOVED·OTHER(자유 입력 필수) — 여기서 지어내지 않는다.
 */
import { cn } from '../cn'
import { VarianceReasonLabel } from '../../labels'
import type { VarianceReasonCode } from '../../types'

export type ReasonValue = { code: VarianceReasonCode | null; text: string }

export type ReasonInputMode = 'required' | 'optional'

export type ReasonInputProps = {
  /** required = KSK-31 (선택+제출 필수) · optional = KSK-60 note (사유 없이도 진행 가능) */
  mode: ReasonInputMode
  value: ReasonValue
  onChange: (next: ReasonValue) => void
  /** 기본 200 (db-schema variance_reason ≤200) */
  maxLength?: number
  label?: string
  className?: string
}

const PRESETS: VarianceReasonCode[] = ['SHORT_INPUT', 'MISCOUNT', 'DEFECT_EXTRA', 'SPLIT_MOVED', 'OTHER']

/** 화면이 [확인]/[승인] 버튼의 disabled 조건에 그대로 쓰는 검증 함수 */
export function isReasonComplete(mode: ReasonInputMode, value: ReasonValue): boolean {
  if (mode === 'optional') return true
  if (!value.code) return false
  if (value.code === 'OTHER') return value.text.trim().length > 0
  return true
}

export function ReasonInput({ mode, value, onChange, maxLength = 200, label, className }: ReasonInputProps) {
  const needsText = value.code === 'OTHER'
  const showCodeHint = mode === 'required' && !value.code
  const showTextHint = needsText && value.text.trim().length === 0

  return (
    <div className={cn('flex flex-col gap-3', className)} data-component="ReasonInput">
      {label ? <div className="text-sf-body font-bold text-ink-muted">{label}</div> : null}

      <div className="flex flex-wrap gap-touch-gap" role="group" aria-label="사유 선택">
        {PRESETS.map((code) => {
          const selected = value.code === code
          return (
            <button
              key={code}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange({ code, text: value.text })}
              className={cn(
                'min-h-touch-min touch-manipulation rounded-full border-2 px-6 text-sf-body font-bold active:scale-[0.98]',
                selected ? 'border-brand-700 bg-brand-600 text-white' : 'border-line-strong bg-surface text-ink active:bg-surface-3',
              )}
            >
              {VarianceReasonLabel[code]}
            </button>
          )
        })}
      </div>

      <div className="flex flex-col gap-1">
        <textarea
          value={value.text}
          onChange={(e) => onChange({ code: value.code, text: e.target.value.slice(0, maxLength) })}
          maxLength={maxLength}
          placeholder={needsText ? '자유 입력 (필수) — 사유를 적어주세요' : '자유 입력 (선택)'}
          aria-required={needsText}
          rows={3}
          className="w-full rounded-sf border-2 border-line-strong bg-surface p-3 text-sf-body"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-sf-body">
          {showCodeHint ? (
            <span className="font-bold text-status-warn-fg" role="alert">
              사유를 선택하세요
            </span>
          ) : showTextHint ? (
            <span className="font-bold text-status-warn-fg" role="alert">
              기타 사유는 자유 입력이 필요합니다
            </span>
          ) : (
            <span>&nbsp;</span>
          )}
          <span className="tabular-nums text-ink-muted">
            {value.text.length}/{maxLength}
          </span>
        </div>
      </div>
    </div>
  )
}

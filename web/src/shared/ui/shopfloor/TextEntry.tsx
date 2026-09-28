/**
 * 대형 텍스트 입력 (screens-shopfloor §4.2 A6). PDA-21 송장번호, KSK-70 WO 검색어([S4]), KSK-01 ID 입력이
 * 함께 쓸 수 있는 형태. 화면 키보드는 NumPad 처럼 자체 가상 키패드를 새로 그리지 않고 네이티브 on-screen
 * keyboard 에 맡긴다(터치 포커스 시 OS/브라우저가 띄운다) — 숫자만 다루는 NumPad 와 달리 전체 QWERTY 를
 * 다시 그리는 것은 이 명세가 요구하지 않는다(§4.2 A6 요구는 "화면 키보드 포함 대형 입력"까지).
 *
 * `scan` 을 주면 `useScannerInput` 으로 HID 스캐너 burst 입력도 값으로 받는다 — PDA-21 은 "1D 바코드 스캔
 * 또는 화면 키패드 입력" 이라 서로 배타적이지 않다(스캔이 곧 같은 필드의 값이 된다).
 *
 * 참고(설계 결정): `scan` 활성 중 이 입력에 포커스가 가 있으면, 스캐너가 찍는 개별 문자가 네이티브 입력으로도
 * 순간적으로 보였다가 스캔이 인식되는 시점(Enter)에 최종값으로 덮어써진다 — PinDialog/NumPad 조합처럼 두
 * 전역 keydown 리스너가 같은 화면에서 충돌하는 구조가 아니라(그 쪽은 NumPad 의 `keyboard={false}` 로 피한다),
 * 이 컴포넌트는 값 하나만 제어하는 controlled input 이므로 마지막에 오는 scan 결과가 항상 이긴다. 화면이
 * 스캔 전용으로 쓰고 싶으면(타이핑 유출을 원치 않으면) `autoFocus` 를 끄고 입력을 포커스하지 않으면 된다.
 */
import { useId } from 'react'
import { useScannerInput } from '../../hooks/useScannerInput'
import { cn } from '../cn'
import { IconQr, IconX } from '../icons'
import type { TargetType } from '../../types'

export type TextEntryScanOptions = {
  /** 이 타입의 스캔만 값으로 받는다. 생략하면 모든 타입을 받는다 (예: PDA-21 은 `['VB']`) */
  types?: TargetType[]
  /** false 면 스캐너 구독을 끈다. 기본값 true */
  enabled?: boolean
  /** 스캔 값으로 원문(raw)을 쓸지. 기본값 false(=정규화된 code) */
  useRaw?: boolean
}

export type TextEntryProps = {
  value: string
  onChange: (value: string) => void
  /** Enter(사람 타이핑) 또는 [확인] 버튼 — 스캔은 onConfirm 을 부르지 않는다(값만 채운다) */
  onConfirm?: (value: string) => void
  label?: string
  placeholder?: string
  /** 기본 40 (송장번호 ≤40자, api-contract §5.4) */
  maxLength?: number
  confirmLabel?: string
  /** 생략하면 값이 비어있지 않을 때 활성 */
  confirmDisabled?: boolean
  /** HID 스캐너 입력도 값으로 받는다 (PDA-21) */
  scan?: TextEntryScanOptions
  autoFocus?: boolean
  error?: string | null
  hint?: string
  className?: string
}

export function TextEntry({
  value,
  onChange,
  onConfirm,
  label,
  placeholder,
  maxLength = 40,
  confirmLabel = '확인',
  confirmDisabled,
  scan,
  autoFocus,
  error,
  hint,
  className,
}: TextEntryProps) {
  const inputId = useId()

  useScannerInput(
    (parsed) => {
      if (scan?.types && !scan.types.includes(parsed.type)) return
      onChange((scan?.useRaw ? parsed.raw : parsed.code).slice(0, maxLength))
    },
    { enabled: Boolean(scan) && scan?.enabled !== false },
  )

  const canConfirm = confirmDisabled === undefined ? value.trim().length > 0 : !confirmDisabled

  return (
    <div className={cn('flex w-full flex-col gap-2', className)} data-component="TextEntry">
      {label ? (
        <label htmlFor={inputId} className="text-sf-body font-bold text-ink-muted">
          {label}
        </label>
      ) : null}

      <div
        className={cn(
          'flex items-center gap-2 rounded-sf border-2 bg-surface px-4 focus-within:border-brand-600',
          error ? 'border-status-error-line' : 'border-line-strong',
        )}
      >
        <input
          id={inputId}
          type="text"
          inputMode="text"
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, maxLength))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onConfirm?.(value)
            }
          }}
          placeholder={placeholder}
          maxLength={maxLength}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={Boolean(error) || undefined}
          className="min-h-touch min-w-0 flex-1 bg-transparent py-3 text-sf-xl font-bold text-ink outline-none placeholder:text-sf-lg placeholder:font-normal placeholder:text-ink-faint"
        />
        {value.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="지우기"
            className="flex h-touch-min w-touch-min shrink-0 touch-manipulation items-center justify-center rounded-sf text-ink-muted active:bg-surface-3"
          >
            <IconX size={24} />
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sf-body">
        {error ? (
          <span className="font-bold text-status-error-fg" role="alert">
            {error}
          </span>
        ) : scan ? (
          <span className="inline-flex items-center gap-1 text-ink-muted">
            <IconQr size={18} /> 스캔하거나 입력하세요
          </span>
        ) : hint ? (
          <span className="text-ink-muted">{hint}</span>
        ) : (
          <span>&nbsp;</span>
        )}
        <span className="tabular-nums text-ink-muted">
          {value.length}/{maxLength}
        </span>
      </div>

      {onConfirm ? (
        <button
          type="button"
          disabled={!canConfirm}
          onClick={() => onConfirm(value)}
          className={cn(
            'min-h-touch w-full touch-manipulation rounded-sf border-2 border-brand-700 bg-brand-600 text-sf-lg font-bold text-white',
            'active:scale-[0.98] active:bg-brand-900 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
          )}
        >
          {confirmLabel}
        </button>
      ) : null}
    </div>
  )
}

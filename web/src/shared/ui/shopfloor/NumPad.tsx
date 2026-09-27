/**
 * 숫자 키패드. 키 72px, 값 표시 56px. 수량 입력(양품 기본값=투입수량)과 PIN 입력(masked)에 함께 쓴다.
 *
 * - `defaultValue` 가 있으면 첫 키 입력이 값을 **대체**한다 (기본값을 지우고 다시 칠 필요가 없게).
 * - 비제어(defaultValue) / 제어(value+onChange) 둘 다 지원.
 * - Enter/Backspace/숫자 물리 키도 받는다 (스캐너 훅과 충돌하지 않도록 키패드가 마운트된 화면에서만).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../cn'
import { IconBackspace } from '../icons'

export type NumPadProps = {
  /** 비제어 초기값 */
  defaultValue?: string
  /** 제어 값 (onChange 와 함께) */
  value?: string
  onChange?: (value: string) => void
  onConfirm: (value: string) => void
  /** 최대 자릿수. 기본값 6 */
  maxLength?: number
  /** PIN 입력용 — 값을 ● 로 표시 */
  masked?: boolean
  /** 값 표시 위 라벨 (예: "양품 수량") */
  label?: string
  /** 값 뒤 단위 (예: "장") */
  unit?: string
  confirmLabel?: string
  /** 확인 버튼 비활성 조건. 기본은 빈 값일 때 */
  confirmDisabled?: boolean
  /** 물리 키보드 입력도 받을지. 기본값 true */
  keyboard?: boolean
  className?: string
}

const KEYS: ReadonlyArray<readonly [string, string, string]> = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
]

export function NumPad({
  defaultValue = '',
  value: controlled,
  onChange,
  onConfirm,
  maxLength = 6,
  masked = false,
  label,
  unit,
  confirmLabel = '확인',
  confirmDisabled,
  keyboard = true,
  className,
}: NumPadProps) {
  const [inner, setInner] = useState(defaultValue)
  const [pristine, setPristine] = useState(defaultValue.length > 0)
  const value = controlled ?? inner

  const set = useCallback(
    (next: string) => {
      setPristine(false)
      if (controlled === undefined) setInner(next)
      onChange?.(next)
    },
    [controlled, onChange],
  )

  const pushDigit = useCallback(
    (d: string) => {
      const base = pristine ? '' : value
      if (base.length >= maxLength) return
      // 선행 0 은 하나만 (0 → 05 방지)
      const next = base === '0' ? d : base + d
      set(next)
    },
    [pristine, value, maxLength, set],
  )
  const backspace = useCallback(() => set(pristine ? '' : value.slice(0, -1)), [pristine, value, set])
  const clear = useCallback(() => set(''), [set])

  const canConfirm = confirmDisabled === undefined ? value.length > 0 : !confirmDisabled
  const confirm = useCallback(() => {
    if (canConfirm) onConfirm(value)
  }, [canConfirm, onConfirm, value])

  // 리스너는 한 번만 등록하고 최신 핸들러는 ref 로 본다.
  // 렌더마다 재등록하면 빠른 연타(물리 키패드·스캐너 흉내)에서 직전 렌더의 닫힌 값을 보는 키가 생긴다.
  const handlers = useRef({ pushDigit, backspace, clear, confirm })
  handlers.current = { pushDigit, backspace, clear, confirm }

  useEffect(() => {
    if (!keyboard) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const h = handlers.current
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault()
        h.pushDigit(e.key)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        h.backspace()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        h.clear()
      } else if (e.key === 'Enter' || e.key === 'NumpadEnter') {
        // 스캐너 Enter 는 useScannerInput 이 capture 단계에서 먼저 먹고 stopPropagation 한다
        e.preventDefault()
        h.confirm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keyboard])

  const display = masked ? '●'.repeat(value.length) : value

  // bg/text 는 base 에 두지 않는다 — 확인 버튼이 다른 색을 덮어써야 하는데 Tailwind 는 클래스 순서가 아니라 CSS 순서로 이긴다
  const baseCls =
    'flex h-key items-center justify-center rounded-sf border-2 text-sf-xl font-bold select-none touch-manipulation ' +
    'active:scale-[0.97] focus-visible:z-10'
  const keyCls = cn(baseCls, 'border-line-strong bg-surface text-ink active:bg-surface-3')

  return (
    <div className={cn('flex w-full max-w-[420px] flex-col gap-touch-gap', className)} data-component="NumPad">
      <div className="rounded-sf border-2 border-line bg-surface px-5 py-3">
        {label ? <div className="text-sf-body text-ink-muted">{label}</div> : null}
        <output
          aria-live="polite"
          className={cn(
            'block min-h-[64px] text-right font-mono text-sf-num font-bold tabular-nums',
            pristine && 'text-brand-600',
            value.length === 0 && 'text-ink-faint',
          )}
        >
          {display || '0'}
          {unit && value.length > 0 ? <span className="ml-2 text-sf-lg text-ink-muted">{unit}</span> : null}
        </output>
      </div>

      <div className="grid grid-cols-3 gap-touch-gap">
        {KEYS.flat().map((k) => (
          <button key={k} type="button" className={keyCls} onClick={() => pushDigit(k)}>
            {k}
          </button>
        ))}
        <button type="button" className={cn(keyCls, 'text-sf-lg text-ink-muted')} onClick={clear} aria-label="지우기">
          C
        </button>
        <button type="button" className={keyCls} onClick={() => pushDigit('0')}>
          0
        </button>
        <button type="button" className={cn(keyCls, 'text-ink-muted')} onClick={backspace} aria-label="한 글자 지우기">
          <IconBackspace size={32} />
        </button>
        <button
          type="button"
          disabled={!canConfirm}
          onClick={confirm}
          className={cn(
            baseCls,
            'col-span-3 border-brand-700 bg-brand-600 text-white active:bg-brand-900',
            'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
          )}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  )
}

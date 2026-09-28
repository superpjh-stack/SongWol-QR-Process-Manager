/**
 * 숫자 키패드. 키 72px, 값 표시 56px. 수량 입력(양품 기본값=투입수량)과 PIN 입력(masked)에 함께 쓴다.
 *
 * - `defaultValue` 가 있으면 첫 키 입력이 값을 **대체**한다 (기본값을 지우고 다시 칠 필요가 없게).
 * - 비제어(defaultValue) / 제어(value+onChange) 둘 다 지원 (단일 필드 모드).
 * - **다중 필드 모드**(`fields`) — KSK-30 양품·불량처럼 필드 두 개 이상을 하나의 키패드로 바인딩한다.
 *   `activeKey` 로 지금 타이핑이 들어갈 필드를 고르고, 필드 칩을 탭해도 전환된다.
 * - `max` — 값 상한. 넘는 자리 입력은 무시한다(자리수 채움이 아니라 거부).
 * - `customKeys` — [전량]·[지우기] 같은 화면별 커스텀 버튼 슬롯. 키패드 그리드 아래 별도 줄로 나온다.
 * - Enter/Backspace/숫자 물리 키도 받는다 (스캐너 훅과 충돌하지 않도록 키패드가 마운트된 화면에서만).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '../cn'
import { IconBackspace } from '../icons'

export type NumPadField = {
  key: string
  label: string
  value: string
  unit?: string
}

type NumPadSingleProps = {
  fields?: undefined
  /** 비제어 초기값 */
  defaultValue?: string
  /** 제어 값 (onChange 와 함께) */
  value?: string
  onChange?: (value: string) => void
  onConfirm: (value: string) => void
}

type NumPadMultiProps = {
  /** 두 필드 이상을 하나의 키패드로 바인딩 (예: 양품·불량) */
  fields: NumPadField[]
  /** 지금 입력을 받는 필드 key */
  activeKey: string
  onActiveKeyChange: (key: string) => void
  onFieldChange: (key: string, value: string) => void
  onConfirm: (values: Record<string, string>) => void
}

export type NumPadProps = (NumPadSingleProps | NumPadMultiProps) & {
  /** 최대 자릿수. 기본값 6 */
  maxLength?: number
  /** 값 상한. 넘는 입력은 거부한다(단일·다중 필드 공통) */
  max?: number
  /** PIN 입력용 — 값을 ● 로 표시 (단일 필드 모드에서만 의미가 있다) */
  masked?: boolean
  /** 값 표시 위 라벨 (예: "양품 수량") — 단일 필드 모드 */
  label?: string
  /** 값 뒤 단위 (예: "장") — 단일 필드 모드 */
  unit?: string
  confirmLabel?: string
  /** 확인 버튼 비활성 조건. 기본은 빈 값일 때 */
  confirmDisabled?: boolean
  /** 물리 키보드 입력도 받을지. 기본값 true */
  keyboard?: boolean
  /** [전량]/[지우기] 등 화면별 커스텀 버튼 슬롯 */
  customKeys?: ReactNode
  className?: string
}

const KEYS: ReadonlyArray<readonly [string, string, string]> = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
]

function isMultiProps(p: NumPadProps): p is NumPadMultiProps & Omit<NumPadProps, keyof NumPadMultiProps> {
  return p.fields !== undefined
}

export function NumPad(props: NumPadProps) {
  const { maxLength = 6, max, masked = false, label, unit, confirmLabel = '확인', confirmDisabled, keyboard = true, customKeys, className } = props
  const multi = isMultiProps(props) ? props : null
  const single = !multi ? (props as NumPadSingleProps) : null

  // ---- 단일 필드 상태 (비제어 fallback) ----
  const [inner, setInner] = useState(single?.defaultValue ?? '')
  const [pristine, setPristine] = useState((single?.defaultValue ?? '').length > 0)
  const singleValue = single ? (single.value ?? inner) : ''

  // ---- 다중 필드: 처음 값이 채워진 필드는 pristine(첫 입력이 대체) ----
  const [multiPristine, setMultiPristine] = useState<Record<string, boolean>>(() => {
    if (!multi) return {}
    const p: Record<string, boolean> = {}
    for (const f of multi.fields) p[f.key] = f.value.length > 0
    return p
  })

  const activeField = multi ? (multi.fields.find((f) => f.key === multi.activeKey) ?? multi.fields[0]) : undefined
  const currentValue = multi ? (activeField?.value ?? '') : singleValue
  const currentPristine = multi ? (activeField ? (multiPristine[activeField.key] ?? false) : false) : pristine

  const setValue = useCallback(
    (next: string) => {
      if (multi && activeField) {
        setMultiPristine((m) => ({ ...m, [activeField.key]: false }))
        multi.onFieldChange(activeField.key, next)
      } else if (single) {
        setPristine(false)
        if (single.value === undefined) setInner(next)
        single.onChange?.(next)
      }
    },
    [multi, activeField, single],
  )

  const pushDigit = useCallback(
    (d: string) => {
      const base = currentPristine ? '' : currentValue
      if (base.length >= maxLength) return
      // 선행 0 은 하나만 (0 → 05 방지)
      const next = base === '0' ? d : base + d
      if (max !== undefined && next !== '' && Number(next) > max) return
      setValue(next)
    },
    [currentPristine, currentValue, maxLength, max, setValue],
  )
  const backspace = useCallback(() => setValue(currentPristine ? '' : currentValue.slice(0, -1)), [currentPristine, currentValue, setValue])
  const clear = useCallback(() => setValue(''), [setValue])

  const confirm = useCallback(() => {
    if (multi) {
      const values: Record<string, string> = {}
      for (const f of multi.fields) values[f.key] = f.value
      multi.onConfirm(values)
    } else if (single) {
      single.onConfirm(singleValue)
    }
  }, [multi, single, singleValue])

  const defaultCanConfirm = multi ? multi.fields.some((f) => f.value.length > 0) : currentValue.length > 0
  const canConfirm = confirmDisabled === undefined ? defaultCanConfirm : !confirmDisabled

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

  const display = masked ? '●'.repeat(currentValue.length) : currentValue

  // bg/text 는 base 에 두지 않는다 — 확인 버튼이 다른 색을 덮어써야 하는데 Tailwind 는 클래스 순서가 아니라 CSS 순서로 이긴다
  const baseCls =
    'flex h-key items-center justify-center rounded-sf border-2 text-sf-xl font-bold select-none touch-manipulation ' +
    'active:scale-[0.97] focus-visible:z-10'
  const keyCls = cn(baseCls, 'border-line-strong bg-surface text-ink active:bg-surface-3')

  return (
    <div className={cn('flex w-full max-w-[420px] flex-col gap-touch-gap', className)} data-component="NumPad">
      {multi ? (
        <div className="flex gap-touch-gap" role="tablist" aria-label="입력 필드 전환">
          {multi.fields.map((f) => {
            const isActive = f.key === multi.activeKey
            return (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => multi.onActiveKeyChange(f.key)}
                className={cn(
                  'min-h-touch flex-1 rounded-sf border-2 px-4 py-2 text-left touch-manipulation',
                  isActive ? 'border-brand-600 bg-brand-50' : 'border-line bg-surface',
                )}
              >
                <div className="text-sf-body text-ink-muted">{f.label}</div>
                <output
                  aria-live={isActive ? 'polite' : undefined}
                  className={cn('block font-mono text-sf-xl font-bold tabular-nums', f.value.length === 0 && 'text-ink-faint')}
                >
                  {f.value || '0'}
                  {f.unit && f.value.length > 0 ? <span className="ml-1 text-sf-body text-ink-muted">{f.unit}</span> : null}
                </output>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="rounded-sf border-2 border-line bg-surface px-5 py-3">
          {label ? <div className="text-sf-body text-ink-muted">{label}</div> : null}
          <output
            aria-live="polite"
            className={cn(
              'block min-h-[64px] text-right font-mono text-sf-num font-bold tabular-nums',
              pristine && 'text-brand-600',
              currentValue.length === 0 && 'text-ink-faint',
            )}
          >
            {display || '0'}
            {unit && currentValue.length > 0 ? <span className="ml-2 text-sf-lg text-ink-muted">{unit}</span> : null}
          </output>
        </div>
      )}

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
      </div>

      {customKeys ? <div className="flex gap-touch-gap">{customKeys}</div> : null}

      <button
        type="button"
        disabled={!canConfirm}
        onClick={confirm}
        className={cn(
          baseCls,
          'w-full border-brand-700 bg-brand-600 text-white active:bg-brand-900',
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        )}
      >
        {confirmLabel}
      </button>
    </div>
  )
}

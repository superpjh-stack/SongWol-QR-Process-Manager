/**
 * typeahead 셀렉트 (screens-admin §2 #6). `search(q)` 로 서버 검색 (`GET /customers?q=` 등), 디바운스 300ms.
 * - controlled: `value: T | null` · `onChange(T | null)`. 선택값은 `getLabel` 로 표시, [지우기] 로 null.
 * - 검색 실패는 드롭다운 안에 문구로 드러낸다 (조용한 실패 금지). 로딩은 「검색 중…」.
 * - 키보드: ↑↓ 이동, Enter 선택, Esc 닫기.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { cn } from '../cn'
import { IconX } from '../icons'
import { FormField, type FieldProps } from './FormField'
import { controlClass } from './controlClass'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'

export type SearchSelectProps<T> = Pick<FieldProps, 'label' | 'required' | 'hint' | 'error'> & {
  value: T | null
  onChange: (next: T | null) => void
  /** q 로 검색. 취소용 signal 은 선택 */
  search: (q: string, signal: AbortSignal) => Promise<T[]>
  getKey: (item: T) => string | number
  getLabel: (item: T) => string
  renderOption?: ((item: T) => ReactNode) | undefined
  placeholder?: string | undefined
  disabled?: boolean | undefined
  /** 이 길이 미만이면 검색하지 않는다. 0 = 포커스 시 빈 검색 (기본) */
  minChars?: number | undefined
  debounceMs?: number | undefined
  wrapperClassName?: string | undefined
  id?: string | undefined
  /** 오류 메시지 변환 (ApiError → 문구). 없으면 Error.message */
  errorText?: ((e: unknown) => string) | undefined
  /** label 없이 표 안에서 쓸 때 (접근성, D53). 선택 해제 버튼 라벨에도 붙는다 */
  ariaLabel?: string | undefined
}

export function SearchSelect<T>({
  label,
  required,
  hint,
  error,
  value,
  onChange,
  search,
  getKey,
  getLabel,
  renderOption,
  placeholder = '검색어 입력',
  disabled,
  minChars = 0,
  debounceMs = 300,
  wrapperClassName,
  id,
  errorText,
  ariaLabel,
}: SearchSelectProps<T>) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [active, setActive] = useState(0)
  const debounced = useDebouncedValue(query, debounceMs)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    if (debounced.trim().length < minChars) {
      setOptions([])
      return
    }
    const ctl = new AbortController()
    setLoading(true)
    setSearchError(null)
    search(debounced.trim(), ctl.signal)
      .then((items) => {
        if (ctl.signal.aborted) return
        setOptions(items)
        setActive(0)
      })
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return
        setOptions([])
        setSearchError(errorText ? errorText(e) : e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoading(false)
      })
    return () => ctl.abort()
  }, [open, debounced, minChars, search, errorText])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const select = (item: T) => {
    onChange(item)
    setQuery('')
    setOpen(false)
  }

  return (
    <FormField label={label} required={required} hint={hint} error={error} id={id} className={wrapperClassName}>
      {(c) => (
        <div ref={rootRef} className="relative" data-component="SearchSelect">
          {value !== null ? (
            <div className={controlClass(c.invalid, 'flex items-center justify-between gap-2 pr-1')}>
              <span className="truncate">{getLabel(value)}</span>
              <button
                type="button"
                aria-label={ariaLabel ? `${ariaLabel} 선택 해제` : '선택 해제'}
                disabled={disabled}
                onClick={() => {
                  onChange(null)
                  setQuery('')
                  setOpen(true)
                }}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-ad text-ink-muted hover:bg-surface-3 disabled:opacity-40"
              >
                <IconX size={16} />
              </button>
            </div>
          ) : (
            <input
              id={c.id}
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-label={ariaLabel}
              aria-invalid={c.invalid || undefined}
              aria-describedby={c.describedBy}
              autoComplete="off"
              disabled={disabled}
              placeholder={placeholder}
              value={query}
              className={controlClass(c.invalid)}
              onFocus={() => setOpen(true)}
              onChange={(e) => {
                setQuery(e.target.value)
                setOpen(true)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setOpen(true)
                  setActive((i) => Math.min(options.length - 1, i + 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setActive((i) => Math.max(0, i - 1))
                } else if (e.key === 'Enter') {
                  const item = options[active]
                  if (open && item !== undefined) {
                    e.preventDefault()
                    select(item)
                  }
                } else if (e.key === 'Escape') {
                  setOpen(false)
                }
              }}
            />
          )}
          {open && value === null ? (
            <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-ad border border-line bg-surface py-1 text-ad-body shadow-modal">
              {loading ? <li className="px-3 py-2 text-ink-muted">검색 중…</li> : null}
              {searchError ? (
                <li role="alert" className="px-3 py-2 text-status-error-fg">
                  검색 실패 — {searchError}
                </li>
              ) : null}
              {!loading && !searchError && debounced.trim().length < minChars ? <li className="px-3 py-2 text-ink-muted">{minChars}자 이상 입력하세요</li> : null}
              {!loading && !searchError && debounced.trim().length >= minChars && options.length === 0 ? <li className="px-3 py-2 text-ink-muted">검색 결과가 없습니다</li> : null}
              {options.map((o, i) => (
                <li
                  key={getKey(o)}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    select(o)
                  }}
                  className={cn('cursor-pointer px-3 py-1.5', i === active && 'bg-brand-50')}
                >
                  {renderOption ? renderOption(o) : getLabel(o)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </FormField>
  )
}

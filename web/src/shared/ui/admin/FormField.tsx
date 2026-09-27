/**
 * 폼 필드 계열. 라벨·필수 표시·힌트·인라인 오류를 한 자리에서 처리한다.
 * react-hook-form 과 쓸 때는 `{...register('name')}` 를 그대로 펼친다 (forwardRef 불필요 — React 19 는 ref 가 prop).
 */
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { cn } from '../cn'
import { controlClass } from './controlClass'

export type FieldProps = {
  label?: ReactNode
  required?: boolean | undefined
  hint?: ReactNode
  error?: ReactNode
  /** 자식 컨트롤의 id. 생략하면 자동 생성해 자식에 넘긴다 */
  id?: string | undefined
  className?: string | undefined
  children: (ctl: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}

/** 래퍼. 커스텀 컨트롤을 감쌀 때 직접 쓴다. */
export function FormField({ label, required, hint, error, id: idProp, className, children }: FieldProps) {
  const auto = useId()
  const id = idProp ?? auto
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  const describedBy = [errId, hintId].filter(Boolean).join(' ') || undefined
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {label ? (
        <label htmlFor={id} className="font-medium">
          {label}
          {required ? (
            <span className="ml-0.5 text-status-error-fg" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
      ) : null}
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error ? (
        <p id={errId} role="alert" className="text-ad-xs text-status-error-fg">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-ad-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

type Common = Pick<FieldProps, 'label' | 'required' | 'hint' | 'error'> & { wrapperClassName?: string | undefined }

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'required'> & Common

export function Input({ label, required, hint, error, wrapperClassName, className, id, ...rest }: InputProps) {
  return (
    <FormField label={label} required={required} hint={hint} error={error} id={id} className={wrapperClassName}>
      {(c) => (
        <input
          id={c.id}
          aria-invalid={c.invalid || undefined}
          aria-describedby={c.describedBy}
          required={required}
          className={controlClass(c.invalid, className)}
          {...rest}
        />
      )}
    </FormField>
  )
}

export type SelectOption = { value: string; label: string; disabled?: boolean }
export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'required'> &
  Common & { options: SelectOption[]; placeholder?: string }

export function Select({ label, required, hint, error, wrapperClassName, className, id, options, placeholder, ...rest }: SelectProps) {
  return (
    <FormField label={label} required={required} hint={hint} error={error} id={id} className={wrapperClassName}>
      {(c) => (
        <select
          id={c.id}
          aria-invalid={c.invalid || undefined}
          aria-describedby={c.describedBy}
          required={required}
          className={controlClass(c.invalid, className)}
          {...rest}
        >
          {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </FormField>
  )
}

/** 날짜 입력 (YYYY-MM-DD, Asia/Seoul 기준 일자). 값은 문자열로 주고받는다. */
export type DateInputProps = Omit<InputProps, 'type'>
export function DateInput(props: DateInputProps) {
  return <Input type="date" {...props} />
}

/** 숫자 입력. 수량·허용오차 등. `inputMode=numeric` 으로 모바일 키패드를 띄운다. */
export type NumberInputProps = Omit<InputProps, 'type'> & { unit?: string }
export function NumberInput({ unit, className, ...props }: NumberInputProps) {
  if (!unit) return <Input type="number" inputMode="numeric" className={cn('tabular-nums', className)} {...props} />
  const { label, required, hint, error, wrapperClassName, id, ...rest } = props
  return (
    <FormField label={label} required={required} hint={hint} error={error} id={id} className={wrapperClassName}>
      {(c) => (
        <div className="relative">
          <input
            id={c.id}
            type="number"
            inputMode="numeric"
            aria-invalid={c.invalid || undefined}
            aria-describedby={c.describedBy}
            required={required}
            className={controlClass(c.invalid, cn('pr-10 tabular-nums', className))}
            {...rest}
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-ink-muted">{unit}</span>
        </div>
      )}
    </FormField>
  )
}

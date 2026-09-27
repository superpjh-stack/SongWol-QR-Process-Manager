/** FormField 계열 추가 컨트롤 (screens-admin §2 #2·#3): Textarea · Checkbox · CheckboxGroup · Radio */
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { FormField, type FieldProps } from '@/shared/ui/admin'
import { cn } from '@/shared/ui'
import { controlClass } from '@/shared/ui/admin'

type Common = Pick<FieldProps, 'label' | 'required' | 'hint' | 'error'> & { wrapperClassName?: string | undefined }

export type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'required'> & Common & { mono?: boolean }
export function Textarea({ label, required, hint, error, wrapperClassName, className, id, mono, ...rest }: TextareaProps) {
  return (
    <FormField label={label} required={required} hint={hint} error={error} id={id} className={wrapperClassName}>
      {(c) => (
        <textarea
          id={c.id}
          aria-invalid={c.invalid || undefined}
          aria-describedby={c.describedBy}
          required={required}
          className={controlClass(c.invalid, cn('h-auto min-h-24 py-2', mono && 'font-mono', className))}
          {...rest}
        />
      )}
    </FormField>
  )
}

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'required'> & { label: ReactNode; hint?: ReactNode; error?: ReactNode; wrapperClassName?: string }
export function Checkbox({ label, hint, error, wrapperClassName, className, id, ...rest }: CheckboxProps) {
  return (
    <FormField hint={hint} error={error} id={id} className={wrapperClassName}>
      {(c) => (
        <label htmlFor={c.id} className="inline-flex h-ctl cursor-pointer items-center gap-2">
          <input id={c.id} type="checkbox" aria-invalid={c.invalid || undefined} aria-describedby={c.describedBy} className={cn('h-4 w-4 accent-brand-600', className)} {...rest} />
          <span>{label}</span>
        </label>
      )}
    </FormField>
  )
}

export type CheckboxGroupProps<V extends string> = Common & {
  options: Array<{ value: V; label: ReactNode }>
  value: V[]
  onChange: (next: V[]) => void
  disabled?: boolean
}
export function CheckboxGroup<V extends string>({ label, required, hint, error, wrapperClassName, options, value, onChange, disabled }: CheckboxGroupProps<V>) {
  return (
    <FormField label={label} required={required} hint={hint} error={error} className={wrapperClassName}>
      {(c) => (
        <div id={c.id} role="group" aria-describedby={c.describedBy} className="flex flex-wrap gap-x-4 gap-y-1">
          {options.map((o) => {
            const checked = value.includes(o.value)
            return (
              <label key={o.value} className="inline-flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  className="h-4 w-4 accent-brand-600"
                  onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((v) => v !== o.value))}
                />
                <span>{o.label}</span>
              </label>
            )
          })}
        </div>
      )}
    </FormField>
  )
}

export type RadioGroupProps<V extends string> = Common & {
  options: Array<{ value: V; label: ReactNode; hint?: ReactNode }>
  value: V
  onChange: (next: V) => void
  name: string
  disabled?: boolean
}
export function RadioGroup<V extends string>({ label, required, hint, error, wrapperClassName, options, value, onChange, name, disabled }: RadioGroupProps<V>) {
  return (
    <FormField label={label} required={required} hint={hint} error={error} className={wrapperClassName}>
      {(c) => (
        <div id={c.id} role="radiogroup" aria-describedby={c.describedBy} className="flex flex-col gap-1">
          {options.map((o) => (
            <label key={o.value} className="inline-flex cursor-pointer items-start gap-2">
              <input type="radio" name={name} value={o.value} checked={value === o.value} disabled={disabled} className="mt-1 h-4 w-4 accent-brand-600" onChange={() => onChange(o.value)} />
              <span>
                {o.label}
                {o.hint ? <span className="block text-ad-xs text-ink-muted">{o.hint}</span> : null}
              </span>
            </label>
          ))}
        </div>
      )}
    </FormField>
  )
}

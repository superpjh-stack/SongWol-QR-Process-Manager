/**
 * 폼 제출 오류 매핑 (screens-admin §0.4).
 * 422 → detail[].loc 마지막 요소로 필드 인라인. 매칭 안 되면 폼 상단.
 * 409 DUPLICATE_CODE → `code` 필드 인라인 + 상단. 그 외 → 상단 ErrorAlert.
 */
import { useCallback, useState } from 'react'
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { ApiError, fieldErrorsOf } from '@/shared/api'

export function useFormApiError<T extends FieldValues>(setError: UseFormSetError<T>, fields: readonly string[], codeField: Path<T> | null = null) {
  const [topError, setTopError] = useState<unknown>(null)
  const apply = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 422) {
        let unmatched = false
        for (const fe of fieldErrorsOf(err)) {
          if (fe.field && fields.includes(fe.field)) setError(fe.field as Path<T>, { type: 'server', message: fe.msg })
          else unmatched = true
        }
        setTopError(unmatched || err.detail.length === 0 ? err : null)
        return
      }
      if (err instanceof ApiError && err.status === 409 && err.code === 'DUPLICATE_CODE' && codeField) {
        setError(codeField, { type: 'server', message: err.message })
      }
      setTopError(err)
    },
    [setError, fields, codeField],
  )
  const clear = useCallback(() => setTopError(null), [])
  return { topError, apply, clear }
}

/** 등록 본문: '' → 필드 제외 (선택 필드는 undefined) */
export function stripEmpty<T extends Record<string, unknown>>(values: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) {
    if (v === '' || v === undefined || v === null) continue
    if (typeof v === 'number' && Number.isNaN(v)) continue
    out[k] = v
  }
  return out as Partial<T>
}

/** PATCH 본문: 바뀐 필드만. '' 로 지운 필드는 null (api-contract §1 「null 을 보내면 NULL」) */
export function patchOf<T extends Record<string, unknown>>(values: T, dirty: Partial<Record<keyof T, unknown>>, omit: readonly string[] = []): Partial<Record<keyof T, unknown>> {
  const out: Partial<Record<keyof T, unknown>> = {}
  for (const k of Object.keys(dirty) as Array<keyof T>) {
    if (omit.includes(String(k))) continue
    const v = values[k]
    if (typeof v === 'number' && Number.isNaN(v)) {
      out[k] = null
      continue
    }
    out[k] = v === '' || v === undefined ? null : v
  }
  return out
}

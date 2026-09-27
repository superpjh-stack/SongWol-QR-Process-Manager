/** 값이 `ms` 동안 바뀌지 않으면 반영한다 (typeahead 검색용, screens-admin §2 #6). 첫 값은 즉시 */
import { useEffect, useState } from 'react'

export function useDebouncedValue<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    if (Object.is(debounced, value)) return
    const t = window.setTimeout(() => setDebounced(value), ms)
    return () => window.clearTimeout(t)
    // debounced 는 의도적으로 제외 — value 변경에만 타이머를 다시 건다
  }, [value, ms])
  return debounced
}

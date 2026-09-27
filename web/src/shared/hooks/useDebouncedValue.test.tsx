/** useDebouncedValue — SearchSelect 디바운스(300ms) 의 근거 훅 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebouncedValue } from './useDebouncedValue'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let seen: string[] = []
function Probe({ value }: { value: string }) {
  const d = useDebouncedValue(value, 300)
  seen.push(d)
  return null
}

describe('useDebouncedValue', () => {
  let root: Root
  let el: HTMLDivElement
  beforeEach(() => {
    vi.useFakeTimers()
    seen = []
    el = document.createElement('div')
    document.body.appendChild(el)
    root = createRoot(el)
  })
  afterEach(() => {
    act(() => root.unmount())
    el.remove()
    vi.useRealTimers()
  })

  it('첫 값은 즉시, 이후 값은 300ms 동안 바뀌지 않아야 반영된다', () => {
    act(() => root.render(<Probe value="a" />))
    expect(seen.at(-1)).toBe('a')
    act(() => root.render(<Probe value="ab" />))
    act(() => root.render(<Probe value="abc" />))
    expect(seen.at(-1)).toBe('a') // 아직
    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(seen.at(-1)).toBe('a')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(seen.at(-1)).toBe('abc') // 중간값 'ab' 는 건너뛴다
    expect(seen).not.toContain('ab')
  })
})

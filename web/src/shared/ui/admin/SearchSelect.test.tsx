/** SearchSelect — 타이핑 중에는 검색하지 않고 디바운스 후 1회, 실패는 드롭다운에 드러난다 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SearchSelect } from './SearchSelect'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Opt = { id: number; name: string }
const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
function type(input: HTMLInputElement, v: string) {
  nativeSet.call(input, v)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('SearchSelect', () => {
  let root: Root
  let el: HTMLDivElement
  beforeEach(() => {
    vi.useFakeTimers()
    el = document.createElement('div')
    document.body.appendChild(el)
    root = createRoot(el)
  })
  afterEach(() => {
    act(() => root.unmount())
    el.remove()
    vi.useRealTimers()
  })

  const render = (search: (q: string) => Promise<Opt[]>, onChange = vi.fn()) =>
    act(() => root.render(<SearchSelect<Opt> label="거래처" value={null} onChange={onChange} search={search} getKey={(o) => o.id} getLabel={(o) => o.name} debounceMs={300} />))

  it('포커스 후 타이핑 → 300ms 뒤 마지막 검색어로 1회만 검색하고 결과를 보여준다', async () => {
    const search = vi.fn(async (q: string) => [{ id: 1, name: `결과-${q}` }])
    render(search)
    const input = el.querySelector('input')!
    await act(async () => {
      input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    })
    // 포커스 시 빈 검색('') 1회 (minChars=0)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(search).toHaveBeenCalledTimes(1)
    await act(async () => {
      type(input, '한')
    })
    await act(async () => {
      type(input, '한빛')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299)
    })
    expect(search).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(search).toHaveBeenCalledTimes(2)
    expect(search.mock.calls[1]?.[0]).toBe('한빛')
    expect(el.querySelector('[role="option"]')?.textContent).toBe('결과-한빛')
  })

  it('검색 실패는 드롭다운 안에 문구로 드러난다 (조용한 실패 금지)', async () => {
    const search = vi.fn(async () => {
      throw new Error('네트워크 연결을 확인하세요')
    })
    render(search)
    const input = el.querySelector('input')!
    await act(async () => {
      input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('네트워크 연결을 확인하세요')
  })

  it('옵션 선택 → onChange(item) 후 선택값 표시', async () => {
    const onChange = vi.fn()
    render(async () => [{ id: 7, name: '한빛상사' }], onChange)
    const input = el.querySelector('input')!
    await act(async () => {
      input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(300)
    })
    const opt = el.querySelector('[role="option"]')!
    await act(async () => {
      opt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith({ id: 7, name: '한빛상사' })
  })
})

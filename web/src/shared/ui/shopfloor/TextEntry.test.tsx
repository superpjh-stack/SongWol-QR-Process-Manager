/** TextEntry — 타이핑(onChange)·Enter(onConfirm)와 HID 스캐너 burst 입력(scan 옵션) */
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TextEntry, type TextEntryProps } from './TextEntry'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** HID 스캐너 흉내 — useScannerInput.test.tsx 와 동일한 방식(문자별 keydown + Enter, window 레벨) */
function scan(text: string) {
  for (const ch of text) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }))
  }
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
}

type HarnessProps = Partial<Omit<TextEntryProps, 'value' | 'onChange'>> & { initial?: string }

function Harness({ initial = '', ...rest }: HarnessProps) {
  const [value, setValue] = useState(initial)
  return <TextEntry value={value} onChange={setValue} {...rest} />
}

describe('TextEntry', () => {
  let root: Root
  let el: HTMLDivElement
  beforeEach(() => {
    el = document.createElement('div')
    document.body.appendChild(el)
    root = createRoot(el)
  })
  afterEach(() => {
    act(() => root.unmount())
    el.remove()
  })

  it('scan 옵션이 없으면 스캐너 구독을 하지 않는다 — 스캔을 흉내내도 값이 그대로다', () => {
    act(() => root.render(<Harness />))
    act(() => scan('VB-8801234567890'))
    const input = el.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('scan 을 주면 HID 스캔 결과를 값으로 받는다 (PDA-21: VB 타입만)', () => {
    act(() => root.render(<Harness scan={{ types: ['VB'] }} />))
    act(() => scan('8801234567890'))
    const input = el.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('8801234567890')
  })

  it('types 로 지정한 타입이 아닌 스캔은 무시한다', () => {
    act(() => root.render(<Harness initial="" scan={{ types: ['VB'] }} />))
    act(() => scan('WO-260928-0001'))
    const input = el.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('scan.enabled=false 면 스캐너를 끈다', () => {
    act(() => root.render(<Harness scan={{ types: ['VB'], enabled: false }} />))
    act(() => scan('8801234567890'))
    const input = el.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('사람이 타이핑하면(네이티브 input) onChange 가 그대로 반영된다', () => {
    act(() => root.render(<Harness />))
    const input = el.querySelector('input') as HTMLInputElement
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '123456')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(input.value).toBe('123456')
  })

  it('Enter 를 누르면 onConfirm 을 값과 함께 호출한다', () => {
    const onConfirm = vi.fn()
    act(() => root.render(<Harness initial="1234567890" onConfirm={onConfirm} />))
    const input = el.querySelector('input') as HTMLInputElement
    input.focus()
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    expect(onConfirm).toHaveBeenCalledWith('1234567890')
  })

  it('maxLength 를 넘는 스캔 값은 잘려서 들어간다', () => {
    act(() => root.render(<Harness scan={{ types: ['VB'] }} maxLength={5} />))
    act(() => scan('8801234567890'))
    const input = el.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('88012')
  })

  it('지우기 버튼은 값이 있을 때만 보이고, 누르면 값을 비운다', () => {
    // Harness 는 uncontrolled useState(initial) 이므로, initial 이 바뀐 새 값을 실제로 반영하려면
    // key 로 강제 재마운트해야 한다(같은 컴포넌트 인스턴스면 useState 초기값은 첫 렌더에만 쓰인다).
    act(() => root.render(<Harness key="a" initial="" />))
    expect(el.querySelector('button[aria-label="지우기"]')).toBeNull()

    act(() => root.render(<Harness key="b" initial="hello" />))
    const clearBtn = el.querySelector('button[aria-label="지우기"]') as HTMLButtonElement
    expect(clearBtn).not.toBeNull()
    act(() => clearBtn.click())
    const input = el.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('confirmDisabled 를 생략하면 값이 비어있을 때 [확인] 버튼이 비활성이다', () => {
    act(() => root.render(<Harness key="a" initial="" onConfirm={vi.fn()} />))
    const confirmBtn = [...el.querySelectorAll('button')].find((b) => b.textContent === '확인') as HTMLButtonElement
    expect(confirmBtn.disabled).toBe(true)

    act(() => root.render(<Harness key="b" initial="abc" onConfirm={vi.fn()} />))
    const confirmBtn2 = [...el.querySelectorAll('button')].find((b) => b.textContent === '확인') as HTMLButtonElement
    expect(confirmBtn2.disabled).toBe(false)
  })
})

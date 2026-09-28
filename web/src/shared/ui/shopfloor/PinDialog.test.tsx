/**
 * PinDialog — DEF-QA2-S2-001 회귀: KSK-60 에서 승인자 카드(US-NNNN)를 스캔해도 PIN 입력란이
 * 오염되지 않아야 한다. 이전에는 NumPad 의 전역 keydown 리스너가 카드 코드의 숫자 문자를 그대로
 * PIN 값으로 밀어 넣었다(예: US-0013 스캔 → PIN "13"), 드물게는 스캔의 마지막 Enter 가 NumPad 의
 * confirm() 까지 함께 트리거해 오염된 PIN 으로 조기 제출되기도 했다. 고정: PinDialog 의 NumPad 는
 * `keyboard={false}` 로 물리 키보드 캡처를 꺼서 카드 스캔의 keydown 과 완전히 분리한다.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PinDialog } from './PinDialog'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** HID 스캐너 흉내 — useScannerInput.test.tsx 와 동일한 방식(문자별 keydown + Enter) */
function scan(text: string) {
  for (const ch of text) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }))
  }
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
}

function pinDisplay(el: HTMLElement): string | null {
  return el.querySelector('[data-component="NumPad"] output')?.textContent ?? null
}

function findButton(el: HTMLElement, text: string): HTMLButtonElement {
  const btn = [...el.querySelectorAll('button')].find((b) => b.textContent === text)
  if (!btn) throw new Error(`button "${text}" not found`)
  return btn
}

describe('PinDialog — 승인자 카드 스캔과 PIN 입력 분리 (DEF-QA2-S2-001)', () => {
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

  it('열려 있는 동안 승인자 카드(US-0013)를 스캔해도 PIN 입력란은 비어 있고, 조기 제출도 일어나지 않는다', () => {
    const onSubmit = vi.fn()
    const onApproverScan = vi.fn()
    act(() => root.render(<PinDialog open onSubmit={onSubmit} onCancel={() => {}} onApproverScan={onApproverScan} />))

    act(() => scan('US-0013'))

    // 승인자 카드는 정상적으로 채워진다
    expect(onApproverScan).toHaveBeenCalledWith('US-0013')
    expect(el.textContent).toContain('승인자: US-0013')

    // 하지만 PIN 은 오염되지 않는다 (수정 전엔 '13' 이 들어갔다)
    expect(pinDisplay(el)).toBe('0')

    // 스캔의 마지막 Enter 가 NumPad 의 confirm() 을 트리거해 조기 제출되는 일도 없다
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('카드 스캔 뒤에도 화면 키패드(탭)로 PIN 을 입력해 정상 승인할 수 있다', () => {
    const onSubmit = vi.fn()
    act(() => root.render(<PinDialog open onSubmit={onSubmit} onCancel={() => {}} />))

    act(() => scan('US-0013'))
    expect(pinDisplay(el)).toBe('0')

    for (const d of ['9', '9', '9', '9']) {
      act(() => findButton(el, d).click())
    }
    expect(pinDisplay(el)).toBe('●●●●')

    act(() => findButton(el, '승인').click())
    expect(onSubmit).toHaveBeenCalledWith('9999')
  })

  it('물리 키보드로 숫자를 눌러도(카드 스캔이 아닌 일반 키 입력) PIN 에는 반영되지 않는다 — 터치 키패드 전용', () => {
    act(() => root.render(<PinDialog open onSubmit={vi.fn()} onCancel={() => {}} />))
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '5', bubbles: true, cancelable: true }))
    })
    expect(pinDisplay(el)).toBe('0')
  })

  it('승인 요청이 진행 중(busy)이면 카드 스캔을 보류했다가 끝나면 반영한다', () => {
    const onApproverScan = vi.fn()
    act(() => root.render(<PinDialog open busy onSubmit={vi.fn()} onCancel={() => {}} onApproverScan={onApproverScan} />))

    act(() => scan('US-0013'))
    expect(onApproverScan).not.toHaveBeenCalled()

    act(() => root.render(<PinDialog open busy={false} onSubmit={vi.fn()} onCancel={() => {}} onApproverScan={onApproverScan} />))
    expect(onApproverScan).toHaveBeenCalledWith('US-0013')
  })
})

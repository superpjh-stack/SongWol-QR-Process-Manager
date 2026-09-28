/** useScannerInput — hold 모드: 보류 중엔 onScan 을 미루고, 해제 시 마지막 1건만 방출한다 (KSK-40·KSK-60) */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useScannerInput } from './useScannerInput'
import type { ScanResult } from './parseScanCode'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Harness({ onScan, hold }: { onScan: (r: ScanResult) => void; hold: boolean }) {
  useScannerInput(onScan, { hold })
  return null
}

function scan(text: string) {
  for (const ch of text) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }))
  }
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
}

describe('useScannerInput hold 모드', () => {
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

  it('hold=false 면 스캔을 바로 방출한다', () => {
    const onScan = vi.fn()
    act(() => root.render(<Harness onScan={onScan} hold={false} />))
    act(() => scan('US-0007'))
    expect(onScan).toHaveBeenCalledTimes(1)
    expect(onScan.mock.calls[0]?.[0]).toMatchObject({ type: 'US', code: 'US-0007' })
  })

  it('hold=true 인 동안은 onScan 을 부르지 않고, 여러 건이 와도 최신 1건만 보류한다', () => {
    const onScan = vi.fn()
    act(() => root.render(<Harness onScan={onScan} hold={true} />))
    act(() => scan('US-0007'))
    act(() => scan('US-0009'))
    expect(onScan).not.toHaveBeenCalled()

    // hold 해제 → 보류된 마지막 1건만 방출
    act(() => root.render(<Harness onScan={onScan} hold={false} />))
    expect(onScan).toHaveBeenCalledTimes(1)
    expect(onScan.mock.calls[0]?.[0]).toMatchObject({ type: 'US', code: 'US-0009' })
  })

  it('보류 중 스캔이 없으면 hold 해제 시에도 아무 것도 방출하지 않는다', () => {
    const onScan = vi.fn()
    act(() => root.render(<Harness onScan={onScan} hold={true} />))
    act(() => root.render(<Harness onScan={onScan} hold={false} />))
    expect(onScan).not.toHaveBeenCalled()
  })
})

/**
 * 스모크 테스트 — PDA 발송 세션(P60) 이 실제 백엔드 없이(네트워크 실패 → 오프라인 경로) 로그인 → IDLE →
 * 박스 QR 스캔까지 크래시 없이 렌더링되는지 확인한다.
 */
import 'fake-indexeddb/auto'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ShippingSession } from './ShippingSession'
import { saveStationConfig } from '@/shared/hooks'
import type { Station } from '@/shared/types'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const STATION: Station = {
  id: 'K-P60-1',
  type: 'PDA',
  process_code: 'P60',
  location: null,
  api_key_prefix: 'test',
  last_seen_at: null,
  active: true,
  printer_id: null,
  offline_state: 'ONLINE',
}

function scan(text: string) {
  for (const ch of text) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }))
  }
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
}

async function flush(times = 3) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve()
      await new Promise((r) => setTimeout(r, 0))
    })
  }
}

describe('ShippingSession(P60 발송) 스모크 (네트워크 없이)', () => {
  let root: Root
  let el: HTMLDivElement

  beforeEach(() => {
    localStorage.clear()
    saveStationConfig({ station_id: 'K-P60-1', api_key: 'test-key', printer_id: null, v: '1' })
    el = document.createElement('div')
    document.body.appendChild(el)
    root = createRoot(el)
  })
  afterEach(() => {
    act(() => root.unmount())
    el.remove()
  })

  it('로그인 후 박스 QR 스캔(오프라인, 조회 불가) → BOXES 화면에 코드만 채운 행이 크래시 없이 뜬다', async () => {
    act(() => root.render(<ShippingSession station={STATION} processName="발송" />))
    await flush()

    act(() => scan('US-0007'))
    await flush(5)
    expect(el.textContent).toContain('미검증 작업자 US-0007')

    act(() => scan('LT-261001-0003'))
    await flush(5)

    expect(el.textContent).toContain('LT-261001-0003')
    expect(el.textContent).toContain('오프라인 — 박스 정보 확인 불가')
    expect(el.textContent).toContain('다음: 송장 입력')
  })
})

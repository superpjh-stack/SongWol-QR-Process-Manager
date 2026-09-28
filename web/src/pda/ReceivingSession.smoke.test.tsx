/**
 * 스모크 테스트 — PDA 입고 세션(P20) 이 실제 백엔드 없이(네트워크 실패 → 오프라인 경로) 로그인 → IDLE →
 * WO 스캔까지 크래시 없이 렌더링되는지 확인한다. `kiosk/KioskSession.smoke.test.tsx` 와 같은 원칙.
 */
import 'fake-indexeddb/auto'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ReceivingSession } from './ReceivingSession'
import { saveStationConfig } from '@/shared/hooks'
import type { Station } from '@/shared/types'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const STATION: Station = {
  id: 'K-P20-1',
  type: 'PDA',
  process_code: 'P20',
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

describe('ReceivingSession(P20 입고) 스모크 (네트워크 없이)', () => {
  let root: Root
  let el: HTMLDivElement

  beforeEach(() => {
    localStorage.clear()
    saveStationConfig({ station_id: 'K-P20-1', api_key: 'test-key', printer_id: null, v: '1' })
    el = document.createElement('div')
    document.body.appendChild(el)
    root = createRoot(el)
  })
  afterEach(() => {
    act(() => root.unmount())
    el.remove()
  })

  it('로그인 전에는 작업자 카드 스캔 안내를 보여준다', async () => {
    act(() => root.render(<ReceivingSession station={STATION} processName="입고" />))
    await flush()
    expect(el.textContent).toContain('작업자 카드를 스캔하세요')
  })

  it('카드 스캔(오프라인 로컬 로그인) → IDLE → WO 스캔 → ENTRY(오프라인, 상세 없음) 로 크래시 없이 전환된다', async () => {
    act(() => root.render(<ReceivingSession station={STATION} processName="입고" />))
    await flush()

    act(() => scan('US-0007'))
    await flush(5)
    expect(el.textContent).toContain('미검증 작업자 US-0007')
    expect(el.textContent).toContain('업체 바코드 또는 작업지시 QR 을 스캔하세요')

    act(() => scan('WO-261001-0012'))
    await flush(5)

    expect(el.textContent).toContain('WO-261001-0012')
    expect(el.textContent).toContain('오프라인 — 상세 조회 불가')
  })

  it('미등록 업체 바코드 스캔 → MAPPING 화면(오프라인 안내)으로 전환된다', async () => {
    act(() => root.render(<ReceivingSession station={STATION} processName="입고" />))
    await flush()
    act(() => scan('US-0007'))
    await flush(5)

    act(() => scan('8801234567890'))
    await flush(5)

    expect(el.textContent).toContain('미등록 업체 바코드')
    expect(el.textContent).toContain('8801234567890')
  })
})

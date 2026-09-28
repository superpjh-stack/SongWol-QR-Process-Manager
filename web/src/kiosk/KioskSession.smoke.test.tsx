/**
 * 스모크 테스트 — 실제 백엔드 없이(네트워크 실패 → 오프라인 경로) 로그인 → IDLE → WO 스캔까지
 * 런타임 크래시 없이 렌더링되는지 확인한다. 전체 백엔드 연동은 이 리포에서 재현할 수 없으므로,
 * "구조적으로 완결됐는가"의 최소 증거로 둔다.
 */
import 'fake-indexeddb/auto'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KioskSession } from './KioskSession'
import { saveStationConfig } from '@/shared/hooks'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

describe('KioskSession 스모크 (네트워크 없이)', () => {
  let root: Root
  let el: HTMLDivElement

  beforeEach(() => {
    localStorage.clear()
    saveStationConfig({ station_id: 'K-P30-1', api_key: 'test-key', printer_id: null, v: '1' })
    el = document.createElement('div')
    document.body.appendChild(el)
    root = createRoot(el)
  })
  afterEach(() => {
    act(() => root.unmount())
    el.remove()
  })

  it('로그인 전에는 KSK-01 카드 스캔 안내를 보여준다', async () => {
    act(() => root.render(<KioskSession station={{ id: 'K-P30-1', type: 'KIOSK', process_code: 'P30', location: null, api_key_prefix: 'test', last_seen_at: null, active: true, printer_id: null, offline_state: 'ONLINE' }} processName="인쇄" />))
    await flush()
    expect(el.textContent).toContain('작업자 카드를 스캔하세요')
  })

  it('카드 스캔 → 네트워크 실패 → 오프라인 로컬 로그인 → IDLE 화면', async () => {
    act(() => root.render(<KioskSession station={{ id: 'K-P30-1', type: 'KIOSK', process_code: 'P30', location: null, api_key_prefix: 'test', last_seen_at: null, active: true, printer_id: null, offline_state: 'ONLINE' }} processName="인쇄" />))
    await flush()

    act(() => scan('US-0007'))
    await flush(5)

    expect(el.textContent).toContain('미검증 작업자 US-0007')
    expect(el.textContent).toContain('QR을 스캔하세요') // KSK-10 IDLE 로 전환됨
  })

  it('로그인 후 WO 스캔 → SCANNED 화면(오프라인, 캐시 없음)으로 크래시 없이 전환된다', async () => {
    act(() => root.render(<KioskSession station={{ id: 'K-P30-1', type: 'KIOSK', process_code: 'P30', location: null, api_key_prefix: 'test', last_seen_at: null, active: true, printer_id: null, offline_state: 'ONLINE' }} processName="인쇄" />))
    await flush()
    act(() => scan('US-0007'))
    await flush(5)

    act(() => scan('WO-261001-0012'))
    await flush(5)

    expect(el.textContent).toContain('WO-261001-0012')
    expect(el.textContent).toContain('오프라인 — 상세 조회 불가')
  })
})

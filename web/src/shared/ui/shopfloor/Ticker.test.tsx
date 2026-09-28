/** Ticker — 30초 노출, 제어형(onExpire)/비제어형(내부 순환), type=DELAY 빨강 표시 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Ticker, type TickerItem } from './Ticker'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ITEMS: TickerItem[] = [
  { id: '1', type: 'DELAY', targetCode: 'SO-0001', message: '납기 지연 위험' },
  { id: '2', type: 'DEFECT', targetCode: 'WO-0002', message: '불량 3건 발생' },
  { id: '3', type: 'APPROVAL_REQUEST', targetCode: 'WO-0003', message: '반장 승인 대기' },
]

describe('Ticker', () => {
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

  it('항목이 없으면 emptyText 를 보여준다', () => {
    act(() => root.render(<Ticker items={[]} emptyText="알림 없음" />))
    expect(el.textContent).toContain('알림 없음')
  })

  it('첫 항목을 「type · code · message」 형식으로 보여주고, type=DELAY 는 빨강(아이콘 포함)이다', () => {
    act(() => root.render(<Ticker items={ITEMS} />))
    expect(el.textContent).toContain('지연')
    expect(el.textContent).toContain('SO-0001')
    expect(el.textContent).toContain('납기 지연 위험')
    const wrap = el.querySelector('[data-component="Ticker"] > div')!
    expect(wrap.className).toContain('text-status-error-fg')
    expect(wrap.querySelector('svg')).not.toBeNull() // 경고 아이콘 — 색만으로 구분하지 않는다
  })

  it('비제어형: dwellMs 마다 다음 항목으로 순환하고 마지막 다음은 처음으로 돌아온다', () => {
    act(() => root.render(<Ticker items={ITEMS} dwellMs={30_000} />))
    expect(el.textContent).toContain('SO-0001')

    act(() => {
      vi.advanceTimersByTime(29_999)
    })
    expect(el.textContent).toContain('SO-0001') // 아직 30초 전

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(el.textContent).toContain('WO-0002')

    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(el.textContent).toContain('WO-0003')

    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(el.textContent).toContain('SO-0001') // 순환
  })

  it('제어형: dwellMs 뒤 onExpire(id) 를 한 번 부르고, 화면이 큐에서 지우면 다음 항목을 보여준다', () => {
    const onExpire = vi.fn()
    act(() => root.render(<Ticker items={ITEMS} dwellMs={30_000} onExpire={onExpire} />))

    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(onExpire).toHaveBeenCalledTimes(1)
    expect(onExpire).toHaveBeenCalledWith('1')
    // 아직 화면이 큐를 지우지 않았으면 같은 항목을 계속 보여준다 (내부적으로 자동 순환하지 않는다)
    expect(el.textContent).toContain('SO-0001')

    const rest = ITEMS.slice(1)
    act(() => root.render(<Ticker items={rest} dwellMs={30_000} onExpire={onExpire} />))
    expect(el.textContent).toContain('WO-0002')

    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(onExpire).toHaveBeenCalledTimes(2)
    expect(onExpire).toHaveBeenLastCalledWith('2')
  })

  it('항목이 1개뿐이고 비제어형이면 계속 그 항목만 보여준다', () => {
    act(() => root.render(<Ticker items={[ITEMS[0]!]} dwellMs={30_000} />))
    act(() => {
      vi.advanceTimersByTime(90_000)
    })
    expect(el.textContent).toContain('SO-0001')
  })
})

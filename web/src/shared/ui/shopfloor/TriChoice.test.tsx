/** TriChoice — 기본 선택 없음(no-default) 강제, 3버튼 색+아이콘+문구, 선택 시 onChange */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TriChoice, isTriChoiceSelected } from './TriChoice'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('TriChoice', () => {
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

  it('기본 선택 없음 — value=null 이면 세 버튼 모두 aria-checked=false 이고 경고 문구를 보여준다', () => {
    const onChange = vi.fn()
    act(() => root.render(<TriChoice value={null} onChange={onChange} />))

    const radios = [...el.querySelectorAll('[role="radio"]')]
    expect(radios).toHaveLength(3)
    expect(radios.every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true)
    expect(el.textContent).toContain('검수결과를 선택하세요')
  })

  it('합격/조건부/불합격 순서로 문구를 보여주고, 탭하면 해당 코드로 onChange 한다', () => {
    const onChange = vi.fn()
    act(() => root.render(<TriChoice value={null} onChange={onChange} />))

    const radios = [...el.querySelectorAll('[role="radio"]')]
    expect(radios.map((r) => r.textContent)).toEqual(['합격', '조건부', '불합격'])

    act(() => (radios[1] as HTMLButtonElement).click())
    expect(onChange).toHaveBeenCalledWith('COND')
  })

  it('value 가 주어지면 해당 버튼만 aria-checked=true 이고 경고 문구가 사라진다', () => {
    const onChange = vi.fn()
    act(() => root.render(<TriChoice value="PASS" onChange={onChange} />))

    const radios = [...el.querySelectorAll('[role="radio"]')]
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
    expect(el.textContent).not.toContain('검수결과를 선택하세요')
  })

  it('다른 값을 눌러도 다시 렌더될 때까지는 이전 선택이 유지된다 (완전 제어 컴포넌트 — 자체 상태로 기본값을 만들지 않는다)', () => {
    const onChange = vi.fn()
    act(() => root.render(<TriChoice value={null} onChange={onChange} />))
    const radios = [...el.querySelectorAll('[role="radio"]')]
    act(() => (radios[2] as HTMLButtonElement).click())
    expect(onChange).toHaveBeenCalledWith('FAIL')
    // 부모가 value 를 갱신하지 않으면(제어값 그대로) 여전히 미선택 상태다 — 컴포넌트가 알아서 기본값을 골라주지 않는다
    const stillRadios = [...el.querySelectorAll('[role="radio"]')]
    expect(stillRadios.every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true)
  })

  it('isTriChoiceSelected — null 이면 false, 값이 있으면 true', () => {
    expect(isTriChoiceSelected(null)).toBe(false)
    expect(isTriChoiceSelected('PASS')).toBe(true)
    expect(isTriChoiceSelected('COND')).toBe(true)
    expect(isTriChoiceSelected('FAIL')).toBe(true)
  })
})

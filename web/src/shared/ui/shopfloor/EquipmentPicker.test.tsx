/** EquipmentPicker — 그룹핑·단일 선택·마지막 선택 기억(rememberKey)·자동 선택·빈 상태 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EquipmentPicker, readRememberedEquipment, type EquipmentOption } from './EquipmentPicker'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const OPTIONS: EquipmentOption[] = [
  { code: 'PRT-01', name: '나염기 1호', equipType: 'PRINT' },
  { code: 'PRT-02', name: '나염기 2호', equipType: 'PRINT' },
  { code: 'EMB-01', name: '자수기 1호', equipType: 'EMB' },
]

describe('EquipmentPicker', () => {
  let root: Root
  let el: HTMLDivElement
  beforeEach(() => {
    localStorage.clear()
    el = document.createElement('div')
    document.body.appendChild(el)
    root = createRoot(el)
  })
  afterEach(() => {
    act(() => root.unmount())
    el.remove()
  })

  it('equip_type 별로 그룹핑해 칩을 나열하고, 탭하면 onChange + rememberKey 로 기억한다', () => {
    const onChange = vi.fn()
    act(() => root.render(<EquipmentPicker options={OPTIONS} value={null} onChange={onChange} rememberKey="SCREEN" />))

    const buttons = [...el.querySelectorAll('button')]
    expect(buttons.map((b) => b.textContent)).toEqual(['나염기 1호', '나염기 2호', '자수기 1호'])

    act(() => buttons[1]!.click())
    expect(onChange).toHaveBeenCalledWith('PRT-02')
    expect(readRememberedEquipment('SCREEN')).toBe('PRT-02')
  })

  it('rememberKey 에 저장된 마지막 선택이 있고 value 가 없으면 자동으로 그 값을 onChange 한다', () => {
    localStorage.setItem('sw.equip.last.SCREEN', 'EMB-01')
    const onChange = vi.fn()
    act(() => root.render(<EquipmentPicker options={OPTIONS} value={null} onChange={onChange} rememberKey="SCREEN" />))
    expect(onChange).toHaveBeenCalledWith('EMB-01')
  })

  it('기억된 값이 지금 옵션 목록에 없으면 자동 선택하지 않는다', () => {
    localStorage.setItem('sw.equip.last.SCREEN', 'GONE-01')
    const onChange = vi.fn()
    act(() => root.render(<EquipmentPicker options={OPTIONS} value={null} onChange={onChange} rememberKey="SCREEN" />))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('옵션이 정확히 1개면 rememberKey 없이도 자동 선택한다', () => {
    const onChange = vi.fn()
    act(() => root.render(<EquipmentPicker options={[OPTIONS[0]!]} value={null} onChange={onChange} />))
    expect(onChange).toHaveBeenCalledWith('PRT-01')
  })

  it('이미 선택된 값(value)이 있으면 자동 선택을 덮어쓰지 않는다', () => {
    const onChange = vi.fn()
    act(() => root.render(<EquipmentPicker options={OPTIONS} value="PRT-01" onChange={onChange} rememberKey="SCREEN" />))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('옵션이 0개면 안내 문구를 보여준다 (기본 문구)', () => {
    const onChange = vi.fn()
    act(() => root.render(<EquipmentPicker options={[]} value={null} onChange={onChange} />))
    expect(el.textContent).toContain('이 가공방식에 맞는 설비가 등록되지 않았습니다')
    expect(el.querySelectorAll('button')).toHaveLength(0)
  })
})

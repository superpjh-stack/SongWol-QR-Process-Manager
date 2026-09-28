/** ScanList — 합계 줄, 행 [빼기] 로컬 삭제, 중복 판정 헬퍼, 오프라인/경고 행 표시 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScanList, hasScanListDuplicate, sumScanListQty, type ScanListRow } from './ScanList'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ROWS: ScanListRow[] = [
  { id: 'LT-260928-0001', code: 'LT-260928-0001', woCode: 'WO-260928-0001', boxNo: 1, qty: 50, customerName: '송월타월', status: 'ok' },
  {
    id: 'LT-260928-0002',
    code: 'LT-260928-0002',
    woCode: 'WO-260928-0002',
    boxNo: 1,
    qty: 30,
    customerName: '거래처B',
    status: 'warn',
    note: '다른 수주(SO-260928-0009)의 박스입니다 — 송장이 분리됩니다',
  },
  { id: 'LT-260928-0003', code: 'LT-260928-0003', woCode: null, boxNo: null, qty: null, customerName: null, status: 'offline' },
]

describe('hasScanListDuplicate / sumScanListQty', () => {
  it('같은 code 가 이미 있으면 중복으로 판정한다', () => {
    expect(hasScanListDuplicate(ROWS, 'LT-260928-0001')).toBe(true)
    expect(hasScanListDuplicate(ROWS, 'LT-260928-9999')).toBe(false)
  })

  it('합계는 qty 를 모르는(오프라인) 행을 0 으로 셈한다', () => {
    expect(sumScanListQty(ROWS)).toBe(80) // 50 + 30 + (offline 0)
    expect(sumScanListQty([])).toBe(0)
  })
})

describe('ScanList', () => {
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

  it('빈 목록이면 안내 문구를 보여주고, 합계 줄은 0개·0장', () => {
    const onRemove = vi.fn()
    act(() => root.render(<ScanList rows={[]} onRemove={onRemove} />))
    expect(el.textContent).toContain('스캔한 항목이 없습니다')
    expect(el.textContent).toContain('박스 0개')
    expect(el.textContent).toContain('합계 0장')
  })

  it('행마다 code·wo_code·box_no·qty·거래처를 보여주고, 합계 줄에 박스 N개·Σqty장을 낸다', () => {
    const onRemove = vi.fn()
    act(() => root.render(<ScanList rows={ROWS} onRemove={onRemove} />))
    expect(el.textContent).toContain('LT-260928-0001')
    expect(el.textContent).toContain('WO-260928-0001')
    expect(el.textContent).toContain('송월타월')
    expect(el.textContent).toContain('박스 3개')
    expect(el.textContent).toContain('합계 80장')
  })

  it('오프라인 행은 "정보 없음"과 오프라인 안내를 보여준다 (색만으로 구분하지 않는다 — 아이콘+문구)', () => {
    const onRemove = vi.fn()
    act(() => root.render(<ScanList rows={ROWS} onRemove={onRemove} />))
    expect(el.textContent).toContain('정보 없음')
    expect(el.textContent).toContain('오프라인 — 박스 정보 확인 불가')
  })

  it('다른 SO 경고 행은 note 문구를 그대로 보여준다', () => {
    const onRemove = vi.fn()
    act(() => root.render(<ScanList rows={ROWS} onRemove={onRemove} />))
    expect(el.textContent).toContain('다른 수주(SO-260928-0009)의 박스입니다 — 송장이 분리됩니다')
  })

  it('[빼기] 버튼을 누르면 그 행의 id 로 onRemove 를 호출한다 (로컬 삭제 — 컴포넌트 자신은 목록을 지우지 않는다)', () => {
    const onRemove = vi.fn()
    act(() => root.render(<ScanList rows={ROWS} onRemove={onRemove} />))
    const removeButtons = [...el.querySelectorAll('button')].filter((b) => b.textContent?.includes('빼기'))
    expect(removeButtons).toHaveLength(3)

    act(() => removeButtons[1]!.click())
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onRemove).toHaveBeenCalledWith('LT-260928-0002')

    // 화면이 rows 를 갱신하기 전까지는(제어 컴포넌트) 행이 그대로 남아있다
    expect(el.textContent).toContain('LT-260928-0002')
  })
})

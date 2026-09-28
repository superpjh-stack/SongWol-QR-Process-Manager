/**
 * DesignThumbnail — F37 회귀: 키오스크 도안 썸네일은 단말 키(X-Station-Key)로 fetch→blob→objectURL 그린다
 * (평범한 <img src> 는 GET /designs/{id}/thumbnail 이 요구하는 인증 헤더를 못 붙여 매 스캔마다 401 이 났다).
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STATION_KEY } from '../../hooks/useStationConfig'
import { DesignThumbnail } from './DesignThumbnail'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('DesignThumbnail', () => {
  let root: Root
  let el: HTMLDivElement
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:thumb'), revokeObjectURL: vi.fn() })
    fetchMock.mockReset()
    el = document.createElement('div')
    document.body.appendChild(el)
    root = createRoot(el)
  })
  afterEach(() => {
    act(() => root.unmount())
    el.remove()
    vi.unstubAllGlobals()
  })

  it('단말 키(X-Station-Key) 헤더로 썸네일을 요청하고, JWT(Authorization) 는 붙이지 않는다', async () => {
    localStorage.setItem(STATION_KEY, JSON.stringify({ station_id: 'K-P30-1', api_key: 'stationkey123', printer_id: null, v: '1', saved_at: '' }))
    fetchMock.mockResolvedValueOnce(new Response(new Blob(['x']), { status: 200 }))

    act(() => root.render(<DesignThumbnail src="/api/v1/designs/1/thumbnail" />))
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [path, init] = fetchMock.mock.calls[0]!
    expect(String(path)).toContain('/api/v1/designs/1/thumbnail')
    const headers = init?.headers as Record<string, string>
    expect(headers['X-Station-Key']).toBe('stationkey123')
    expect(headers.Authorization).toBeUndefined()

    const img = el.querySelector('img')
    expect(img?.getAttribute('src')).toBe('blob:thumb')
  })

  it('src 가 없으면 "도안 없음" 자리표시자만 보여주고 fetch 하지 않는다', async () => {
    act(() => root.render(<DesignThumbnail src={null} />))
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(el.textContent).toContain('도안 없음')
  })

  it('401 등 실패 시 조용히 깨지지 않고 실패 문구를 보여준다', async () => {
    localStorage.setItem(STATION_KEY, JSON.stringify({ station_id: 'K-P30-1', api_key: 'bad', printer_id: null, v: '1', saved_at: '' }))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'BAD_STATION_KEY', message: '단말 인증 실패' }), { status: 401 }))

    act(() => root.render(<DesignThumbnail src="/api/v1/designs/1/thumbnail" />))
    await flush()

    expect(el.querySelector('img')).toBeNull()
    expect(el.textContent).toContain('도안을 불러올 수 없습니다')
  })
})

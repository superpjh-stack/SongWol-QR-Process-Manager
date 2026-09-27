/** client.ts — 오류 매핑·토큰·401 처리 (api-contract §3, screens-admin §0.4) */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, clearToken, downloadBlob, getToken, qs, setToken, setUnauthorizedHandler, toApiError } from './client'
import { fieldErrorsOf, toErrorView } from './errors'

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

describe('client', () => {
  const fetchMock = vi.fn<typeof fetch>()
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    clearToken()
    setUnauthorizedHandler(null)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('4xx 본문 {code,message,detail} 을 ApiError 로 매핑한다', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { code: 'WO_NOT_FOUND', message: '작업지시 WO-261001-0012 을(를) 찾을 수 없습니다', detail: [] }))
    const err = await api.get('/api/v1/wo/WO-261001-0012').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    const e = err as ApiError
    expect(e.status).toBe(404)
    expect(e.code).toBe('WO_NOT_FOUND')
    expect(e.message).toBe('작업지시 WO-261001-0012 을(를) 찾을 수 없습니다')
    expect(e.detail).toEqual([])
  })

  it('422 detail[].loc 마지막 요소로 필드를 특정한다', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(422, {
        code: 'VALIDATION_ERROR',
        message: '입력값 오류',
        detail: [
          { loc: ['body', 'qty'], msg: '0 보다 커야 합니다', type: 'greater_than' },
          { loc: ['body'], msg: '본문 오류', type: 'x' },
        ],
      }),
    )
    const e = (await api.post('/api/v1/so', {}).catch((x: unknown) => x)) as ApiError
    expect(fieldErrorsOf(e)).toEqual([
      { field: 'qty', msg: '0 보다 커야 합니다' },
      { field: null, msg: '본문 오류' },
    ])
    expect(toErrorView(e).retryable).toBe(false)
  })

  it('본문이 JSON 이 아니면 상태별 기본 code·message 를 쓴다', () => {
    const e = toApiError(503, '<html>gateway</html>')
    expect(e.code).toBe('DB_UNAVAILABLE')
    expect(toErrorView(e)).toMatchObject({ title: '서비스 일시 중단', retryable: true })
    expect(toApiError(409, null).code).toBe('STATE_CONFLICT')
    expect(toErrorView(toApiError(403, null))).toMatchObject({ title: '접근 권한이 없습니다', retryable: false })
  })

  it('fetch 자체 실패는 NETWORK_ERROR (status 0, 재시도 가능)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const e = (await api.get('/api/v1/customers').catch((x: unknown) => x)) as ApiError
    expect(e.status).toBe(0)
    expect(e.code).toBe('NETWORK_ERROR')
    expect(toErrorView(e)).toMatchObject({ message: '네트워크 연결을 확인하세요', retryable: true })
  })

  it('토큰이 있으면 Authorization: Bearer 를 붙이고, JSON 본문은 Content-Type 을 붙인다', async () => {
    setToken('tok.en')
    fetchMock.mockResolvedValue(jsonResponse(201, { id: 1 }))
    await api.post('/api/v1/customers', { code: 'C1' })
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    const h = init.headers as Record<string, string>
    expect(h.Authorization).toBe('Bearer tok.en')
    expect(h['Content-Type']).toBe('application/json')
    expect(init.body).toBe(JSON.stringify({ code: 'C1' }))
  })

  it('FormData 는 그대로 보내고 Content-Type 을 강제하지 않는다 (multipart)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { batch_id: 1 }))
    const fd = new FormData()
    fd.append('entity', 'customer')
    await api.post('/api/v1/master/import/preview', fd)
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.body).toBe(fd)
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  it('401 이면 토큰을 지우고 onUnauthorized 를 부른다', async () => {
    setToken('expired')
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    fetchMock.mockResolvedValue(jsonResponse(401, { code: 'TOKEN_EXPIRED', message: '만료', detail: [] }))
    const e = (await api.get('/api/v1/auth/me').catch((x: unknown) => x)) as ApiError
    expect(e.code).toBe('TOKEN_EXPIRED')
    expect(getToken()).toBeNull()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('로그인 요청의 401 (skipUnauthorized) 은 리다이렉트하지 않는다', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    fetchMock.mockResolvedValue(jsonResponse(401, { code: 'UNAUTHENTICATED', message: '아이디 또는 비밀번호가 올바르지 않습니다', detail: [] }))
    const e = (await api.post('/api/v1/auth/login', { login_id: 'a', password: 'b' }, { skipUnauthorized: true }).catch((x: unknown) => x)) as ApiError
    expect(e.message).toBe('아이디 또는 비밀번호가 올바르지 않습니다')
    expect(handler).not.toHaveBeenCalled()
  })

  it('204/빈 본문은 null 을 돌려준다', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
    await expect(api.post('/api/v1/users/1/set-pin', { pin: '1234' })).resolves.toBeNull()
  })

  it('qs 는 undefined·null·빈 문자열을 뺀다', () => {
    expect(qs({ q: '', active: true, page: 1, size: undefined, sort: null, item_group: 'TOWEL_40' })).toBe('?active=true&page=1&item_group=TOWEL_40')
    expect(qs({})).toBe('')
  })

  it('downloadBlob 은 JWT 헤더로 받아 Content-Disposition 파일명을 쓰고, 실패는 ApiError 다', async () => {
    setToken('tok')
    fetchMock.mockResolvedValueOnce(
      new Response(new Blob(['x']), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': "attachment; filename*=UTF-8''%EA%B1%B0%EB%9E%98%EC%B2%98.xlsx",
        },
      }),
    )
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() })
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const r = await downloadBlob('/api/v1/master/import/template?entity=customer', 'fallback.xlsx')
    expect(r.filename).toBe('거래처.xlsx')
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization).toBe('Bearer tok')
    expect(clickSpy).toHaveBeenCalled()

    fetchMock.mockResolvedValueOnce(jsonResponse(403, { code: 'FORBIDDEN', message: '접근 권한이 없습니다', detail: [] }))
    await expect(downloadBlob('/api/v1/master/import/template?entity=stock')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
  })
})

/**
 * API 클라이언트. 상대경로(BASE_URL='')로 호출하고 dev 는 vite proxy, prod 는 nginx 가 /api 를 backend 로 보낸다.
 *
 * - 실패는 throw 한다 (`ApiError{status, code, message, detail}` — api-contract §3.1). fallback 인자는 두지 않는다.
 * - 사용자 JWT 는 localStorage `sw.jwt` (screens-admin §0.7 기본값). 있으면 `Authorization: Bearer` 를 붙인다.
 * - 401 (`UNAUTHENTICATED`·`TOKEN_EXPIRED`) 이면 토큰을 지우고 `onUnauthorized` 핸들러를 부른다 (라우터가 /login?next= 로 보낸다).
 *   로그인 요청 자체의 401 은 예외 (토큰이 없으므로 리다이렉트하지 않는다).
 * - 파일 다운로드(xlsx·PDF)는 `downloadBlob()` — JWT 헤더가 필요해 <a href> 를 쓰지 않는다 (§0.3).
 */
import type { ApiError as ApiErrorBody } from '../types'
import { ERROR_CODE_MESSAGES } from './errorCodes'

export const BASE_URL = ''
export const API_PREFIX = '/api/v1'
export const TOKEN_KEY = 'sw.jwt'

export type ApiErrorDetail = ApiErrorBody['detail']

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly detail: ApiErrorDetail
  readonly body: unknown
  /** 429 `Retry-After` 초 (없으면 null) */
  readonly retryAfter: number | null
  constructor(status: number, code: string, message: string, detail: ApiErrorDetail = [], body: unknown = null, retryAfter: number | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.detail = detail
    this.body = body
    this.retryAfter = retryAfter
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError
}

/* ── 토큰 저장 ─────────────────────────────────────────────── */
export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

let unauthorizedHandler: (() => void) | null = null
/** 401 수신 시 호출될 핸들러 (useAuth 가 등록). 토큰은 이미 지워진 뒤 불린다. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn
}

/* ── 오류 본문 해석 ────────────────────────────────────────── */
const STATUS_FALLBACK: Record<number, { code: string; message: string }> = {
  401: { code: 'UNAUTHENTICATED', message: '로그인이 필요합니다' },
  403: { code: 'FORBIDDEN', message: '접근 권한이 없습니다' },
  404: { code: 'NOT_FOUND', message: '찾을 수 없습니다' },
  409: { code: 'STATE_CONFLICT', message: '현재 상태에서 처리할 수 없습니다' },
  422: { code: 'VALIDATION_ERROR', message: '입력값을 확인하세요' },
  423: { code: 'LOCKED', message: '잠시 후 다시 시도하세요' },
  429: { code: 'TOO_MANY_REQUESTS', message: '요청이 너무 많습니다 — 잠시 후 다시 시도하세요' },
  500: { code: 'INTERNAL_ERROR', message: '서버 오류 — 잠시 후 다시 시도하세요' },
  502: { code: 'BAD_GATEWAY', message: '서비스에 연결할 수 없습니다' },
  503: { code: 'DB_UNAVAILABLE', message: '서비스 일시 중단' },
}

/** 응답 → ApiError. message: 서버 message → 코드표(§14.2) → 상태별 기본 */
export function toApiError(status: number, parsed: unknown, fallbackMessage?: string, headers?: Headers): ApiError {
  const fb = STATUS_FALLBACK[status] ?? { code: `HTTP_${status}`, message: fallbackMessage ?? `요청 실패 (${status})` }
  const ra = headers?.get('Retry-After')
  const retryAfter = ra !== null && ra !== undefined && /^\d+$/.test(ra.trim()) ? Number(ra) : null
  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>
    const code = typeof o.code === 'string' ? o.code : fb.code
    const message = typeof o.message === 'string' && o.message ? o.message : (ERROR_CODE_MESSAGES[code] ?? fb.message)
    const detail = Array.isArray(o.detail) ? (o.detail as ApiErrorDetail) : []
    return new ApiError(status, code, message, detail, parsed, retryAfter)
  }
  return new ApiError(status, fb.code, fb.message, [], parsed, retryAfter)
}

export const NETWORK_ERROR = { code: 'NETWORK_ERROR', message: '네트워크 연결을 확인하세요' } as const

/* ── 요청 ──────────────────────────────────────────────────── */
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type RequestOptions = {
  method?: Method
  /** 객체는 JSON, FormData 는 multipart 로 보낸다 */
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
  /** 401 이어도 토큰 삭제·리다이렉트를 하지 않는다 (로그인 요청) */
  skipUnauthorized?: boolean
}

function authHeaders(): Record<string, string> {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

function handleUnauthorized(opts: RequestOptions) {
  if (opts.skipUnauthorized) return
  if (!getToken()) return
  clearToken()
  unauthorizedHandler?.()
}

async function doFetch(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${BASE_URL}${path}`, init)
  } catch {
    throw new ApiError(0, NETWORK_ERROR.code, NETWORK_ERROR.message)
  }
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, signal } = opts
  const init: RequestInit = {
    method,
    headers: { Accept: 'application/json', ...authHeaders(), ...headers },
    credentials: 'same-origin',
  }
  if (signal) init.signal = signal
  if (body instanceof FormData) {
    init.body = body
  } else if (body !== undefined) {
    init.headers = { ...(init.headers as Record<string, string>), 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }

  const res = await doFetch(path, init)
  const parsed = await parseBody(res)

  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(opts)
    throw toApiError(res.status, parsed, undefined, res.headers)
  }
  return parsed as T
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) => request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  delete: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) => request<T>(path, { ...opts, method: 'DELETE' }),
}

/* ── 쿼리 문자열 ───────────────────────────────────────────── */
export type QueryParams = Record<string, string | number | boolean | null | undefined>

/** undefined·null·'' 은 뺀다. 값은 문자열화 */
export function qs(params?: QueryParams): string {
  if (!params) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/* ── 파일 다운로드 ─────────────────────────────────────────── */
function filenameFromDisposition(h: string | null): string | null {
  if (!h) return null
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(h)
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''))
    } catch {
      /* fallthrough */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(h)
  return plain?.[1]?.trim() ?? null
}

export type DownloadResult = { filename: string; size: number; type: string }

/** JWT 헤더로 blob 을 받는다 (이미지 표시용 — AuthImage). 실패는 ApiError throw */
export async function fetchBlob(path: string): Promise<Blob> {
  const res = await doFetch(path, { method: 'GET', headers: { ...authHeaders() }, credentials: 'same-origin' })
  if (!res.ok) {
    const parsed = await parseBody(res)
    if (res.status === 401) handleUnauthorized({})
    throw toApiError(res.status, parsed, undefined, res.headers)
  }
  return res.blob()
}

/**
 * JWT 헤더로 blob 을 받아 브라우저 저장 대화상자를 띄운다 (fetch → blob → objectURL, screens-admin §0.3).
 * 파일명은 서버 `Content-Disposition` 우선, 없으면 `fallbackName`.
 * 실패는 ApiError throw (본문이 JSON 오류면 그대로 매핑).
 */
export async function downloadBlob(path: string, fallbackName = 'download'): Promise<DownloadResult> {
  const res = await doFetch(path, { method: 'GET', headers: { ...authHeaders() }, credentials: 'same-origin' })
  if (!res.ok) {
    const parsed = await parseBody(res)
    if (res.status === 401) handleUnauthorized({})
    throw toApiError(res.status, parsed, undefined, res.headers)
  }
  const blob = await res.blob()
  const filename = filenameFromDisposition(res.headers.get('Content-Disposition')) ?? fallbackName
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    // 클릭이 처리될 시간을 준 뒤 해제
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
  return { filename, size: blob.size, type: blob.type }
}

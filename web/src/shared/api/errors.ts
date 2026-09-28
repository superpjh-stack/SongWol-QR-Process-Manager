/**
 * ApiError → 화면 표시 규칙 (screens-admin §0.4 상태 처리 기본형). 문구 원천은 api-contract §14.2 표(errorCodes.ts).
 * 화면은 이 함수 결과를 ErrorAlert 에 넘긴다.
 */
import { ApiError, NETWORK_ERROR } from './client'
import { ERROR_CODE_MESSAGES, lockedMessage } from './errorCodes'

export type ErrorView = {
  title: string
  message: string
  /** 재시도 버튼을 둘지 (4xx 는 없음, 네트워크·423·5xx 만) */
  retryable: boolean
  status: number
  code: string
}

const TITLE_BY_STATUS: Record<number, string> = {
  400: '유효하지 않은 코드',
  401: '로그인이 필요합니다',
  403: '접근 권한이 없습니다',
  404: '찾을 수 없습니다',
  409: '처리할 수 없습니다',
  413: '파일이 너무 큽니다',
  422: '입력값 오류',
  423: '잠시 후 다시 시도',
  429: '잠금',
  500: '서버 오류',
  503: '서비스 일시 중단',
}

export function toErrorView(err: unknown): ErrorView {
  if (!(err instanceof ApiError)) {
    const message = err instanceof Error ? err.message : String(err)
    return { title: '오류', message, retryable: true, status: -1, code: 'UNKNOWN' }
  }
  const { status, code, retryAfter } = err
  const message = err.message || ERROR_CODE_MESSAGES[code] || `요청 실패 (${status})`
  if (status === 0 || code === NETWORK_ERROR.code) return { title: '네트워크 오류', message: NETWORK_ERROR.message, retryable: true, status, code }
  switch (code) {
    case 'PIN_NOT_SET':
      return { title: 'PIN 미설정', message, retryable: false, status, code }
    case 'PREFIX_FIXED':
      return { title: '접두사는 변경할 수 없습니다', message, retryable: false, status, code }
    case 'LOGIN_LOCKED':
    case 'PIN_LOCKED':
      return { title: code === 'LOGIN_LOCKED' ? '로그인 잠금' : 'PIN 잠금', message: lockedMessage(code, retryAfter), retryable: false, status, code }
    case 'PRINTER_UNREACHABLE':
      return { title: '프린터 오류', message: `${message} — 다시 시도`, retryable: true, status, code }
    default:
      break
  }
  const title = TITLE_BY_STATUS[status] ?? '오류'
  const retryable = status === 423 || status === 429 || status >= 500
  return { title, message, retryable, status, code }
}

/** 422 detail[].loc 의 마지막 요소 → 필드명 (screens-admin §0.4). 매칭 안 되면 null */
export function fieldErrorsOf(err: ApiError): Array<{ field: string | null; msg: string }> {
  if (err.status !== 422) return []
  return err.detail.map((d) => {
    const loc = Array.isArray((d as { loc?: unknown }).loc) ? ((d as { loc: (string | number)[] }).loc ?? []) : []
    const msg = typeof (d as { msg?: unknown }).msg === 'string' ? (d as { msg: string }).msg : err.message
    const last = loc.length ? loc[loc.length - 1] : null
    return { field: typeof last === 'string' && last !== 'body' ? last : null, msg }
  })
}

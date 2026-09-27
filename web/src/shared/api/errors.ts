/**
 * ApiError → 화면 표시 규칙 (screens-admin §0.4 상태 처리 기본형). 화면은 이 함수 결과를 ErrorAlert 에 넘긴다.
 */
import { ApiError, NETWORK_ERROR } from './client'

export type ErrorView = {
  title: string
  message: string
  /** 재시도 버튼을 둘지 (403·404·409·422 는 없음) */
  retryable: boolean
  status: number
  code: string
}

export function toErrorView(err: unknown): ErrorView {
  if (!(err instanceof ApiError)) {
    const message = err instanceof Error ? err.message : String(err)
    return { title: '오류', message, retryable: true, status: -1, code: 'UNKNOWN' }
  }
  const { status, code, message } = err
  if (status === 0 || code === NETWORK_ERROR.code) return { title: '네트워크 오류', message: NETWORK_ERROR.message, retryable: true, status, code }
  switch (status) {
    case 401:
      return { title: '로그인이 필요합니다', message, retryable: false, status, code }
    case 403:
      return { title: '접근 권한이 없습니다', message, retryable: false, status, code }
    case 404:
      return { title: '찾을 수 없습니다', message, retryable: false, status, code }
    case 409:
      return { title: '처리할 수 없습니다', message, retryable: false, status, code }
    case 422:
      return { title: '입력값 오류', message, retryable: false, status, code }
    case 423:
      return { title: '잠시 후 다시 시도', message, retryable: true, status, code }
    case 503:
      return {
        title: '서비스 일시 중단',
        message: code === 'PRINTER_UNREACHABLE' ? '프린터에 연결할 수 없습니다 — 다시 시도' : message,
        retryable: true,
        status,
        code,
      }
    default:
      return { title: '오류', message, retryable: status >= 500, status, code }
  }
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

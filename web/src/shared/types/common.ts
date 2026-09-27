/** 공통 — contracts/ts-types.md §3 */
import type { TargetType } from './enums'

export interface Page<T> {
  items: T[]
  page: number
  size: number
  total: number
}

/** api-contract §3.1 오류 본문 */
export interface ApiError {
  code: string
  message: string
  detail: Array<{ loc?: (string | number)[]; msg: string; type?: string } | Record<string, unknown>>
}

/** 스캐너/카메라 입력 파싱 결과 (spec §6). 규칙은 F21 정정: SO/WO/LT-YYMMDD-NNNN(N), WO 만 -A~-Z, US-NNNN(N) 별도 */
export interface ParsedCode {
  type: TargetType // SO|WO|LT|US 는 접두사로, 그 외 원문은 VB
  code: string // 'WO-261001-0012' 또는 업체 바코드 원문
  check: string | null // URL 의 ?c= 4자. VB 는 null
  raw: string // 스캐너가 보낸 원문
}

/** 데이터 훅 규약 (TanStack Query 래핑) */
export interface HookState<T> {
  data: T | undefined
  loading: boolean
  error: ApiError | null
  refetch: () => Promise<void>
}

export interface IdRef {
  id: number
  code: string
  name?: string
}

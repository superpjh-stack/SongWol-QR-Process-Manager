/**
 * 스캔 문자열 파싱 (순수 함수). spec §2.1 코드 체계 · §6 QR 규격. 결과 형태는 ts-types §3 `ParsedCode`.
 *
 * 규칙 (progress F21 정정 — 서버 `app/core/checkcode.py parse_qr` 와 동일):
 *   ① `https?://…/q/{CODE}?c={CHECK}` 형태면 CODE·CHECK 추출
 *   ② `^(SO|WO|LT)-\d{6}-\d{4,5}$` — WO 만 하위 접미사 `-[A-Z]` 허용 (spec §2.1 「접미사는 하위 WO 만」)
 *   ③ `^US-\d{4,5}$` 별도 (spec §6 작업자 카드 `US-NNNN`, 일자 없음)
 *   ④ 그 외 전부 VB (협력업체 바코드 원문). 체크코드 검증은 서버가 한다.
 *
 * 입력 예
 *   https://sw.example/q/WO-260907-0012?c=7K3F   → { type:'WO', code:'WO-260907-0012', check:'7K3F' }
 *   WO-260907-0012-A                              → { type:'WO', code:'WO-260907-0012-A', check:null }
 *   US-0007                                       → { type:'US', code:'US-0007', check:null }
 *   8801234567890 (업체 바코드 등 알 수 없는 형식)  → { type:'VB', code:'8801234567890', check:null }
 */
import type { ParsedCode, TargetType } from '../types'

export type ScanType = TargetType
/** = ts-types `ParsedCode` (이름은 훅 호환용으로 유지) */
export type ScanResult = ParsedCode

const RE_SO_LT = /^(SO|LT)-\d{6}-\d{4,5}$/
const RE_WO = /^WO-\d{6}-\d{4,5}(-[A-Z])?$/
const RE_US = /^US-\d{4,5}$/
const RE_CHECK = /^[A-Z2-7]{4}$/ // Base32 4자리 (spec §6)

function classify(code: string): Exclude<ScanType, 'VB'> | null {
  const up = code.toUpperCase()
  if (RE_WO.test(up)) return 'WO'
  if (RE_US.test(up)) return 'US'
  const m = RE_SO_LT.exec(up)
  if (m) return m[1] as 'SO' | 'LT'
  return null
}

/** URL 이면 `/q/{CODE}` 와 `?c=` 를 뽑는다. URL 이 아니면 null */
function fromUrl(raw: string): { code: string; check: string | null } | null {
  if (!/^https?:\/\//i.test(raw)) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const m = /\/q\/([^/?#]+)/.exec(url.pathname)
  if (!m?.[1]) return null
  const code = decodeURIComponent(m[1])
  const c = url.searchParams.get('c')
  const check = c ? c.toUpperCase() : null
  return { code, check: check && RE_CHECK.test(check) ? check : null }
}

export function parseScanCode(input: string): ParsedCode {
  const raw = input.trim()
  const parsed = fromUrl(raw)
  const candidate = parsed?.code ?? raw
  const type = classify(candidate)
  if (type) {
    return { type, code: candidate.toUpperCase(), check: parsed?.check ?? null, raw }
  }
  return { type: 'VB', code: candidate, check: null, raw }
}

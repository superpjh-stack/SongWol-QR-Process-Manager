/** 표 테스트 — progress F21 정정 규칙. 서버 parse_qr 와 같은 판정이어야 한다 */
import { describe, expect, it } from 'vitest'
import { parseScanCode } from './parseScanCode'

type Row = { raw: string; type: string; code: string; check: string | null; why: string }

const TABLE: Row[] = [
  // ② SO/WO/LT-YYMMDD-NNNN(N)
  { raw: 'SO-260907-0012', type: 'SO', code: 'SO-260907-0012', check: null, why: '수주 4자리' },
  { raw: 'SO-260907-00123', type: 'SO', code: 'SO-260907-00123', check: null, why: '수주 5자리 확장 (spec §2.1)' },
  { raw: 'WO-260907-0012', type: 'WO', code: 'WO-260907-0012', check: null, why: 'WO 4자리' },
  { raw: 'WO-260907-0012-A', type: 'WO', code: 'WO-260907-0012-A', check: null, why: 'WO 하위 접미사 -A' },
  { raw: 'WO-260907-00120-Z', type: 'WO', code: 'WO-260907-00120-Z', check: null, why: 'WO 5자리 + -Z' },
  { raw: 'wo-260907-0012-b', type: 'WO', code: 'WO-260907-0012-B', check: null, why: '소문자 정규화' },
  { raw: 'LT-260907-0003', type: 'LT', code: 'LT-260907-0003', check: null, why: 'LOT' },
  // 접미사는 WO 만 (F21)
  { raw: 'SO-260907-0012-A', type: 'VB', code: 'SO-260907-0012-A', check: null, why: 'SO 접미사 불가 → VB' },
  { raw: 'LT-260907-0012-A', type: 'VB', code: 'LT-260907-0012-A', check: null, why: 'LT 접미사 불가 → VB' },
  { raw: 'WO-260907-0012-AA', type: 'VB', code: 'WO-260907-0012-AA', check: null, why: '접미사 2자 불가' },
  { raw: 'WO-260907-0012-a1', type: 'VB', code: 'WO-260907-0012-a1', check: null, why: '접미사 숫자 불가' },
  // ③ US-NNNN(N) 별도 (일자 없음)
  { raw: 'US-0007', type: 'US', code: 'US-0007', check: null, why: '작업자 카드 4자리' },
  { raw: 'US-00071', type: 'US', code: 'US-00071', check: null, why: '작업자 카드 5자리' },
  { raw: 'US-007', type: 'VB', code: 'US-007', check: null, why: 'US 3자리 불가' },
  { raw: 'US-000712', type: 'VB', code: 'US-000712', check: null, why: 'US 6자리 불가 (F21: 4~5)' },
  { raw: 'US-260907-0007', type: 'VB', code: 'US-260907-0007', check: null, why: 'US 는 일자 형식이 아니다 (F21)' },
  { raw: 'US-0007-A', type: 'VB', code: 'US-0007-A', check: null, why: 'US 접미사 불가' },
  // 자릿수·형식 오류
  { raw: 'WO-2609070012', type: 'VB', code: 'WO-2609070012', check: null, why: '구분자 없음' },
  { raw: 'WO-26090-0012', type: 'VB', code: 'WO-26090-0012', check: null, why: '일자 5자리' },
  { raw: 'WO-260907-012', type: 'VB', code: 'WO-260907-012', check: null, why: '순번 3자리' },
  { raw: 'WO-260907-001234', type: 'VB', code: 'WO-260907-001234', check: null, why: '순번 6자리' },
  { raw: 'XX-260907-0012', type: 'VB', code: 'XX-260907-0012', check: null, why: '접두사 미정의' },
  // ④ VB (협력업체 바코드 원문 그대로)
  { raw: '8801234567890', type: 'VB', code: '8801234567890', check: null, why: 'EAN-13' },
  { raw: '  abc-XYZ 1 ', type: 'VB', code: 'abc-XYZ 1', check: null, why: 'trim 만, 대소문자 유지' },
  { raw: '', type: 'VB', code: '', check: null, why: '빈 입력' },
  // ① URL
  { raw: 'https://sw.example/q/WO-260907-0012?c=7K3F', type: 'WO', code: 'WO-260907-0012', check: '7K3F', why: 'URL + 체크코드' },
  { raw: 'http://10.0.0.5:8000/q/LT-260907-0003?c=ab2c', type: 'LT', code: 'LT-260907-0003', check: 'AB2C', why: 'http · 체크코드 대문자화' },
  { raw: 'https://sw.example/q/US-0007?c=Q7ZZ', type: 'US', code: 'US-0007', check: 'Q7ZZ', why: '카드 URL' },
  { raw: 'https://sw.example/q/WO-260907-0012-A?c=7K3F&x=1', type: 'WO', code: 'WO-260907-0012-A', check: '7K3F', why: '하위 WO URL + 다른 파라미터' },
  { raw: 'https://sw.example/q/WO-260907-0012', type: 'WO', code: 'WO-260907-0012', check: null, why: 'URL 에 c 없음' },
  { raw: 'https://sw.example/q/WO-260907-0012?c=7K3', type: 'WO', code: 'WO-260907-0012', check: null, why: 'c 3자리 → 무시(서버 판정)' },
  { raw: 'https://sw.example/q/WO-260907-0012?c=7K31', type: 'WO', code: 'WO-260907-0012', check: null, why: 'c 에 Base32 외 문자(1) → 무시' },
  { raw: 'https://sw.example/q/SO-260907-0012-A?c=7K3F', type: 'VB', code: 'SO-260907-0012-A', check: null, why: 'URL 안 코드도 같은 규칙' },
  { raw: 'https://sw.example/other/WO-260907-0012', type: 'VB', code: 'https://sw.example/other/WO-260907-0012', check: null, why: '/q/ 경로 아님 → 원문 VB' },
  { raw: 'https://sw.example/setup?s=K-P30-1&k=abc', type: 'VB', code: 'https://sw.example/setup?s=K-P30-1&k=abc', check: null, why: '단말 등록 URL 은 스캔 코드가 아니다' },
]

describe('parseScanCode (F21)', () => {
  it.each(TABLE)('$raw → $type $code ($why)', ({ raw, type, code, check }) => {
    const r = parseScanCode(raw)
    expect(r.type).toBe(type)
    expect(r.code).toBe(code)
    expect(r.check).toBe(check)
    expect(r.raw).toBe(raw.trim())
  })

  it('모든 결과에 check 키가 있다 (ParsedCode: string | null)', () => {
    for (const row of TABLE) expect(Object.keys(parseScanCode(row.raw))).toEqual(['type', 'code', 'check', 'raw'])
  })
})

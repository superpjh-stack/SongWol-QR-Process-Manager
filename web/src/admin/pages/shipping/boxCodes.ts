/**
 * ADM-23 발송 등록 — 박스 코드 입력(스캐너 HID 또는 타이핑, 연속 추가) 목록 관리.
 * 코드 계열 정규화(trim + 대문자, api-contract §14.4 D28)와 중복 제외를 순수 함수로 뺀다.
 */
export function addBoxCode(list: string[], raw: string): string[] {
  const code = raw.trim().toUpperCase()
  if (!code) return list
  if (list.includes(code)) return list
  return [...list, code]
}

export function removeBoxCode(list: string[], code: string): string[] {
  return list.filter((c) => c !== code)
}

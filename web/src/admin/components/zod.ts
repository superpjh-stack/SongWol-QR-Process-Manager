/** zod 규칙 헬퍼 — screens-admin 각 절 「검증」 표(db-schema 길이·필수)를 옮긴다. 서버 422 가 최종 판정 */
import { z } from 'zod'

export const zx = {
  /** 필수 문자열 ≤max */
  req: (max: number, label = '값') => z.string().trim().min(1, `${label}을(를) 입력하세요`).max(max, `${max}자 이하로 입력하세요`),
  /** 선택 문자열 ≤max ('' 허용, 제출 시 제외/NULL) */
  opt: (max: number) => z.string().trim().max(max, `${max}자 이하로 입력하세요`),
  /** 영문 대문자·숫자·_ 코드 (api-contract §1 「코드는 영문 대문자」) */
  upperCode: (max: number, label = '코드') =>
    z
      .string()
      .trim()
      .min(1, `${label}을(를) 입력하세요`)
      .max(max, `${max}자 이하`)
      .regex(/^[A-Z][A-Z0-9_]*$/, '영문 대문자·숫자·_ 만 (첫 글자 영문)'),
  email: (max: number) =>
    z
      .string()
      .trim()
      .max(max, `${max}자 이하`)
      .refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), '이메일 형식이 아닙니다'),
  /** 숫자 input (빈칸 = NaN) → 선택 정수 ≥0 */
  /** 선택 정수 (빈칸 = undefined). NumberInput 에는 `register(name, { setValueAs: numOrUndef })` 를 함께 쓴다 (DEF-QA2-006) */
  optInt: (min = 0) => z.number({ error: '숫자를 입력하세요' }).int('정수').min(min, `${min} 이상의 정수`).optional(),
  num: (min: number, max: number, step?: number) =>
    z
      .number({ error: '숫자를 입력하세요' })
      .min(min, `${min} 이상`)
      .max(max, `${max} 이하`)
      .refine((v) => step === undefined || Math.abs(Math.round(v / step) * step - v) < 1e-9, `${step} 단위`),
  int: (min: number, max: number) => z.number({ error: '숫자를 입력하세요' }).int('정수').min(min, `${min} 이상`).max(max, `${max} 이하`),
  pin: () => z.string().regex(/^\d{4,6}$/, '숫자 4~6자리'),
  /** api-contract §13.2 admin #16: 8자 이상, 영문+숫자 각 1자 이상 */
  password: () =>
    z
      .string()
      .min(8, '8자 이상')
      .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), '영문과 숫자를 각 1자 이상 포함'),
}

/** NumberInput 값 → number | undefined (빈칸은 undefined, NaN 금지 — DEF-QA2-006) */
export const numOrUndef = (v: unknown): number | undefined => {
  if (v === '' || v === null || v === undefined) return undefined
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isNaN(n) ? undefined : n
}
/** login_id 정규화: trim + 소문자 (api §14.4 D28) */
export const lowerId = (v: unknown): unknown => (typeof v === 'string' ? v.trim().toLowerCase() : v)
/** 코드 계열 입력 정규화: trim + 대문자 (progress D28). `register(name, { setValueAs: upperCode })` + className="uppercase" */
export const upperCode = (v: unknown): unknown => (typeof v === 'string' ? v.trim().toUpperCase() : v)

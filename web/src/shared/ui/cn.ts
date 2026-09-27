/** 클래스 문자열 합치기. falsy 는 버린다. 외부 라이브러리(clsx) 대신 쓴다. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

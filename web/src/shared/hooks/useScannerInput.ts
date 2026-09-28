/**
 * 유선 2D 스캐너(HID 키보드) 입력 훅. plan §5.2 · spec §6.
 *
 * - window keydown 을 버퍼링한다. 입력창 포커스와 무관하게 동작한다.
 * - 연속 문자 사이 간격이 `gapMs`(기본 50 ms) 이내이고 Enter 로 끝나며 길이가 `minLength` 이상이면 스캔으로 판정.
 *   사람 타이핑은 간격이 길어 버퍼가 매번 초기화되므로 Enter 시점에 길이가 모자라 스캔이 아니다.
 * - 스캔으로 판정된 Enter 는 preventDefault 한다 (폼 제출 방지). 문자 키는 막지 않는다 — 어느 키가 스캐너 것인지
 *   첫 글자 시점엔 알 수 없기 때문이다. 키오스크 화면은 스캔 중 포커스된 입력창을 두지 않는 것이 원칙이다.
 * - `enabled=false` 면 리스너를 붙이지 않는다 (PIN 다이얼로그 등에서 잠시 끌 때).
 * - `hold=true` 면 스캔이 인식돼도 `onScan` 을 바로 부르지 않고 버퍼에 담아둔다(가장 최근 1건으로 덮어쓴다 —
 *   스캔은 항상 최신 의도다). `hold` 가 false 로 바뀌는 순간 담아둔 1건만 방출한다. KSK-40(전송 중)·
 *   KSK-60(PIN 입력 중)처럼 "지금은 처리할 수 없지만 스캔 자체는 잃지 않아야 하는" 상태에 쓴다
 *   (screens-shopfloor §0.4 "KSK-40·KSK-60 에서는 스캔을 보류했다가 그 상태가 끝난 뒤 처리").
 */
import { useEffect, useRef } from 'react'
import { parseScanCode, type ScanResult } from './parseScanCode'

export type ScannerOptions = {
  /** 문자 사이 최대 간격 (ms). 기본값 50 */
  gapMs?: number
  /** 스캔으로 인정할 최소 길이 (Enter 제외). 기본값 4 (`US-0007` 이 7자) */
  minLength?: number
  /** false 면 비활성. 기본값 true */
  enabled?: boolean
  /** true 인 동안은 스캔을 보류하고, false 로 바뀌는 순간 마지막 1건만 방출한다. 기본값 false */
  hold?: boolean
}

const DEFAULT_GAP_MS = 50
const DEFAULT_MIN_LENGTH = 4

export function useScannerInput(onScan: (result: ScanResult) => void, options: ScannerOptions = {}): void {
  const { gapMs = DEFAULT_GAP_MS, minLength = DEFAULT_MIN_LENGTH, enabled = true, hold = false } = options
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  const holdRef = useRef(hold)
  const pendingRef = useRef<ScanResult | null>(null)

  // hold 가 풀리는 순간 보류해둔 스캔을 1건만 방출한다.
  useEffect(() => {
    holdRef.current = hold
    if (!hold && pendingRef.current) {
      const p = pendingRef.current
      pendingRef.current = null
      onScanRef.current(p)
    }
  }, [hold])

  useEffect(() => {
    if (!enabled) return
    let buffer = ''
    let lastAt = 0
    let fast = true // 버퍼 안의 모든 문자가 gapMs 이내로 들어왔는가

    const reset = () => {
      buffer = ''
      fast = true
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const now = performance.now()
      const gap = now - lastAt

      if (e.key === 'Enter' || e.key === 'NumpadEnter') {
        const isScan = buffer.length >= minLength && fast && gap <= gapMs * 4 // Enter 는 살짝 늦게 오는 스캐너가 있어 여유
        const text = buffer
        reset()
        lastAt = now
        if (isScan) {
          e.preventDefault()
          e.stopPropagation()
          const parsed = parseScanCode(text)
          if (holdRef.current) {
            pendingRef.current = parsed // 스캔이 의도다 — 최신 것으로 덮어쓴다
          } else {
            onScanRef.current(parsed)
          }
        }
        return
      }

      // 출력 가능한 단일 문자만 (Shift 는 대문자·기호에 필요하므로 허용)
      if (e.key.length !== 1) return

      if (buffer.length > 0 && gap > gapMs) {
        // 사람 타이핑 속도 → 새 버퍼 시작
        buffer = ''
        fast = true
      }
      buffer += e.key
      lastAt = now
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [gapMs, minLength, enabled])
}

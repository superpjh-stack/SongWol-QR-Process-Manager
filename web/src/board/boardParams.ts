/**
 * `/board?key=` 단말 키 주입 — 최초 1회 저장 후 URL 정리 (screens-shopfloor §3 BRD-01 "키 주입",
 * §5 ㉒). `/setup`(web/src/setup/setupParams.ts) 과 같은 저장소(`useStationConfig`, localStorage
 * `sw.station`)를 그대로 재사용한다 — 현황판도 결국 단말 키(`X-Station-Key`)로 REST·WS 를 부르므로
 * `stationHeaders()` 를 다른 단말 화면과 똑같이 쓸 수 있다. `/setup` 의 `?s=&k=&p=&v=1` 과 달리
 * 현황판 URL 은 TV 에 스캐너가 없어 `?key=` 하나만 받는다(§5 ㉒ 기본값 — 관리자 QR 방식 불가) —
 * station_id 는 REST 헤더에 쓰이지 않으므로 자리표시자만 둔다.
 */
import { loadStationConfig, saveStationConfig, SETUP_VERSION, type StationConfig } from '@/shared/hooks/useStationConfig'

export const BOARD_STATION_PLACEHOLDER = 'BOARD'

/** `?key=` 쿼리에서 단말 키를 꺼낸다. 없거나 빈 문자열이면 null */
export function parseBoardKey(search: string | URLSearchParams): string | null {
  const sp = typeof search === 'string' ? new URLSearchParams(search) : search
  const k = (sp.get('key') ?? '').trim()
  return k || null
}

/** 이미 저장된 단말 키가 있으면 그대로 쓴다(재방문 시 재주입 불필요) */
export function loadBoardKey(): string | null {
  return loadStationConfig()?.api_key ?? null
}

export function saveBoardKey(key: string): StationConfig {
  return saveStationConfig({ station_id: BOARD_STATION_PLACEHOLDER, api_key: key, printer_id: null, v: SETUP_VERSION })
}

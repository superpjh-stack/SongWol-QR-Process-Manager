/**
 * 단말 등록 설정(station_id·api_key·printer_id) 로컬 저장·읽기 + 관리자 QR URL 파싱
 * (screens-shopfloor §4.2 A10). URL 형식은 계약으로 고정:
 * `{PUBLIC_HOST}/setup?s={station_id}&k={api_key}&p={printer_id?}&v=1` (api-contract §13.2 admin #15 · shopfloor ①).
 *
 * **저장소 결정 — screens-shopfloor.md §0.2 는 IndexedDB `station_config` 스토어를 "기본값(제안)"으로
 * 적었지만, S0 가 `/setup`(web/src/setup)을 이미 localStorage(`sw.station`, 동기 read)로 구현·출시했고
 * 테스트도 그 저장소를 전제로 한다. 부팅 화면(KSK-00)은 station_id·api_key 를 React 렌더 이전에 동기적으로
 * 읽어야 하는데(첫 요청 헤더에 바로 실어야 한다) IndexedDB 는 비동기다. 그래서 이 스프린트에서는 기존
 * localStorage 저장소를 유지하고, 여러 화면이 재사용할 수 있게 훅으로만 감쌌다. IndexedDB 로 옮길지는
 * 아키텍트 결정 사항으로 남긴다(디자인 에이전트 보고서 참고) — 옮기게 되면 이 파일만 고치면 된다.
 */
import { useCallback, useEffect, useState } from 'react'

export const STATION_KEY = 'sw.station'
export const SETUP_VERSION = '1'

/** 사건: 같은 탭 안에서 저장소가 바뀌었을 때 훅들끼리 알리는 커스텀 이벤트 (storage 이벤트는 다른 탭에만 온다) */
const CHANGE_EVENT = 'sw-station-changed'

export type SetupParams = { station_id: string; api_key: string; printer_id: string | null; v: string }
export type StationConfig = SetupParams & { saved_at: string }
export type SetupParse = { ok: true; params: SetupParams } | { ok: false; reason: 'MISSING' | 'VERSION' }

/** 관리자 QR/URL 의 쿼리스트링을 파싱한다. `s`·`k` 없으면 MISSING, `v` 가 '1' 이 아니면 VERSION */
export function parseSetupParams(search: string | URLSearchParams): SetupParse {
  const sp = typeof search === 'string' ? new URLSearchParams(search) : search
  const s = (sp.get('s') ?? '').trim().toUpperCase()
  const k = (sp.get('k') ?? '').trim()
  const p = (sp.get('p') ?? '').trim().toUpperCase()
  const v = (sp.get('v') ?? '').trim()
  if (!s || !k) return { ok: false, reason: 'MISSING' }
  if (v !== SETUP_VERSION) return { ok: false, reason: 'VERSION' }
  return { ok: true, params: { station_id: s, api_key: k, printer_id: p || null, v } }
}

/** 키 마스킹 — 앞 4자만 (StationsPage 의 api_key_prefix 와 같은 길이). 화면에 평문 키를 다시 보여주지 않는다 */
export function maskKey(k: string): string {
  return k.length <= 4 ? '****' : `${k.slice(0, 4)}${'*'.repeat(Math.min(12, k.length - 4))}`
}

function notifyChanged(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function loadStationConfig(): StationConfig | null {
  try {
    const raw = localStorage.getItem(STATION_KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as Partial<StationConfig>
    if (typeof o.station_id !== 'string' || typeof o.api_key !== 'string') return null
    return {
      station_id: o.station_id,
      api_key: o.api_key,
      printer_id: typeof o.printer_id === 'string' ? o.printer_id : null,
      v: typeof o.v === 'string' ? o.v : SETUP_VERSION,
      saved_at: typeof o.saved_at === 'string' ? o.saved_at : '',
    }
  } catch {
    return null
  }
}

export function saveStationConfig(p: SetupParams, now = new Date()): StationConfig {
  const cfg: StationConfig = { ...p, saved_at: now.toISOString() }
  localStorage.setItem(STATION_KEY, JSON.stringify(cfg))
  notifyChanged()
  return cfg
}

/** 등록 해제 — 관리자가 키를 회전했거나 단말을 교체할 때 */
export function clearStationConfig(): void {
  localStorage.removeItem(STATION_KEY)
  notifyChanged()
}

export type UseStationConfigResult = {
  /** 등록 안 됐으면 null — 화면은 KSK-00 "단말 등록 필요" 로 보내야 한다 */
  config: StationConfig | null
  save: (params: SetupParams) => StationConfig
  clear: () => void
  parseSetupUrl: typeof parseSetupParams
  maskKey: typeof maskKey
}

/** 여러 키오스크 화면이 재사용하는 반응형 훅. 같은 탭·다른 탭 어느 쪽에서 저장이 바뀌어도 갱신된다 */
export function useStationConfig(): UseStationConfigResult {
  const [config, setConfig] = useState<StationConfig | null>(() => loadStationConfig())

  useEffect(() => {
    const onChange = () => setConfig(loadStationConfig())
    window.addEventListener('storage', onChange)
    window.addEventListener(CHANGE_EVENT, onChange)
    return () => {
      window.removeEventListener('storage', onChange)
      window.removeEventListener(CHANGE_EVENT, onChange)
    }
  }, [])

  const save = useCallback((params: SetupParams) => saveStationConfig(params), [])
  const clear = useCallback(() => clearStationConfig(), [])

  return { config, save, clear, parseSetupUrl: parseSetupParams, maskKey }
}

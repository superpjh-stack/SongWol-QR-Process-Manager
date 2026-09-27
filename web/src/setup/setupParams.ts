/**
 * 단말 등록 QR URL 파싱 — `{PUBLIC_HOST}/setup?s={station_id}&k={api_key}&p={printer_id?}&v=1` (api-contract §13.2 admin #15).
 * 저장처: localStorage `sw.station` (키오스크·현황판 S2 가 읽는다). 키는 화면·보고에 노출하지 않는다.
 */
export const STATION_KEY = 'sw.station'
export const SETUP_VERSION = '1'

export type SetupParams = { station_id: string; api_key: string; printer_id: string | null; v: string }
export type StationConfig = SetupParams & { saved_at: string }

export type SetupParse = { ok: true; params: SetupParams } | { ok: false; reason: 'MISSING' | 'VERSION' }

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

/** 키 마스킹 — 앞 4자만 (StationsPage 의 api_key_prefix 와 같은 길이) */
export function maskKey(k: string): string {
  return k.length <= 4 ? '****' : `${k.slice(0, 4)}${'*'.repeat(Math.min(12, k.length - 4))}`
}

export function saveStationConfig(p: SetupParams, now = new Date()): StationConfig {
  const cfg: StationConfig = { ...p, saved_at: now.toISOString() }
  localStorage.setItem(STATION_KEY, JSON.stringify(cfg))
  return cfg
}

export function loadStationConfig(): StationConfig | null {
  try {
    const raw = localStorage.getItem(STATION_KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as Partial<StationConfig>
    if (typeof o.station_id !== 'string' || typeof o.api_key !== 'string') return null
    return { station_id: o.station_id, api_key: o.api_key, printer_id: typeof o.printer_id === 'string' ? o.printer_id : null, v: typeof o.v === 'string' ? o.v : SETUP_VERSION, saved_at: typeof o.saved_at === 'string' ? o.saved_at : '' }
  } catch {
    return null
  }
}

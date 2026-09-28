/**
 * 단말 등록·부팅 확인 (KSK-00, screens-shopfloor §0.2). `GET /stations/me` → 공정 코드는 각 앱(키오스크·PDA)이
 * 스스로 분기한다 — 이 훅은 등록 여부·활성 여부·서버 도달성만 판정한다.
 *
 * 원래 `kiosk/KioskApp.tsx` 안에 있던 로직을 그대로 옮겼다 — P30 이든 P50 이든 PDA 든 부팅 절차는 완전히
 * 같아서(§0.2 표 어디에도 공정별 분기가 없다) 키오스크·PDA 양쪽이 공유한다.
 */
import { useCallback, useEffect, useState } from 'react'
import { stationApi } from '../api'
import { isApiError } from '../api/client'
import { useStationConfig } from './useStationConfig'
import type { Process, Station } from '../types'

const STATION_CACHE_KEY = 'sw.kiosk.station_cache'

function loadCachedStation(): Station | null {
  try {
    const raw = localStorage.getItem(STATION_CACHE_KEY)
    return raw ? (JSON.parse(raw) as Station) : null
  } catch {
    return null
  }
}
function saveCachedStation(s: Station): void {
  try {
    localStorage.setItem(STATION_CACHE_KEY, JSON.stringify(s))
  } catch {
    /* 캐시는 UX 편의 — 저장 실패해도 부팅 자체는 계속된다 */
  }
}

export type StationBootState =
  | { phase: 'loading' }
  | { phase: 'not_registered' }
  | { phase: 'inactive' }
  | { phase: 'server_unreachable'; cached: Station | null }
  | { phase: 'ready'; station: Station; processName: string }

export type UseStationBootResult = {
  boot: StationBootState
  retry: () => void
}

export function useStationBoot(): UseStationBootResult {
  const { config } = useStationConfig()
  const [boot, setBoot] = useState<StationBootState>({ phase: 'loading' })

  const runBoot = useCallback(async () => {
    if (!config) {
      setBoot({ phase: 'not_registered' })
      return
    }
    setBoot({ phase: 'loading' })
    try {
      const [station, processes] = await Promise.all([stationApi.me(), stationApi.processes().catch((): Process[] => [])])
      saveCachedStation(station)
      const name = processes.find((p) => p.code === station.process_code)?.name ?? station.process_code ?? '알 수 없는 공정'
      setBoot({ phase: 'ready', station, processName: name })
    } catch (e) {
      if (isApiError(e) && e.status === 401) {
        setBoot({ phase: 'not_registered' })
        return
      }
      if (isApiError(e) && e.status === 403) {
        setBoot({ phase: 'inactive' })
        return
      }
      // 네트워크·503 등 — 마지막 성공 캐시로 기동 (§0.2)
      setBoot({ phase: 'server_unreachable', cached: loadCachedStation() })
    }
  }, [config])

  useEffect(() => {
    void runBoot()
  }, [runBoot])

  return { boot, retry: () => void runBoot() }
}

/**
 * `/kiosk` 부팅 (KSK-00, screens-shopfloor §0.2). 단말 등록 확인 → `GET /stations/me` → 공정 코드 분기.
 * 이 스프린트(S2)는 **P30(인쇄) 흐름만** 완성한다 — 다른 공정 단말은 안내만 하고 화면을 만들지 않는다.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStationConfig } from '@/shared/hooks'
import { stationApi } from '@/shared/api'
import { isApiError } from '@/shared/api/client'
import { BigButton, MobileCard, MobilePage } from '@/shared/ui/shopfloor'
import type { Process, Station } from '@/shared/types'
import { KioskSession } from './KioskSession'

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

type BootState =
  | { phase: 'loading' }
  | { phase: 'not_registered' }
  | { phase: 'inactive' }
  | { phase: 'server_unreachable'; cached: Station | null }
  | { phase: 'ready'; station: Station; processName: string }

export function KioskApp() {
  const { config } = useStationConfig()
  const [boot, setBoot] = useState<BootState>({ phase: 'loading' })
  const navigate = useNavigate()

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

  if (boot.phase === 'loading') {
    return (
      <MobilePage code="/kiosk" typeLabel="부팅 중">
        <MobileCard>단말 정보를 확인하는 중입니다…</MobileCard>
      </MobilePage>
    )
  }

  if (boot.phase === 'not_registered') {
    return (
      <MobilePage
        code="/kiosk"
        typeLabel="단말 등록 필요"
        actions={
          <BigButton fullWidth size="lg" onClick={() => navigate('/setup')}>
            관리자 QR 스캔하러 가기
          </BigButton>
        }
      >
        <MobileCard title="단말 등록이 필요합니다">
          이 기기는 아직 등록되지 않았거나 등록 정보가 잘못되었습니다. 관리자가 발급한 등록 QR 을 스캔하세요.
        </MobileCard>
        <Link to="/setup" className="block text-center text-sf-body text-brand-700 underline">
          /setup 으로 이동
        </Link>
      </MobilePage>
    )
  }

  if (boot.phase === 'inactive') {
    return (
      <MobilePage code="/kiosk" typeLabel="단말 사용 중지">
        <MobileCard title="이 단말은 사용 중지 상태입니다">관리자에게 문의하세요.</MobileCard>
      </MobilePage>
    )
  }

  if (boot.phase === 'server_unreachable') {
    if (!boot.cached) {
      return (
        <MobilePage code="/kiosk" typeLabel="서버 연결 필요">
          <MobileCard title="서버 연결 필요 (최초 부팅)">
            네트워크 상태를 확인한 뒤 다시 시도하세요. 최초 부팅은 서버 연결이 필요합니다.
          </MobileCard>
          <BigButton fullWidth onClick={() => void runBoot()}>
            다시 시도
          </BigButton>
        </MobilePage>
      )
    }
    if (boot.cached.process_code !== 'P30') {
      return <UnsupportedProcess processCode={boot.cached.process_code} />
    }
    return <KioskSession station={boot.cached} processName={boot.cached.process_code ?? '인쇄'} bootOffline />
  }

  if (boot.station.process_code !== 'P30') {
    return <UnsupportedProcess processCode={boot.station.process_code} />
  }

  return <KioskSession station={boot.station} processName={boot.processName} />
}

function UnsupportedProcess({ processCode }: { processCode: string | null }) {
  return (
    <MobilePage code={processCode ?? '?'} typeLabel="지원하지 않는 공정">
      <MobileCard title="이 공정은 아직 지원하지 않습니다 (S3/S4 예정)">
        이 빌드는 P30(인쇄) 키오스크만 구현되어 있습니다. 이 단말의 공정 코드는 <strong className="font-mono">{processCode ?? '미설정'}</strong> 입니다.
        P50(포장)은 KSK-80/81 로 S3 에서, PDA·현황판은 별도 스프린트에서 제공됩니다.
      </MobileCard>
    </MobilePage>
  )
}

export type { BootState }

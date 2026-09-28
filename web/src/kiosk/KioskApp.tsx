/**
 * `/kiosk` 부팅 (KSK-00, screens-shopfloor §0.2). 단말 등록 확인 → `GET /stations/me` → 공정 코드 분기.
 * `station.process_code` 로 `P30`(인쇄, DONE 흐름) · `P50`(포장, PACK 흐름 KSK-80/81)을 갈라 같은
 * `KioskSession` 이 처리한다 — 그 외 공정 단말은 안내만 하고 화면을 만들지 않는다(PDA·현황판은 별도 앱).
 * 등록·활성·서버 도달성 판정은 PDA 와 같아 `useStationBoot`/`StationBootFallback` 을 공유한다.
 */
import { useStationBoot } from '@/shared/hooks'
import { StationBootFallback, UnsupportedProcessScreen } from '@/shared/device/StationBootFallback'
import { KioskSession } from './KioskSession'

const SUPPORTED_PROCESS_CODES = ['P30', 'P50']

export function KioskApp() {
  const { boot, retry } = useStationBoot()

  const fallback = <StationBootFallback boot={boot} appPath="/kiosk" onRetry={retry} />
  if (boot.phase !== 'ready' && !(boot.phase === 'server_unreachable' && boot.cached)) {
    return fallback
  }

  if (boot.phase === 'server_unreachable') {
    // 위 조건에서 걸러져 이 분기는 boot.cached 가 항상 있다
    const station = boot.cached!
    if (!SUPPORTED_PROCESS_CODES.includes(station.process_code ?? '')) {
      return <UnsupportedProcessScreen processCode={station.process_code} supportedLabel="P30(인쇄)·P50(포장) 키오스크" otherAppHint="입고·발송은 /pda, 현황판은 별도 스프린트에서 제공됩니다." />
    }
    return <KioskSession station={station} processName={station.process_code ?? '인쇄'} bootOffline />
  }

  if (!SUPPORTED_PROCESS_CODES.includes(boot.station.process_code ?? '')) {
    return <UnsupportedProcessScreen processCode={boot.station.process_code} supportedLabel="P30(인쇄)·P50(포장) 키오스크" otherAppHint="입고·발송은 /pda, 현황판은 별도 스프린트에서 제공됩니다." />
  }

  return <KioskSession station={boot.station} processName={boot.processName} />
}

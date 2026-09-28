/**
 * `/pda` 부팅 (screens-shopfloor §2). 단말 등록 확인은 키오스크와 같다(`useStationBoot`/
 * `StationBootFallback` 공유) — `station.process_code` 로 `P20`(입고, ReceivingSession) ·
 * `P60`(발송, ShippingSession) 을 가른다. PDA 가 없으면 휴대폰 PWA 로 대체 개발한다(plan §7) — 이 앱은
 * 특별한 PDA 하드웨어 API 를 쓰지 않고 kiosk 와 같은 `useScannerInput`(HID)·`CameraScanDialog` 를 그대로
 * 쓴다. 세로 화면(휴대폰) 전제이며, 같은 컴포넌트를 kiosk 와 공유하므로 레이아웃만 반응형으로 맞는다.
 */
import { useStationBoot } from '@/shared/hooks'
import { StationBootFallback, UnsupportedProcessScreen } from '@/shared/device/StationBootFallback'
import { ReceivingSession } from './ReceivingSession'
import { ShippingSession } from './ShippingSession'
import type { Station } from '@/shared/types'

const SUPPORTED_HINT = 'P20(입고)·P60(발송) PDA 만 구현되어 있습니다'
const OTHER_APP_HINT = '인쇄·포장은 /kiosk, 현황판은 별도 스프린트에서 제공됩니다.'

function SessionFor({ station, processName, bootOffline }: { station: Station; processName: string; bootOffline?: boolean }) {
  // exactOptionalPropertyTypes: `bootOffline?: boolean` 는 "생략 또는 boolean"이지 "boolean | undefined" 가
  // 아니다 — 값이 없을 때 키 자체를 넣지 않도록 조건부로 펼친다(kioskLogic.ts 의 같은 원칙).
  const offlineProp = bootOffline ? { bootOffline: true as const } : {}
  if (station.process_code === 'P20') return <ReceivingSession station={station} processName={processName} {...offlineProp} />
  if (station.process_code === 'P60') return <ShippingSession station={station} processName={processName} {...offlineProp} />
  return <UnsupportedProcessScreen processCode={station.process_code} supportedLabel={SUPPORTED_HINT} otherAppHint={OTHER_APP_HINT} />
}

export function PdaApp() {
  const { boot, retry } = useStationBoot()

  if (boot.phase !== 'ready' && !(boot.phase === 'server_unreachable' && boot.cached)) {
    return <StationBootFallback boot={boot} appPath="/pda" onRetry={retry} />
  }

  if (boot.phase === 'server_unreachable') {
    const station = boot.cached!
    return <SessionFor station={station} processName={station.process_code ?? '?'} bootOffline />
  }

  return <SessionFor station={boot.station} processName={boot.processName} />
}

/**
 * KSK-00 단말 등록·부팅 확인의 화면 부분 (screens-shopfloor §0.2) — `loading`·`not_registered`·
 * `inactive`·`server_unreachable`(캐시 없음) 4가지 "아직 세션을 시작할 수 없는" 상태만 그린다.
 * 키오스크(`KioskApp.tsx`)와 PDA(`PdaApp.tsx`) 둘 다 이 4가지는 완전히 같은 문구·동작이라(§0.2 표 어디에도
 * 단말 유형별 분기가 없다) 여기로 옮겼다. `ready` 상태와 "오프라인이지만 캐시로 기동" 상태는 각 앱이
 * 직접 판단해 세션 컴포넌트를 그린다 — 이 컴포넌트는 그 두 경우 `null` 을 반환해 "계속 진행하라"는 뜻으로 쓴다.
 */
import { Link, useNavigate } from 'react-router-dom'
import type { StationBootState } from '../hooks/useStationBoot'
import { BigButton, MobileCard, MobilePage } from '../ui/shopfloor'

export type StationBootFallbackProps = {
  boot: StationBootState
  /** 등록 QR 스캔 화면 링크 표시용 — `/kiosk` 또는 `/pda` */
  appPath: string
  onRetry: () => void
}

export function StationBootFallback({ boot, appPath, onRetry }: StationBootFallbackProps) {
  if (boot.phase === 'loading') {
    return (
      <MobilePage code={appPath} typeLabel="부팅 중">
        <MobileCard>단말 정보를 확인하는 중입니다…</MobileCard>
      </MobilePage>
    )
  }

  if (boot.phase === 'not_registered') {
    return <NotRegistered appPath={appPath} />
  }

  if (boot.phase === 'inactive') {
    return (
      <MobilePage code={appPath} typeLabel="단말 사용 중지">
        <MobileCard title="이 단말은 사용 중지 상태입니다">관리자에게 문의하세요.</MobileCard>
      </MobilePage>
    )
  }

  if (boot.phase === 'server_unreachable' && !boot.cached) {
    return (
      <MobilePage code={appPath} typeLabel="서버 연결 필요">
        <MobileCard title="서버 연결 필요 (최초 부팅)">네트워크 상태를 확인한 뒤 다시 시도하세요. 최초 부팅은 서버 연결이 필요합니다.</MobileCard>
        <BigButton fullWidth onClick={onRetry}>
          다시 시도
        </BigButton>
      </MobilePage>
    )
  }

  return null
}

function NotRegistered({ appPath }: { appPath: string }) {
  const navigate = useNavigate()
  return (
    <MobilePage
      code={appPath}
      typeLabel="단말 등록 필요"
      actions={
        <BigButton fullWidth size="lg" onClick={() => navigate('/setup')}>
          관리자 QR 스캔하러 가기
        </BigButton>
      }
    >
      <MobileCard title="단말 등록이 필요합니다">이 기기는 아직 등록되지 않았거나 등록 정보가 잘못되었습니다. 관리자가 발급한 등록 QR 을 스캔하세요.</MobileCard>
      <Link to="/setup" className="block text-center text-sf-body text-brand-700 underline">
        /setup 으로 이동
      </Link>
    </MobilePage>
  )
}

/** 지원하지 않는 공정 코드 안내 — 화면 공통, 문구만 앱이 채운다 */
export function UnsupportedProcessScreen({ processCode, supportedLabel, otherAppHint }: { processCode: string | null; supportedLabel: string; otherAppHint: string }) {
  return (
    <MobilePage code={processCode ?? '?'} typeLabel="지원하지 않는 공정">
      <MobileCard title="이 공정은 아직 지원하지 않습니다">
        이 빌드는 {supportedLabel} 만 구현되어 있습니다. 이 단말의 공정 코드는 <strong className="font-mono">{processCode ?? '미설정'}</strong> 입니다. {otherAppHint}
      </MobileCard>
    </MobilePage>
  )
}

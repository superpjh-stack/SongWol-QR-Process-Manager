/**
 * 로그인 후 전 화면(키오스크 KSK-20·30·31·40·50·60·61 · PDA-11~13·20~22) 공용 상단 고정 영역
 * (screens-shopfloor §0.9): 공정명·단말ID·작업자명·연결상태/미전송 N건·승인 대기 N·시각.
 * KSK-10·01(로그인 전)은 디자인 웨이브의 `IdleScreen` 이 자체 헤더를 갖고 있어 그대로 쓴다 — 이
 * 컴포넌트는 로그인 이후 화면들이 공유한다.
 *
 * 원래 `kiosk/KioskChrome.tsx`(이름 `KioskChrome`)였던 것을 PDA 도 그대로 재사용할 수 있어 여기로
 * 옮겼다 — P30 전용 내용이 하나도 없다(§0.9 상단 고정 영역 표는 "전 단말 공통"). PDA 는 세로 화면이라
 * `flex-wrap` 만으로 줄바꿈되어 그대로 맞는다(spec §0.9 "PDA 는 세로 — 같은 컴포넌트, 레이아웃만 반응형").
 */
import { useEffect, useState, type ReactNode } from 'react'
import { ConnectionIndicator, WarnBannerList, type ConnectionStatus, type WarnBannerEntry } from '@/shared/ui/shopfloor'
import { IconKey, IconTag } from '@/shared/ui/icons'

function useClock(): string {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(t)
  }, [])
  return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(now)
}

export type DeviceChromeProps = {
  processName: string
  stationId: string
  workerName: string
  onLogout: () => void
  connectionStatus: ConnectionStatus
  pendingCount: number
  staleCount: number
  pendingApprovals: number
  onOpenPendingApprovals: () => void
  /** P50 전용 — 오프라인 포장 flush 로 커밋된 박스 중 [부착 완료] 전인 건수 (§13.7 ⑬). 0/생략이면 숨김 */
  packLabelConfirmCount?: number
  onOpenPackLabelConfirm?: () => void
  banners: WarnBannerEntry[]
  onDismissBanner: (id: string) => void
  children: ReactNode
}

export function DeviceChrome({
  processName,
  stationId,
  workerName,
  onLogout,
  connectionStatus,
  pendingCount,
  staleCount,
  pendingApprovals,
  onOpenPendingApprovals,
  packLabelConfirmCount = 0,
  onOpenPackLabelConfirm,
  banners,
  onDismissBanner,
  children,
}: DeviceChromeProps) {
  const clock = useClock()
  return (
    <div className="density-shopfloor flex min-h-dvh flex-col bg-surface-2" data-component="DeviceChrome">
      <WarnBannerList items={banners} onDismiss={onDismissBanner} />
      <header className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-line bg-surface px-6 py-3">
        <div className="flex items-baseline gap-4">
          <h1 className="text-sf-xl font-bold">{processName}</h1>
          <span className="font-mono text-sf-body text-ink-muted">{stationId}</span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <ConnectionIndicator status={connectionStatus} pendingCount={pendingCount} staleCount={staleCount} />
          {pendingApprovals > 0 ? (
            <button
              type="button"
              onClick={onOpenPendingApprovals}
              className="inline-flex h-touch-min items-center gap-2 rounded-full border-2 border-status-warn-line bg-status-warn-bg px-4 text-sf-body font-bold text-status-warn-fg"
            >
              <IconKey size={20} /> 승인 대기 {pendingApprovals}
            </button>
          ) : null}
          {packLabelConfirmCount > 0 && onOpenPackLabelConfirm ? (
            <button
              type="button"
              onClick={onOpenPackLabelConfirm}
              className="inline-flex h-touch-min items-center gap-2 rounded-full border-2 border-status-warn-line bg-status-warn-bg px-4 text-sf-body font-bold text-status-warn-fg"
            >
              <IconTag size={20} /> 라벨 부착 확인 {packLabelConfirmCount}
            </button>
          ) : null}
          <button type="button" onClick={onLogout} className="min-h-touch-min rounded-sf border-2 border-line-strong bg-surface px-4 text-sf-lg font-bold">
            {workerName}
          </button>
          <span className="font-mono text-sf-body tabular-nums text-ink-muted">{clock}</span>
        </div>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}

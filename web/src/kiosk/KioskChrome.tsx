/**
 * KSK-20·30·31·40·50·60·61 공용 상단 고정 영역 (screens-shopfloor §0.9): 공정명·단말ID·작업자명·
 * 연결상태/미전송 N건·승인 대기 N·시각. KSK-10·01 은 디자인 웨이브의 `IdleScreen` 이 자체 헤더를 갖고
 * 있어 그대로 쓴다 — 이 컴포넌트는 그 외 화면들이 공유한다.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { ConnectionIndicator, WarnBannerList, type ConnectionStatus, type WarnBannerEntry } from '@/shared/ui/shopfloor'
import { IconKey } from '@/shared/ui/icons'

function useClock(): string {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(t)
  }, [])
  return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(now)
}

export type KioskChromeProps = {
  processName: string
  stationId: string
  workerName: string
  onLogout: () => void
  connectionStatus: ConnectionStatus
  pendingCount: number
  staleCount: number
  pendingApprovals: number
  onOpenPendingApprovals: () => void
  banners: WarnBannerEntry[]
  onDismissBanner: (id: string) => void
  children: ReactNode
}

export function KioskChrome({
  processName,
  stationId,
  workerName,
  onLogout,
  connectionStatus,
  pendingCount,
  staleCount,
  pendingApprovals,
  onOpenPendingApprovals,
  banners,
  onDismissBanner,
  children,
}: KioskChromeProps) {
  const clock = useClock()
  return (
    <div className="density-shopfloor flex min-h-dvh flex-col bg-surface-2" data-component="KioskChrome">
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

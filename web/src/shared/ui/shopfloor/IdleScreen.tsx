/**
 * 키오스크 대기 화면 뼈대 (spec §9.2). "QR을 스캔하세요" + 공정명·작업자명·미전송 건수 슬롯 + 대기열 슬롯.
 * 스캐너 훅·로그인·대기열 조회는 화면(kiosk/)이 붙인다.
 */
import type { ReactNode } from 'react'
import { cn } from '../cn'
import { IconQr, IconUser, IconWifiOff } from '../icons'

export type IdleScreenProps = {
  processName: string
  /** 로그인 전이면 생략 → "작업자 카드를 스캔하세요" 안내 */
  workerName?: string
  stationId?: string
  /** 오프라인 큐 미전송 건수. 0 이면 숨김 */
  pendingCount?: number
  /** 대기열 슬롯 (<QueueList>) */
  queue?: ReactNode
  /** 상단 배너 슬롯 (<WarnBannerStack>) */
  banner?: ReactNode
  /** 우상단 보조 액션 (로그아웃·재발행 등) */
  actions?: ReactNode
  className?: string
}

export function IdleScreen({ processName, workerName, stationId, pendingCount = 0, queue, banner, actions, className }: IdleScreenProps) {
  return (
    <div className={cn('density-shopfloor flex min-h-dvh flex-col bg-surface-2', className)} data-component="IdleScreen">
      {banner}
      <header className="flex items-center justify-between gap-4 border-b-2 border-line bg-surface px-6 py-3">
        <div className="flex items-baseline gap-4">
          <h1 className="text-sf-xl font-bold">{processName}</h1>
          {stationId ? <span className="font-mono text-sf-body text-ink-muted">{stationId}</span> : null}
        </div>
        <div className="flex items-center gap-4">
          {pendingCount > 0 ? (
            <span className="inline-flex h-touch-min items-center gap-2 rounded-full border-2 border-status-offline-line bg-status-offline-bg px-4 font-bold text-status-offline-fg">
              <IconWifiOff size={24} /> 미전송 {pendingCount}건
            </span>
          ) : null}
          <span className="inline-flex items-center gap-2 text-sf-lg">
            <IconUser size={26} className="text-ink-muted" />
            {workerName ? <strong>{workerName}</strong> : <span className="text-ink-muted">로그인 전</span>}
          </span>
          {actions}
        </div>
      </header>

      <main className="grid flex-1 grid-cols-1 gap-6 p-6 lg:grid-cols-[1fr_1.1fr]">
        <section className="flex flex-col items-center justify-center gap-6 rounded-sf border-2 border-line bg-surface p-8 text-center shadow-card">
          <IconQr size={120} className="text-brand-600" />
          <p className="text-sf-2xl font-bold">{workerName ? 'QR을 스캔하세요' : '작업자 카드를 스캔하세요'}</p>
          <p className="text-sf-lg text-ink-muted">
            {workerName ? '작업지시서 또는 라벨의 QR 을 스캐너에 대세요' : '로그인 후 작업 QR 을 스캔할 수 있습니다'}
          </p>
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-sf-lg font-bold text-ink-muted">이 공정 대기 (납기순)</h2>
          {queue}
        </section>
      </main>
    </div>
  )
}

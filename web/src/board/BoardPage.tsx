/**
 * BRD-01 SO 진행 현황판 — screens-shopfloor §3. `useBoardSocket` 이 준 `DashboardSummary` 를
 * KpiTile·ProgressBar·Ticker(디자인 웨이브 A9)로 그린다. 로그인 없음, 단말 키(BOARD)만 — §3 "접속".
 */
import { useEffect, useState } from 'react'
import { useWakeLock } from '@/shared/hooks/useWakeLock'
import { KpiTile, ProgressBar, StatusBadge, Ticker } from '@/shared/ui/shopfloor'
import { IconKey, IconRefresh, IconWarning, IconWifiOff } from '@/shared/ui/icons'
import type { SoProgress } from '@/shared/types'
import { useBoardSocket } from './useBoardSocket'

const PAGE_SIZE = 12
const PAGE_CYCLE_MS = 10_000

function useClock(): string {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(t)
  }, [])
  return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(now)
}

function fmtHms(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date(iso))
  } catch {
    return iso
  }
}

function fmtHm(iso: string | null): string | null {
  if (!iso) return null
  try {
    return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date(iso))
  } catch {
    return iso
  }
}

function SoRow({ so, delay }: { so: SoProgress; delay: boolean }) {
  return (
    <li
      className={
        delay
          ? 'flex flex-col gap-2 rounded-sf border-4 border-status-error-line bg-status-error-bg px-6 py-4'
          : 'flex flex-col gap-2 rounded-sf border-2 border-line bg-surface px-6 py-4'
      }
      data-component="BoardSoRow"
      data-delay={delay}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          {delay ? <IconWarning size={32} className="shrink-0 text-status-error-fg" aria-hidden="true" /> : null}
          <span className="font-mono text-tv-so font-bold tracking-tight">{so.so_code}</span>
          <span className="text-tv-body text-ink-muted">{so.customer_name}</span>
          {delay ? <span className="text-tv-body font-bold text-status-error-fg">지연 위험</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {so.current_processes.map((p) => (
            <span key={p} className="rounded-full border-2 border-line-strong bg-surface-2 px-3 py-1 text-tv-body font-semibold">
              {p}
            </span>
          ))}
          <StatusBadge kind="so" status={so.status} density="shopfloor" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-1">
        <ProgressBar
          value={so.progress_pct}
          displayText={so.status === 'PARTIAL_SHIPPED' ? '부분 발송' : undefined}
          label={`${so.so_code} 진행률`}
          className="min-w-[280px] flex-1"
        />
        <span className="text-tv-body text-ink-muted">
          납기 <strong className="text-ink">{so.due_date}</strong>
        </span>
        {so.est_complete_at ? (
          <span className="text-tv-body text-ink-muted">
            예상 <strong className="text-ink">{fmtHm(so.est_complete_at)}</strong>
          </span>
        ) : null}
      </div>
    </li>
  )
}

function ConnectionBanner({ connection, polling, updatedAt }: { connection: 'connected' | 'reconnecting' | 'reconnecting_long' | 'key_error'; polling: boolean; updatedAt: string | null }) {
  if (connection === 'connected') return null
  const long = connection === 'reconnecting_long'
  return (
    <div
      className={
        long
          ? 'flex min-h-touch items-center gap-3 border-b-4 border-status-warn-line bg-status-warn-bg px-6 text-tv-body font-bold text-status-warn-fg'
          : 'flex min-h-touch items-center gap-3 border-b-4 border-line-strong bg-surface-3 px-6 text-tv-body font-bold text-ink-muted'
      }
      role="status"
      aria-live="polite"
      data-component="BoardConnectionBanner"
    >
      <IconWifiOff size={28} className="shrink-0" aria-hidden="true" />
      실시간 연결 끊김 — 재연결 중 (마지막 갱신 {fmtHms(updatedAt)}){polling ? <span className="inline-flex items-center gap-1"><IconRefresh size={22} className="animate-spin" /> 폴링 갱신 중</span> : null}
    </div>
  )
}

function KeyErrorScreen() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-surface-2 p-10 text-center">
      <IconKey size={96} className="text-status-error-fg" />
      <h1 className="text-tv-so font-bold text-status-error-fg">단말 키 오류 (BOARD-1)</h1>
      <p className="text-tv-body text-ink-muted">관리자에게 문의하세요 — 현황판 단말 키가 거부되었습니다.</p>
    </div>
  )
}

export function BoardPage({ boardKey }: { boardKey: string }) {
  useWakeLock()
  const { state, connection, polling, dismissTickerItem } = useBoardSocket(boardKey)
  const clock = useClock()
  const [page, setPage] = useState(0)

  const summary = state.summary
  const todayDueLen = summary?.today_due.length ?? 0
  const pageCount = Math.max(1, Math.ceil(todayDueLen / PAGE_SIZE))

  useEffect(() => {
    setPage(0)
  }, [todayDueLen])

  useEffect(() => {
    if (pageCount <= 1) return
    const t = window.setInterval(() => setPage((p) => (p + 1) % pageCount), PAGE_CYCLE_MS)
    return () => window.clearInterval(t)
  }, [pageCount])

  if (connection === 'key_error') return <KeyErrorScreen />

  if (!summary) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface-2">
        <IconRefresh size={64} className="animate-spin text-brand-600" aria-hidden="true" />
        <p className="text-tv-body text-ink-muted">현황판 데이터를 불러오는 중…</p>
      </div>
    )
  }

  const todayPage = summary.today_due.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const offlineBacklog = summary.offline_backlog.filter((b) => b.count > 0)

  return (
    <div className="flex min-h-dvh flex-col bg-surface-2" data-component="BoardPage">
      <ConnectionBanner connection={connection} polling={polling} updatedAt={state.updatedAt} />

      <header className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-line bg-surface px-8 py-4">
        <h1 className="text-tv-so font-bold">SO 진행 현황판</h1>
        <div className="flex flex-wrap items-center gap-6 text-tv-body">
          {summary.pending_approvals > 0 ? (
            <span className="inline-flex h-touch items-center gap-2 rounded-full border-2 border-status-warn-line bg-status-warn-bg px-5 font-bold text-status-warn-fg">
              승인 대기 {summary.pending_approvals}
            </span>
          ) : null}
          <span className="text-ink-muted">
            마지막 갱신 <strong className="tabular-nums text-ink">{fmtHms(state.updatedAt)}</strong>
          </span>
          <span className="font-mono tabular-nums">{clock}</span>
        </div>
      </header>

      {offlineBacklog.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 border-b-2 border-status-warn-line bg-status-warn-bg px-8 py-2 text-tv-body font-bold text-status-warn-fg">
          <IconWifiOff size={24} aria-hidden="true" />
          {offlineBacklog.map((b) => (
            <span key={b.station_id}>
              {b.station_id} 미전송 {b.count}
            </span>
          ))}
        </div>
      ) : null}

      <main className="grid flex-1 grid-cols-1 gap-6 p-8 xl:grid-cols-[1.4fr_1fr]">
        <section className="flex flex-col gap-6">
          {summary.delay_risk.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h2 className="text-tv-body font-bold text-status-error-fg">지연 위험 ({summary.delay_risk.length})</h2>
              <ul className="flex flex-col gap-2">
                {summary.delay_risk.map((so) => (
                  <SoRow key={so.so_code} so={so} delay />
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-tv-body font-bold text-ink-muted">오늘 납기 ({todayDueLen})</h2>
              {pageCount > 1 ? (
                <span className="text-tv-body text-ink-muted tabular-nums">
                  {page + 1} / {pageCount}
                </span>
              ) : null}
            </div>
            {todayPage.length === 0 ? (
              <div className="rounded-sf border-2 border-dashed border-line p-8 text-center text-tv-body text-ink-muted">오늘 납기인 작업지시가 없습니다</div>
            ) : (
              <ul className="flex flex-col gap-2">
                {todayPage.map((so) => (
                  <SoRow key={so.so_code} so={so} delay={false} />
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-1">
            <KpiTile label="시간당 생산량" value={Math.round(summary.output_per_hour_today).toLocaleString('ko-KR')} unit="장/시간" />
            <KpiTile
              label="오늘 발송"
              tone={summary.today_shipments.overdue > 0 ? 'error' : 'default'}
              items={[
                { label: '계획', value: summary.today_shipments.planned },
                { label: '완료', value: summary.today_shipments.done },
                { label: '초과', value: summary.today_shipments.overdue, tone: summary.today_shipments.overdue > 0 ? 'error' : 'default' },
              ]}
            />
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-tv-body font-bold text-ink-muted">공정별 대기</h2>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-1">
              {summary.process_queue.map((row) => (
                <KpiTile
                  key={row.process_code}
                  label={row.process_name}
                  items={[
                    { label: '건수', value: `${row.wo_count.toLocaleString('ko-KR')}건` },
                    { label: '수량', value: `${row.qty_total.toLocaleString('ko-KR')}장` },
                    { label: '최장 대기', value: `${row.max_wait_hours}h` },
                  ]}
                />
              ))}
            </div>
          </div>
        </section>
      </main>

      <Ticker items={state.ticker} onExpire={dismissTickerItem} />
    </div>
  )
}

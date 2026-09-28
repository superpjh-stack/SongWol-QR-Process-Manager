/**
 * 상단 고정 경고 배너. 경고(WARN) · 승인 필요(requires_approval) · 오프라인/미전송 N건 · 오류(REJECT).
 * 절대 규칙 3 "조용한 실패 금지" — 네트워크 단절·미전송은 여기로 드러낸다.
 *
 * screens-shopfloor §4.1 은 이걸 **누적형(stack)** 으로 쓰길 기대한다 — flush 응답의 WARN/REJECT 가
 * 건별로 쌓이고(시각·WO·message·severity), 로그아웃해도 남는다(단말 상태이지 작업자 상태가 아니다).
 * 이 파일의 컴포넌트 자체는 상태를 갖지 않는다 — "로그아웃해도 유지"는 화면이 이 배너들의 목록을
 * 작업자 세션이 아니라 단말 세션(예: 오프라인 큐 스토어)에 보관해야 지켜진다.
 * 여러 개를 쌓을 때는 <WarnBannerStack> 에 직접 넣거나, 배열을 그대로 넘길 수 있는 <WarnBannerList> 를 쓴다.
 */
import type { ReactNode } from 'react'
import { cn } from '../cn'
import { IconError, IconKey, IconWarning, IconWifiOff, IconX } from '../icons'
import { TONE_CLASS, type StatusTone } from '../status'

export type WarnBannerKind = 'warning' | 'approval' | 'offline' | 'error'

export type WarnBannerProps = {
  kind: WarnBannerKind
  message: ReactNode
  /** ISO 시각 — 누적 목록에서 "언제" 발생했는지 (§0.6 사후 WARN) */
  at?: string | undefined
  /** 관련 WO 코드 — 누적 목록에서 "어느 작업지시" 인지 */
  woCode?: string | undefined
  /** 오프라인 미전송 건수 등. `N건` 으로 붙여 보여준다 */
  count?: number | undefined
  action?: { label: string; onClick: () => void } | undefined
  onDismiss?: (() => void) | undefined
  className?: string | undefined
}

const META: Record<WarnBannerKind, { tone: StatusTone; Icon: typeof IconWarning; title: string }> = {
  warning: { tone: 'warn', Icon: IconWarning, title: '경고' },
  approval: { tone: 'warn', Icon: IconKey, title: '반장 승인 필요' },
  offline: { tone: 'offline', Icon: IconWifiOff, title: '오프라인' },
  error: { tone: 'error', Icon: IconError, title: '오류' },
}

function fmtAt(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date(iso))
  } catch {
    return iso
  }
}

export function WarnBanner({ kind, message, at, woCode, count, action, onDismiss, className }: WarnBannerProps) {
  const { tone, Icon, title } = META[kind]
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live={kind === 'error' ? 'assertive' : 'polite'}
      className={cn(
        'flex min-h-touch items-center gap-4 border-b-2 px-5 py-2 text-sf-body',
        TONE_CLASS[tone],
        className,
      )}
      data-component="WarnBanner"
      data-kind={kind}
    >
      <Icon size={32} className="shrink-0" />
      <div className="min-w-0 flex-1">
        {at || woCode ? (
          <span className="mr-2 font-mono text-ink-muted">
            {at ? fmtAt(at) : null}
            {at && woCode ? ' · ' : null}
            {woCode}
          </span>
        ) : null}
        <span className="mr-2 font-bold">{title}</span>
        <span>{message}</span>
        {count !== undefined ? (
          <strong className="ml-2 rounded-full bg-surface px-3 py-0.5 tabular-nums">{count}건</strong>
        ) : null}
      </div>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="min-h-touch-min shrink-0 rounded-sf border-2 border-current bg-surface px-5 font-bold"
        >
          {action.label}
        </button>
      ) : null}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="확인"
          className="flex h-touch-min w-touch-min shrink-0 items-center justify-center rounded-sf"
        >
          <IconX size={28} />
        </button>
      ) : null}
    </div>
  )
}

export function WarnBannerStack({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return (
    <div className={cn('sticky top-0 z-30 flex flex-col', className)} data-component="WarnBannerStack">
      {children}
    </div>
  )
}

/** 누적 목록 항목 — 화면(오프라인 큐 스토어 등)이 시간순으로 보관해 그대로 넘긴다 */
export type WarnBannerEntry = {
  /** React key. event_uuid 등 고유값 */
  id: string
  kind: WarnBannerKind
  message: ReactNode
  at?: string
  woCode?: string
  count?: number
  action?: { label: string; onClick: () => void }
}

/**
 * `WarnBannerEntry[]` 를 그대로 넘기면 되는 누적 배너. 화면은 배열 상태만 관리하면 되고
 * (worker 로그아웃과 분리해서 보관하는 것은 여전히 호출부 책임), 개별 [확인] 은 `onDismiss(id)` 로 온다.
 */
export function WarnBannerList({ items, onDismiss, className }: { items: WarnBannerEntry[]; onDismiss?: (id: string) => void; className?: string }) {
  if (items.length === 0) return null
  return (
    <WarnBannerStack className={className}>
      {items.map((it) => (
        <WarnBanner
          key={it.id}
          kind={it.kind}
          message={it.message}
          at={it.at}
          woCode={it.woCode}
          count={it.count}
          action={it.action}
          onDismiss={onDismiss ? () => onDismiss(it.id) : undefined}
        />
      ))}
    </WarnBannerStack>
  )
}

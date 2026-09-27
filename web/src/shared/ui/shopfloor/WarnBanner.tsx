/**
 * 상단 고정 경고 배너. 경고(WARN) · 승인 필요(requires_approval) · 오프라인/미전송 N건 · 오류(REJECT).
 * 절대 규칙 3 "조용한 실패 금지" — 네트워크 단절·미전송은 여기로 드러낸다.
 * 여러 개를 쌓을 때는 <WarnBannerStack> 안에 넣는다.
 */
import type { ReactNode } from 'react'
import { cn } from '../cn'
import { IconError, IconKey, IconWarning, IconWifiOff, IconX } from '../icons'
import { TONE_CLASS, type StatusTone } from '../status'

export type WarnBannerKind = 'warning' | 'approval' | 'offline' | 'error'

export type WarnBannerProps = {
  kind: WarnBannerKind
  message: ReactNode
  /** 오프라인 미전송 건수 등. `N건` 으로 붙여 보여준다 */
  count?: number
  action?: { label: string; onClick: () => void }
  onDismiss?: () => void
  className?: string
}

const META: Record<WarnBannerKind, { tone: StatusTone; Icon: typeof IconWarning; title: string }> = {
  warning: { tone: 'warn', Icon: IconWarning, title: '경고' },
  approval: { tone: 'warn', Icon: IconKey, title: '반장 승인 필요' },
  offline: { tone: 'offline', Icon: IconWifiOff, title: '오프라인' },
  error: { tone: 'error', Icon: IconError, title: '오류' },
}

export function WarnBanner({ kind, message, count, action, onDismiss, className }: WarnBannerProps) {
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
          aria-label="닫기"
          className="flex h-touch-min w-touch-min shrink-0 items-center justify-center rounded-sf"
        >
          <IconX size={28} />
        </button>
      ) : null}
    </div>
  )
}

export function WarnBannerStack({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('sticky top-0 z-30 flex flex-col', className)} data-component="WarnBannerStack">
      {children}
    </div>
  )
}

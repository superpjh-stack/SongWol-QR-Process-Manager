/**
 * 토스트. <ToastProvider> 를 앱 루트(관리자 레이아웃)에 한 번 두고 화면은 useToast() 로 띄운다.
 *   const toast = useToast(); toast.success('저장했습니다'); toast.error('저장 실패: ' + err.message)
 * error 는 자동으로 닫히지 않는다 (조용한 실패 금지). 나머지는 4초.
 */
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '../cn'
import { IconCheck, IconError, IconInfo, IconWarning, IconX } from '../icons'
import { TONE_CLASS, type StatusTone } from '../status'

import { ToastContext, type ToastApi, type ToastItem, type ToastKind } from './toastContext'

const META: Record<ToastKind, { tone: StatusTone; Icon: typeof IconInfo }> = {
  success: { tone: 'done', Icon: IconCheck },
  error: { tone: 'error', Icon: IconError },
  info: { tone: 'progress', Icon: IconInfo },
  warning: { tone: 'warn', Icon: IconWarning },
}

const DEFAULT_MS = 4000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const seq = useRef(0)

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), [])
  const push = useCallback<ToastApi['push']>(
    (kind, message, opts) => {
      const id = ++seq.current
      setItems((xs) => [...xs, { id, kind, message }])
      const ms = opts?.durationMs ?? (kind === 'error' ? 0 : DEFAULT_MS)
      if (ms > 0) window.setTimeout(() => dismiss(id), ms)
      return id
    },
    [dismiss],
  )
  const api = useMemo<ToastApi>(
    () => ({
      push,
      dismiss,
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
      warning: (m) => push('warning', m),
    }),
    [push, dismiss],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-full max-w-sm flex-col gap-2" aria-live="polite">
        {items.map((t) => {
          const { tone, Icon } = META[t.kind]
          return (
            <div
              key={t.id}
              role={t.kind === 'error' ? 'alert' : 'status'}
              className={cn(
                'pointer-events-auto flex animate-toast-in items-start gap-2 rounded-ad border px-3 py-2 shadow-card',
                TONE_CLASS[tone],
              )}
            >
              <Icon size={18} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1 break-words">{t.message}</div>
              <button type="button" onClick={() => dismiss(t.id)} aria-label="닫기" className="shrink-0 opacity-70 hover:opacity-100">
                <IconX size={16} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

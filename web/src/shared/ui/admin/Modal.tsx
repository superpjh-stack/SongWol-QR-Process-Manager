/**
 * 모달. Esc·배경 클릭으로 닫힘(`dismissible=false` 면 버튼으로만).
 * 폼 확인 모달은 `footer` 에 <Button> 을 넣는다. 열릴 때 첫 포커스 가능 요소로 포커스를 옮긴다.
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '../cn'
import { IconX } from '../icons'

export type ModalProps = {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  dismissible?: boolean
}

const SIZE = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-4xl' } as const

export function Modal({ open, title, onClose, children, footer, size = 'md', dismissible = true }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const first = panelRef.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-modal-close])')
    first?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      prev?.focus()
    }
  }, [open, dismissible, onClose])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/50 p-4"
      onMouseDown={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={cn('flex max-h-[90vh] w-full flex-col rounded-ad bg-surface shadow-modal', SIZE[size])}
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 id="modal-title" className="text-ad-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            data-modal-close
            onClick={onClose}
            aria-label="닫기"
            className="flex h-8 w-8 items-center justify-center rounded-ad text-ink-muted hover:bg-surface-3"
          >
            <IconX size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer> : null}
      </div>
    </div>
  )
}

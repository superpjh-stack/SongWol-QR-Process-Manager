/** 확인 모달 (screens-admin §2 #8). 위험 톤은 [확인] 을 danger 로 */
import type { ReactNode } from 'react'
import { Button, ErrorAlert, Modal } from '@/shared/ui/admin'
import { toErrorView } from '@/shared/api'

export type ConfirmDialogProps = {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel?: string
  danger?: boolean
  loading?: boolean
  error?: unknown
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({ open, title, children, confirmLabel = '확인', danger, loading, error, onConfirm, onClose }: ConfirmDialogProps) {
  const ev = error ? toErrorView(error) : null
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      size="sm"
      dismissible={!loading}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            취소
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={Boolean(loading)}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {ev ? <ErrorAlert title={ev.title} message={ev.message} /> : null}
        <div>{children}</div>
      </div>
    </Modal>
  )
}

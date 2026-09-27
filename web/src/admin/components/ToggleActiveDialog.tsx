/** 비활성/재활성 확인 모달 (screens-admin §0.6 + api-contract §13.1 admin #3 activate) */
import type { ReactNode } from 'react'
import { useToast } from '@/shared/ui/admin'
import { useActivate, useDeactivate } from '@/shared/hooks'
import type { MasterResource } from '@/shared/api'
import { ConfirmDialog } from './ConfirmDialog'

export type ToggleActiveDialogProps<T extends { active: boolean }> = {
  resource: MasterResource
  entityLabel: string
  target: T | null
  idOf: (r: T) => string | number
  /** 「{code} {name}」 부분 */
  describe: (r: T) => ReactNode
  onClose: () => void
  onDone?: () => void
}

export function ToggleActiveDialog<T extends { active: boolean }>({ resource, entityLabel, target, idOf, describe, onClose, onDone }: ToggleActiveDialogProps<T>) {
  const toast = useToast()
  const deactivate = useDeactivate<T>(resource)
  const activate = useActivate<T>(resource)
  const isDeact = Boolean(target?.active)
  return (
    <ConfirmDialog
      open={target !== null}
      title={`${entityLabel} ${isDeact ? '비활성' : '재활성'}`}
      danger={isDeact}
      confirmLabel={isDeact ? '비활성' : '재활성'}
      loading={deactivate.loading || activate.loading}
      error={deactivate.error ?? activate.error}
      onClose={onClose}
      onConfirm={async () => {
        if (!target) return
        try {
          if (target.active) await deactivate.mutate(idOf(target))
          else await activate.mutate(idOf(target))
          toast.success(isDeact ? '비활성 처리되었습니다' : '재활성 처리되었습니다')
          onClose()
          onDone?.()
        } catch (e) {
          // ConfirmDialog 가 mutation error 를 ErrorAlert 로 표시한다
          toast.error(e instanceof Error ? e.message : String(e))
        }
      }}
    >
      {target ? (
        isDeact ? (
          <p>{describe(target)} 을(를) 비활성 처리합니다. 기존 거래 데이터는 유지됩니다.</p>
        ) : (
          <p>{describe(target)} 을(를) 다시 활성화합니다.</p>
        )
      ) : null}
    </ConfirmDialog>
  )
}

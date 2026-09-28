/**
 * KSK-50 RESULT — 결과 카드 (screens-shopfloor §1 KSK-50, §0.7). OK·저장됨은 2초 후 자동 IDLE(카운트다운
 * 링), WARN·REJECT·승인 필요는 [확인] 탭까지 유지.
 */
import { BigButton, ScanResultCard, type ScanResultVariant } from '@/shared/ui/shopfloor'
import { PrintMethodCodeLabel } from '@/shared/labels'
import { autoDismissMsFor } from '../kioskLogic'
import type { ScanResponse } from '@/shared/types'

export type ResultScreenProps =
  | { kind: 'response'; code: string; variant: ScanResultVariant; response: ScanResponse; onDismiss: () => void }
  | { kind: 'saved'; code: string; pendingCount: number; onDismiss: () => void }

export function ResultScreen(props: ResultScreenProps) {
  if (props.kind === 'saved') {
    return (
      <div className="mx-auto max-w-lg pt-6">
        <ScanResultCard
          wo={{ code: props.code, customerName: '—', itemName: '—', qty: 0, printMethod: '—' }}
          variant="saved"
          message={`저장됨 (미전송) — 복구 후 확인됩니다 · 미전송 ${props.pendingCount}건`}
          autoDismissMs={autoDismissMsFor('saved')}
          onDismiss={props.onDismiss}
        >
          <BigButton fullWidth onClick={props.onDismiss}>
            확인
          </BigButton>
        </ScanResultCard>
      </div>
    )
  }

  const { response, variant } = props
  const wo = response.wo
  const isLastStep = wo != null && (wo.status === 'PACKED' || wo.status === 'SHIPPED')

  return (
    <div className="mx-auto max-w-lg pt-6">
      <ScanResultCard
        wo={{
          code: wo?.code ?? props.code,
          customerName: wo?.customer_name ?? '—',
          itemName: wo?.item_name ?? '—',
          spec: wo?.spec ?? undefined,
          color: wo?.color ?? undefined,
          qty: wo?.qty_ordered ?? 0,
          printMethod: wo ? PrintMethodCodeLabel[wo.print_method] : '—',
          designThumbUrl: wo?.design_thumbnail_url ?? undefined,
          nextProcessName: variant === 'ok' ? (response.next_process ?? '마지막 공정 완료') : undefined,
          remainingQty: variant === 'ok' && response.remaining_qty != null ? response.remaining_qty : undefined,
          stepStatus: response.step?.status,
          woStatus: wo?.status,
        }}
        variant={variant}
        message={response.message}
        warnings={response.warnings}
        autoDismissMs={autoDismissMsFor(variant)}
        onDismiss={props.onDismiss}
      >
        <BigButton fullWidth onClick={props.onDismiss}>
          확인
        </BigButton>
      </ScanResultCard>
      {isLastStep ? <p className="mt-3 text-center text-sf-lg font-bold text-status-done-fg">✓ 이 작업지시의 이 공정은 끝났습니다</p> : null}
    </div>
  )
}

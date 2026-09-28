/**
 * KSK-81 RESULT(포장) — 박스 라벨 출력 (screens-shopfloor §1 KSK-81, P50 단말). KSK-50 과 달리 자동 IDLE
 * 이 없다(라벨 확인이 필요 — §1 KSK-81 "시간"). [다음 박스] 로 같은 WO 를 KSK-80 으로 복귀하거나 [완료] 로
 * IDLE 로 간다. [라벨 재출력]은 이 화면이 직접 `POST /labels/print` 를 부른다(§13.7 프린터 실패는 200/503
 * 두 경우 모두 대비 — 박스는 이미 커밋됐으므로 재출력만 다시 시도하면 된다).
 */
import { useState } from 'react'
import { stationApi } from '@/shared/api'
import { isApiError } from '@/shared/api/client'
import { BigButton, ScanResultCard, type ScanResultVariant } from '@/shared/ui/shopfloor'
import { IconCheck, IconX } from '@/shared/ui/icons'
import { PrintMethodCodeLabel } from '@/shared/labels'
import { autoDismissMsFor } from '../kioskLogic'
import type { LabelJob, ScanResponse } from '@/shared/types'

export type PackResultScreenProps =
  | { kind: 'saved'; code: string; pendingCount: number; onDismiss: () => void }
  | {
      kind: 'response'
      code: string
      variant: ScanResultVariant
      response: ScanResponse
      printerId: string | null
      onNextBox: () => void
      onDone: () => void
    }

export function PackResultScreen(props: PackResultScreenProps) {
  if (props.kind === 'saved') {
    return (
      <div className="mx-auto max-w-lg pt-6">
        <ScanResultCard
          wo={{ code: props.code, customerName: '—', itemName: '—', qty: 0, printMethod: '—' }}
          variant="saved"
          message={`저장됨 (미전송) — 박스 번호·라벨은 연결 후 · 미전송 ${props.pendingCount}건`}
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

  return <PackResultResponse {...props} />
}

function PackResultResponse({ code, variant, response, printerId, onNextBox, onDone }: Extract<PackResultScreenProps, { kind: 'response' }>) {
  const wo = response.wo
  const box = response.box
  const [labelJob, setLabelJob] = useState<LabelJob | undefined>(response.label_job)
  const [reprinting, setReprinting] = useState(false)
  const [reprintError, setReprintError] = useState<string | null>(null)

  const printed = labelJob?.zpl_sent === true

  async function reprint() {
    if (!box || !printerId) return
    setReprinting(true)
    setReprintError(null)
    try {
      const job = await stationApi.printLabel({ target: box.code, label_type: 'BOX_LABEL', printer: printerId, copies: 1 })
      setLabelJob(job)
    } catch (e) {
      setReprintError(isApiError(e) && e.status === 503 ? '프린터 연결 실패 — 다시 누르세요' : isApiError(e) ? e.message : '라벨 재출력에 실패했습니다')
    } finally {
      setReprinting(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg pt-6">
      <ScanResultCard
        wo={{
          code: wo?.code ?? code,
          customerName: wo?.customer_name ?? '—',
          itemName: wo?.item_name ?? '—',
          spec: wo?.spec ?? undefined,
          color: wo?.color ?? undefined,
          qty: wo?.qty_ordered ?? 0,
          printMethod: wo ? PrintMethodCodeLabel[wo.print_method] : '—',
          designThumbUrl: wo?.design_thumbnail_url ?? undefined,
          remainingQty: variant === 'ok' || variant === 'warn' ? (response.remaining_qty ?? undefined) : undefined,
          woStatus: wo?.status,
        }}
        variant={variant}
        message={response.message}
        warnings={response.warnings}
        onDismiss={onNextBox}
      >
        {box ? (
          <div className="flex w-full flex-col gap-2 rounded-sf border-2 border-line-strong bg-surface-2 p-4">
            <p className="text-sf-lg font-bold">
              박스 {box.box_no} — {box.qty.toLocaleString('ko-KR')}장 · LOT <span className="font-mono">{box.code}</span>
            </p>
            {printed ? (
              <p className="inline-flex items-center gap-2 text-sf-body font-bold text-status-done-fg">
                <IconCheck size={22} /> 라벨 출력됨
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="inline-flex items-center gap-2 text-sf-body font-bold text-status-error-fg" role="alert">
                  <IconX size={22} /> 라벨 미출력
                </p>
                {reprintError ? <p className="text-sf-body font-bold text-status-error-fg">{reprintError}</p> : null}
                {printerId ? (
                  <BigButton onClick={() => void reprint()} disabled={reprinting}>
                    {reprinting ? '출력 중…' : '라벨 재출력'}
                  </BigButton>
                ) : (
                  <p className="text-sf-body font-bold text-status-warn-fg">프린터 미설정 — 관리자 문의</p>
                )}
              </div>
            )}
          </div>
        ) : null}

        {wo?.status === 'PACKED' ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-status-done-bg px-4 py-2 text-sf-lg font-bold text-status-done-fg">
            <IconCheck size={22} /> 포장 완료 — 발송 대기
          </span>
        ) : null}

        <div className="flex w-full gap-touch-gap">
          <BigButton variant="secondary" fullWidth onClick={onDone}>
            완료
          </BigButton>
          <BigButton fullWidth onClick={onNextBox}>
            {variant === 'reject' ? '다시 시도' : '다음 박스'}
          </BigButton>
        </div>
      </ScanResultCard>
    </div>
  )
}

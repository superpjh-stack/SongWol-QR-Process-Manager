/**
 * PDA-13 입고 결과 — 누계 · PARTIAL/FULL/OVER · 부족 시 선택지 (screens-shopfloor §2 PDA-13).
 * `response.wo.receipt_status` 가 서버 공식값이라(ts-types §6 ScanWoSummary, §5 ⑯ 해결됨) 화면이 따로
 * 추정하지 않는다. LOT 코드도 `response.receipt.lot_code` 로 바로 온다(§5 ⑰ 해결됨) — 재조회가 필요 없다.
 * FAIL 이면 이 화면이 직접 `POST /lots/{code}/quarantine` 을 부른다(격리 메모는 선택).
 */
import { useState } from 'react'
import { stationApi } from '@/shared/api'
import { isApiError } from '@/shared/api/client'
import { autoDismissMsFor } from '@/shared/scanUtil'
import { BigButton, ScanResultCard, StatusBadge, type ScanResultVariant } from '@/shared/ui/shopfloor'
import { IconCheck } from '@/shared/ui/icons'
import type { Inspection, ScanResponse } from '@/shared/types'

export type ReceiveResultScreenProps =
  | { kind: 'saved'; code: string; pendingCount: number; onDismiss: () => void }
  | { kind: 'response'; code: string; variant: ScanResultVariant; response: ScanResponse; inspection: Inspection; onDismiss: () => void }

export function ReceiveResultScreen(props: ReceiveResultScreenProps) {
  if (props.kind === 'saved') {
    return (
      <div className="mx-auto max-w-lg pt-6">
        <ScanResultCard
          wo={{ code: props.code, customerName: '—', itemName: '—', qty: 0, printMethod: '—' }}
          variant="saved"
          message={`저장됨 (미전송) — 누계·부족 여부는 연결 후 · 미전송 ${props.pendingCount}건`}
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
  return <ReceiveResultResponse {...props} />
}

function ReceiveResultResponse({ code, variant, response, inspection, onDismiss }: Extract<ReceiveResultScreenProps, { kind: 'response' }>) {
  const wo = response.wo
  const receipt = response.receipt
  const [wantSplit, setWantSplit] = useState(false)
  const [memo, setMemo] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function saveQuarantine() {
    if (!receipt?.lot_code) return
    setSaving(true)
    setError(null)
    try {
      await stationApi.quarantineLot(receipt.lot_code, memo)
      setSaved(true)
    } catch (e) {
      setError(isApiError(e) ? e.message : '격리 메모 저장에 실패했습니다')
    } finally {
      setSaving(false)
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
          printMethod: '—',
          remainingQty: response.remaining_qty ?? undefined,
        }}
        variant={variant}
        message={response.message}
        warnings={response.warnings}
        autoDismissMs={variant === 'ok' && wo?.receipt_status !== 'PARTIAL' ? autoDismissMsFor('ok') : undefined}
        onDismiss={onDismiss}
      >
        {wo ? (
          <div className="flex w-full items-center justify-between gap-3 rounded-sf border-2 border-line-strong bg-surface-2 px-4 py-3">
            <span className="text-sf-lg font-bold">
              입고 누계 {wo.qty_received.toLocaleString('ko-KR')}/{wo.qty_ordered.toLocaleString('ko-KR')}
            </span>
            <StatusBadge kind="receipt" status={wo.receipt_status} density="shopfloor" />
          </div>
        ) : null}

        {receipt?.lot_code ? (
          <p className="text-sf-body text-ink-muted">
            LOT <span className="font-mono font-bold">{receipt.lot_code}</span>
          </p>
        ) : null}

        {wo?.receipt_status === 'PARTIAL' ? (
          <div className="flex w-full flex-col gap-2">
            <p className="text-sf-lg font-bold text-status-partial-fg">부족 {response.remaining_qty ?? wo.qty_ordered - wo.qty_received}장</p>
            <div className="flex gap-touch-gap">
              <BigButton variant="secondary" fullWidth onClick={onDismiss}>
                추가 입고 대기
              </BigButton>
              <BigButton fullWidth onClick={() => setWantSplit(true)}>
                하위 WO 분할 요청
              </BigButton>
            </div>
            {wantSplit ? (
              <p className="rounded-sf border-2 border-status-warn-line bg-status-warn-bg p-3 text-sf-body font-bold text-status-warn-fg" role="status">
                반장이 관리자 웹에서 분할합니다 — 이 단말에서는 직접 처리할 수 없습니다
              </p>
            ) : null}
          </div>
        ) : null}

        {inspection === 'FAIL' ? (
          <div className="flex w-full flex-col gap-2 rounded-sf border-2 border-status-error-line bg-status-error-bg p-4">
            <p className="text-sf-body font-bold text-status-error-fg">격리(QUARANTINE) — 입고 누계 미포함</p>
            {saved ? (
              <p className="inline-flex items-center gap-2 text-sf-body font-bold text-status-done-fg">
                <IconCheck size={20} /> 격리 메모 저장됨
              </p>
            ) : receipt?.lot_code ? (
              <>
                <textarea
                  value={memo}
                  onChange={(e) => setMemo(e.target.value.slice(0, 300))}
                  maxLength={300}
                  rows={2}
                  placeholder="격리 메모 (선택)"
                  className="w-full rounded-sf border-2 border-line-strong bg-surface p-3 text-sf-body"
                />
                {error ? <p className="text-sf-body font-bold text-status-error-fg">{error}</p> : null}
                <BigButton onClick={() => void saveQuarantine()} disabled={saving}>
                  {saving ? '저장 중…' : '격리 메모 저장'}
                </BigButton>
              </>
            ) : null}
          </div>
        ) : null}

        <BigButton fullWidth onClick={onDismiss}>
          확인
        </BigButton>
      </ScanResultCard>
    </div>
  )
}

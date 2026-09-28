/**
 * PDA-22 발송 확정 결과 — SO 잔량 (screens-shopfloor §2 PDA-22). 배치 응답 각 건은 `ScanResponse.shipment`
 * 가 이미 `ShipmentDetail`(= `so_remaining_qty` 포함, §5 ㉑ 해결됨)이라 재조회 없이 그대로 쓴다. 건별
 * 실패(REJECT)는 그 박스만 빨간 줄로 보여주고 나머지 성공분은 그대로 반영된 것으로 표시한다(배치는 한
 * 건 실패가 다음을 막지 않는다).
 */
import { BigButton, ScanResultCard } from '@/shared/ui/shopfloor'
import { autoDismissMsFor } from '@/shared/scanUtil'
import type { ScanResponse } from '@/shared/types'

export type ShipResultScreenProps =
  | { kind: 'saved'; pendingCount: number; onDismiss: () => void }
  | { kind: 'response'; results: Array<{ event_uuid: string; response: ScanResponse }>; unshippedRemaining: number; onDismiss: () => void }

export function ShipResultScreen(props: ShipResultScreenProps) {
  if (props.kind === 'saved') {
    return (
      <div className="mx-auto max-w-lg pt-6">
        <ScanResultCard
          wo={{ code: '—', customerName: '—', itemName: '—', qty: 0, printMethod: '—' }}
          variant="saved"
          message={`저장됨 (미전송) ${props.pendingCount}건 — 발송 결과는 연결 후`}
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
  return <ShipResultResponse {...props} />
}

function ShipResultResponse({ results, unshippedRemaining, onDismiss }: Extract<ShipResultScreenProps, { kind: 'response' }>) {
  const ok = results.filter((r) => r.response.result === 'OK' || (r.response.result === 'WARN' && !r.response.requires_approval))
  const approvalPending = results.filter((r) => r.response.result === 'WARN' && r.response.requires_approval)
  const failed = results.filter((r) => r.response.result === 'REJECT')

  // 같은 shipment 는 여러 박스 응답에 반복해서 실리므로 shipment.id 로 묶어 마지막(가장 최신 누계) 값만 쓴다
  const shipments = new Map<number, NonNullable<ScanResponse['shipment']>>()
  for (const r of ok) {
    if (r.response.shipment) shipments.set(r.response.shipment.id, r.response.shipment)
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 pt-6">
      {[...shipments.values()].map((s) => (
        <ScanResultCard
          key={s.id}
          wo={{ code: s.so_code, customerName: s.customer_name, itemName: '—', qty: s.qty_total, printMethod: '—' }}
          variant="ok"
          message={`발송 확정 — 송장 ${s.tracking_no ?? '—'} · 박스 ${s.box_count}개 · ${s.qty_total.toLocaleString('ko-KR')}장`}
        >
          <span className="text-sf-lg">
            <span className="text-ink-muted">SO 잔량 </span>
            <strong className="tabular-nums text-brand-700">{s.so_remaining_qty.toLocaleString('ko-KR')}</strong>
          </span>
        </ScanResultCard>
      ))}

      {approvalPending.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-sf border-2 border-status-warn-line bg-status-warn-bg p-4">
          <p className="text-sf-body font-bold text-status-warn-fg">승인 대기 {approvalPending.length}건 — 상단 「승인 대기」 목록에서 처리하세요</p>
          <ul className="flex flex-col gap-1 text-sf-body">
            {approvalPending.map((f) => (
              <li key={f.event_uuid}>{f.response.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {failed.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-sf border-2 border-status-error-line bg-status-error-bg p-4">
          <p className="text-sf-body font-bold text-status-error-fg">{failed.length}개 실패 — 목록으로 돌아가 확인</p>
          <ul className="flex flex-col gap-1 text-sf-body">
            {failed.map((f) => (
              <li key={f.event_uuid}>{f.response.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {unshippedRemaining > 0 ? <p className="text-center text-sf-lg font-bold text-status-warn-fg">미발송 박스 {unshippedRemaining}개 남음</p> : null}

      <BigButton size="lg" fullWidth onClick={onDismiss}>
        확인
      </BigButton>
    </div>
  )
}

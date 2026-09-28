/**
 * PDA-12 입고 입력 — 수량 · 박스수 · 검수 (screens-shopfloor §2 PDA-12). 입력 순서: ① 수량 ② 박스수
 * ③ 검수결과(TriChoice, 필수) ④ 협력업체명(선택). OVER 예상이면 사유(선택), FAIL 이면 격리 메모(선택).
 *
 * `NumPad` 의 내장 확인 버튼과 화면 하단 [입고 확정] 버튼은 같은 `onSubmit` 을 부른다 — 검수결과를 아직
 * 고르지 않았으면(§2 PDA-12 "반드시 누른다") `TriChoice` 의 힌트만 보이고 전송되지 않는다(호출부가 검증).
 */
import { useState } from 'react'
import { BigButton, NumPad, ReasonInput, ScanResultCard, StatusBadge, TriChoice, WarnBanner, isReasonComplete, isTriChoiceSelected, type ReasonValue } from '@/shared/ui/shopfloor'
import { PrintMethodCodeLabel } from '@/shared/labels'
import { estimateReceiveReconcile, isWoBlockedForReceive } from '../pdaLogic'
import type { Inspection, WorkOrderDetail } from '@/shared/types'

export type ReceiveEntryScreenProps = {
  code: string
  wo: WorkOrderDetail | null
  loading: boolean
  errorMessage: string | null
  offlineNoDetail: boolean
  qty: string
  onQtyChange: (v: string) => void
  boxCount: string
  onBoxCountChange: (v: string) => void
  inspection: Inspection | null
  onInspectionChange: (v: Inspection) => void
  vendor: string
  onVendorChange: (v: string) => void
  varianceReason: ReasonValue
  onVarianceReasonChange: (v: ReasonValue) => void
  quarantineMemo: string
  onQuarantineMemoChange: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
}

function fmtAt(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date(iso))
  } catch {
    return iso
  }
}

export function ReceiveEntryScreen({
  code,
  wo,
  loading,
  errorMessage,
  offlineNoDetail,
  qty,
  onQtyChange,
  boxCount,
  onBoxCountChange,
  inspection,
  onInspectionChange,
  vendor,
  onVendorChange,
  varianceReason,
  onVarianceReasonChange,
  quarantineMemo,
  onQuarantineMemoChange,
  onSubmit,
  onCancel,
}: ReceiveEntryScreenProps) {
  const [activeKey, setActiveKey] = useState<'qty' | 'box'>('qty')

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sf-xl text-ink-muted">
        <span className="font-mono">{code}</span>&nbsp;조회 중…
      </div>
    )
  }

  if (errorMessage && !wo) {
    return (
      <div className="flex flex-col items-center gap-6 pt-10 text-center">
        <p className="text-sf-2xl font-bold text-status-error-fg">{errorMessage}</p>
        <BigButton size="lg" onClick={onCancel}>
          대기 화면으로
        </BigButton>
      </div>
    )
  }

  const blocked = wo ? isWoBlockedForReceive(wo.status) : false
  const qtyNum = Number(qty || 0)
  const estimate = wo && qtyNum > 0 ? estimateReceiveReconcile(wo.qty_ordered, wo.qty_received, qtyNum) : null
  const canSubmit = !blocked && qtyNum > 0 && isTriChoiceSelected(inspection) && (estimate !== 'OVER' || isReasonComplete('optional', varianceReason))

  function attemptSubmit() {
    if (canSubmit) onSubmit()
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      {offlineNoDetail ? <WarnBanner kind="offline" message="오프라인 캐시로 표시 중입니다" /> : null}
      {!wo ? (
        <div className="rounded-sf border-2 border-line bg-surface p-4 text-center">
          <p className="font-mono text-sf-xl font-bold">{code}</p>
          <p className="mt-1 text-sf-body text-status-offline-fg">오프라인 — 상세 조회 불가. 수량만 입력해도 진행됩니다</p>
        </div>
      ) : (
        <>
          {blocked ? (
            <WarnBanner kind="error" message={`작업지시 상태 ${wo.status} — 처리할 수 없습니다${wo.hold_reason ? ` (${wo.hold_reason})` : ''}`} />
          ) : null}
          <ScanResultCard
            wo={{
              code: wo.code,
              customerName: wo.customer_name,
              itemName: wo.item.name ?? '—',
              spec: wo.item.spec ?? undefined,
              color: wo.item.color ?? undefined,
              qty: wo.qty_ordered,
              printMethod: PrintMethodCodeLabel[wo.print_method],
              dueDate: wo.due_date,
            }}
          >
            <span className="inline-flex items-center gap-2 text-sf-body text-ink-muted">
              입고 누계 {wo.qty_received.toLocaleString('ko-KR')}/{wo.qty_ordered.toLocaleString('ko-KR')}
              <StatusBadge kind="receipt" status={wo.receipt_status} density="shopfloor" />
            </span>
          </ScanResultCard>

          {wo.receipts.length > 0 ? (
            <div>
              <div className="mb-2 text-sf-body font-bold text-ink-muted">기존 입고 이력</div>
              <ol className="flex flex-col gap-2">
                {wo.receipts.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-sf border-2 border-line bg-surface px-4 py-2 text-sf-body">
                    <span className="text-ink-muted">{fmtAt(r.received_at)}</span>
                    <span className="font-bold tabular-nums">{r.qty.toLocaleString('ko-KR')}장</span>
                    <StatusBadge kind="inspection" status={r.inspection} density="shopfloor" />
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </>
      )}

      <NumPad
        fields={[
          { key: 'qty', label: '수량', value: qty, unit: '장' },
          { key: 'box', label: '박스수', value: boxCount, unit: '개' },
        ]}
        activeKey={activeKey}
        onActiveKeyChange={(k) => setActiveKey(k as 'qty' | 'box')}
        onFieldChange={(k, v) => (k === 'qty' ? onQtyChange(v) : onBoxCountChange(v))}
        onConfirm={attemptSubmit}
        confirmLabel="입고 확정"
        confirmDisabled={!canSubmit}
      />

      {estimate ? (
        <p className={estimate === 'OVER' ? 'text-sf-lg font-bold text-status-warn-fg' : 'text-sf-lg text-ink-muted'} role="status">
          입고 후 누계 {wo ? wo.qty_received + qtyNum : qtyNum}/{wo?.qty_ordered ?? '—'} → {estimate === 'PARTIAL' ? '부분 입고' : estimate === 'FULL' ? '입고 완료' : '지시수량 초과'}(예상)
        </p>
      ) : null}

      <TriChoice value={inspection} onChange={onInspectionChange} />

      {estimate === 'OVER' ? (
        <>
          <WarnBanner kind="warning" message="지시수량 초과 — 사유 권장" />
          <ReasonInput mode="optional" value={varianceReason} onChange={onVarianceReasonChange} label="초과 사유 (선택)" />
        </>
      ) : null}

      {inspection === 'FAIL' ? (
        <div className="flex flex-col gap-2 rounded-sf border-2 border-status-error-line bg-status-error-bg p-4">
          <p className="text-sf-body font-bold text-status-error-fg">불합격: 이 LOT 은 격리되고 입고 누계에 포함되지 않습니다</p>
          <label className="flex flex-col gap-1 text-sf-body">
            <span className="font-bold text-ink-muted">격리 메모 (선택)</span>
            <textarea
              value={quarantineMemo}
              onChange={(e) => onQuarantineMemoChange(e.target.value.slice(0, 300))}
              maxLength={300}
              rows={2}
              className="w-full rounded-sf border-2 border-line-strong bg-surface p-3 text-sf-body"
            />
          </label>
        </div>
      ) : null}

      <label className="flex flex-col gap-1 text-sf-body">
        <span className="font-bold text-ink-muted">협력업체명 (선택)</span>
        <input
          value={vendor}
          onChange={(e) => onVendorChange(e.target.value.slice(0, 80))}
          className="min-h-touch rounded-sf border-2 border-line-strong bg-surface px-4 text-sf-lg"
        />
      </label>

      <div className="flex gap-touch-gap">
        <BigButton variant="secondary" onClick={onCancel}>
          취소
        </BigButton>
        <BigButton size="lg" fullWidth disabled={!canSubmit} onClick={attemptSubmit}>
          입고 확정
        </BigButton>
      </div>
    </div>
  )
}

/**
 * KSK-20 SCANNED — WO 요약·설비 선택·[완료] (screens-shopfloor §1 KSK-20).
 */
import { useEffect } from 'react'
import { BigButton, EquipmentPicker, ScanResultCard, StepTimeline, WarnBanner, type EquipmentOption, type StepTimelineStep } from '@/shared/ui/shopfloor'
import { PrintMethodCodeLabel } from '@/shared/labels'
import { isWoStatusBlocked } from '../kioskLogic'
import type { WorkOrderDetail } from '@/shared/types'

export type ScannedScreenProps = {
  code: string
  wo: WorkOrderDetail | null
  loading: boolean
  errorMessage: string | null
  offlineNoDetail: boolean
  equipmentOptions: EquipmentOption[]
  equipmentValue: string | null
  onEquipmentChange: (code: string) => void
  onConfirm: () => void
  onCancel: () => void
}

export function ScannedScreen({ code, wo, loading, errorMessage, offlineNoDetail, equipmentOptions, equipmentValue, onEquipmentChange, onConfirm, onCancel }: ScannedScreenProps) {
  // 404 WO_NOT_FOUND → 3초 후 자동으로 대기 화면 (screens-shopfloor §1 KSK-20 오류 행)
  useEffect(() => {
    if (!errorMessage || wo) return
    const t = window.setTimeout(onCancel, 3000)
    return () => window.clearTimeout(t)
  }, [errorMessage, wo, onCancel])

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

  if (!wo) {
    // 오프라인이고 캐시도 없음 — 코드만 큰 글씨로 (spec §13)
    return (
      <div className="flex flex-col items-center gap-6 pt-10 text-center">
        <p className="font-mono text-sf-2xl font-bold">{code}</p>
        <p className="text-sf-lg text-status-offline-fg">오프라인 — 상세 조회 불가</p>
        <BigButton size="lg" onClick={onCancel}>
          대기 화면으로
        </BigButton>
      </div>
    )
  }

  const p30 = wo.steps.find((s) => s.process_code === 'P30')
  const idx = wo.steps.findIndex((s) => s.process_code === 'P30')
  const prev = idx > 0 ? wo.steps[idx - 1] : undefined
  const blocked = isWoStatusBlocked(wo.status)
  const canComplete = !blocked && equipmentValue !== null

  const timeline: StepTimelineStep[] = wo.steps.map((s) => ({
    processCode: s.process_code,
    processName: s.process_name,
    status: s.status,
    labelOverride: s.status === 'PARTIAL' ? `부분 완료 — 잔량 ${Math.max((s.qty_in ?? 0) - (s.qty_good ?? 0) - (s.qty_bad ?? 0), 0)}` : undefined,
  }))

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      {offlineNoDetail ? <WarnBanner kind="offline" message="오프라인 캐시로 표시 중입니다" /> : null}
      {blocked ? (
        <WarnBanner kind="error" message={`작업지시 상태 ${wo.status} — 처리할 수 없습니다${wo.hold_reason ? ` (${wo.hold_reason})` : ''}`} />
      ) : prev && (prev.status === 'WAITING' || prev.status === 'STARTED') ? (
        <WarnBanner kind="warning" message={`직전 공정(${prev.process_name}) 미완료 — 완료 시 반장 승인이 필요합니다`} />
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
          designThumbUrl: wo.design_thumbnail_url ?? undefined,
          stepStatus: p30?.status,
          woStatus: wo.status,
          dueDate: wo.due_date,
        }}
      >
        <span className="text-sf-body text-ink-muted">
          입고 {wo.qty_received}/{wo.qty_ordered}
        </span>
      </ScanResultCard>

      <StepTimeline steps={timeline} currentProcessCode="P30" />

      <div>
        <div className="mb-2 text-sf-body font-bold text-ink-muted">설비 선택</div>
        <EquipmentPicker options={equipmentOptions} value={equipmentValue} onChange={onEquipmentChange} rememberKey={wo.print_method} />
      </div>

      <div className="mt-2 flex gap-touch-gap">
        <BigButton variant="secondary" onClick={onCancel}>
          취소
        </BigButton>
        <BigButton size="lg" fullWidth disabled={!canComplete} onClick={onConfirm}>
          {equipmentValue === null && !blocked ? '설비를 선택하세요' : '완료'}
        </BigButton>
      </div>
    </div>
  )
}

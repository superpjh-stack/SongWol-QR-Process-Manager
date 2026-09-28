/**
 * KSK-30 QTY — 양품·불량 입력 (screens-shopfloor §1 KSK-30). [확인] 이 곧 2탭째(§0.9 2탭 규칙) — 이 화면의
 * [확인] 을 누르면 허용오차 판정에 따라 KSK-31(사유) 또는 곧장 전송(KSK-40)으로 간다. 분기는 KioskSession 이 한다.
 */
import { useState } from 'react'
import { BigButton, NumPad } from '@/shared/ui/shopfloor'
import { isToleranceExceeded } from '../kioskLogic'
import type { WorkOrderDetail } from '@/shared/types'

export type QtyScreenProps = {
  wo: WorkOrderDetail
  equipmentName: string
  qtyGood: string
  qtyBad: string
  onQtyGoodChange: (v: string) => void
  onQtyBadChange: (v: string) => void
  defaultGoodQty: number | null
  onConfirm: () => void
  onBack: () => void
}

export function QtyScreen({ wo, equipmentName, qtyGood, qtyBad, onQtyGoodChange, onQtyBadChange, defaultGoodQty, onConfirm, onBack }: QtyScreenProps) {
  const [activeKey, setActiveKey] = useState<'good' | 'bad'>('good')
  const step = wo.steps.find((s) => s.process_code === 'P30')
  const qtyIn = step?.qty_in ?? null
  const tol = step?.tolerance_pct ?? 0

  const good = Number(qtyGood || 0)
  const bad = Number(qtyBad || 0)
  const hasInput = qtyGood.length > 0 || qtyBad.length > 0
  const exceeded = hasInput ? isToleranceExceeded(qtyIn, tol, good, bad) : null

  const diff = qtyIn != null ? good + bad - qtyIn : null
  const allowed = qtyIn != null ? Math.round((qtyIn * tol) / 100) : null

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="rounded-sf border-2 border-line bg-surface px-5 py-3 text-sf-body">
        <span className="font-mono font-bold">{wo.code}</span> · {wo.item.name} · 설비 {equipmentName} · 투입 {qtyIn ?? '—'}
      </div>

      {diff !== null && allowed !== null ? (
        <p className={diff !== 0 ? 'text-sf-lg font-bold text-status-warn-fg' : 'text-sf-lg text-ink-muted'} role="status">
          차이 {diff > 0 ? '+' : ''}
          {diff} (허용 ±{allowed})
        </p>
      ) : (
        <p className="text-sf-lg text-ink-muted">투입수량 확인 불가 — 오차 판정 없이 바로 전송됩니다</p>
      )}

      <NumPad
        fields={[
          { key: 'good', label: '양품', value: qtyGood, unit: '장' },
          { key: 'bad', label: '불량', value: qtyBad, unit: '장' },
        ]}
        activeKey={activeKey}
        onActiveKeyChange={(k) => setActiveKey(k as 'good' | 'bad')}
        onFieldChange={(k, v) => (k === 'good' ? onQtyGoodChange(v) : onQtyBadChange(v))}
        onConfirm={onConfirm}
        confirmLabel="확인"
        confirmDisabled={good === 0 && bad === 0}
        customKeys={
          <button
            type="button"
            className="min-h-touch flex-1 rounded-sf border-2 border-line-strong bg-surface text-sf-lg font-bold"
            onClick={() => {
              onQtyGoodChange(defaultGoodQty != null ? String(defaultGoodQty) : '')
              onQtyBadChange('0')
            }}
          >
            양품 전량
          </button>
        }
      />

      {exceeded ? (
        <p className="text-sf-body font-bold text-status-warn-fg" role="alert">
          허용오차 초과 — [확인] 을 누르면 사유 입력으로 이동합니다
        </p>
      ) : null}

      <BigButton variant="secondary" onClick={onBack}>
        ← 설비 다시 선택
      </BigButton>
    </div>
  )
}

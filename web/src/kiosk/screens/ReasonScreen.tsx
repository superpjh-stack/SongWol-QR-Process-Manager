/**
 * KSK-31 QTY 분기 — E2 사유 입력 (screens-shopfloor §1 KSK-31).
 */
import { BigButton, ReasonInput, WarnBanner, isReasonComplete, type ReasonValue } from '@/shared/ui/shopfloor'

export type ReasonScreenProps = {
  diff: number
  tolerancePct: number
  shortfall: boolean
  value: ReasonValue
  onChange: (v: ReasonValue) => void
  onConfirm: () => void
  onBack: () => void
}

export function ReasonScreen({ diff, tolerancePct, shortfall, value, onChange, onConfirm, onBack }: ReasonScreenProps) {
  const complete = isReasonComplete('required', value)
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <WarnBanner
        kind="warning"
        message={`수량 차이 ${diff > 0 ? '+' : ''}${diff} — 허용오차 ±${tolerancePct}% 초과. 사유가 필요합니다`}
      />
      <p className="text-sf-body text-ink-muted">
        {shortfall ? '부분 완료(PARTIAL)로 기록되고 잔량은 다음 스캔에 누적됩니다.' : '완료로 기록되고 사유가 남습니다.'}
      </p>
      <ReasonInput mode="required" value={value} onChange={onChange} label="사유 선택" />
      <div className="mt-2 flex gap-touch-gap">
        <BigButton variant="secondary" onClick={onBack}>
          수량 다시 입력
        </BigButton>
        <BigButton size="lg" fullWidth disabled={!complete} onClick={onConfirm}>
          확인 — 전송
        </BigButton>
      </div>
    </div>
  )
}

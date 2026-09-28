/**
 * PDA-21 송장 입력/스캔 (screens-shopfloor §2 PDA-21). 송장번호는 `TextEntry` 로 1D 바코드 스캔(HID)과
 * 화면 입력을 함께 받는다. 택배사는 계약에 코드표가 없어(§5 ⑲ "정의 없음") 자유 텍스트 + 최근 사용 5개
 * 칩(기본값)으로 뒀다.
 */
import { BigButton, TextEntry } from '@/shared/ui/shopfloor'

export type TrackingScreenProps = {
  boxCount: number
  totalQty: number
  trackingNo: string
  onTrackingNoChange: (v: string) => void
  carrier: string
  onCarrierChange: (v: string) => void
  recentCarriers: string[]
  onConfirm: () => void
  onBack: () => void
}

export function TrackingScreen({ boxCount, totalQty, trackingNo, onTrackingNoChange, carrier, onCarrierChange, recentCarriers, onConfirm, onBack }: TrackingScreenProps) {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <div className="rounded-sf border-2 border-line bg-surface px-5 py-3 text-center text-sf-lg font-bold">
        박스 {boxCount}개 · 합계 {totalQty.toLocaleString('ko-KR')}장
      </div>

      <TextEntry
        label="송장번호"
        value={trackingNo}
        onChange={onTrackingNoChange}
        maxLength={40}
        placeholder="스캔하거나 입력하세요"
        scan={{ types: ['VB'], useRaw: false }}
      />

      <div className="flex flex-col gap-2">
        <span className="text-sf-body font-bold text-ink-muted">택배사</span>
        {recentCarriers.length > 0 ? (
          <div className="flex flex-wrap gap-touch-gap">
            {recentCarriers.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onCarrierChange(c)}
                className={`min-h-touch-min touch-manipulation rounded-full border-2 px-5 text-sf-body font-bold active:scale-[0.98] ${
                  carrier === c ? 'border-brand-700 bg-brand-600 text-white' : 'border-line-strong bg-surface text-ink active:bg-surface-3'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        ) : null}
        <input
          value={carrier}
          onChange={(e) => onCarrierChange(e.target.value.slice(0, 40))}
          placeholder="택배사명 (선택)"
          className="min-h-touch rounded-sf border-2 border-line-strong bg-surface px-4 text-sf-lg"
        />
      </div>

      <div className="flex gap-touch-gap">
        <BigButton variant="secondary" onClick={onBack}>
          ← 박스 목록
        </BigButton>
        <BigButton size="lg" fullWidth disabled={trackingNo.trim().length === 0} onClick={onConfirm}>
          발송 확정
        </BigButton>
      </div>
    </div>
  )
}

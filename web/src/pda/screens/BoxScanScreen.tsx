/**
 * PDA-20 발송 — 박스 QR 연속 스캔 (screens-shopfloor §2 PDA-20). `ScanList`(BoxList) 를 그대로 쓴다 —
 * 이 목록은 전송 전(빼기 가능) 목록이라 컴포넌트의 원래 용도에 정확히 맞는다(KSK-80 의 읽기 전용 이력과
 * 다른 점, PackScannedScreen.tsx 머리말 참고).
 */
import { BigButton, ScanList, type ScanListRow } from '@/shared/ui/shopfloor'

export type BoxScanScreenProps = {
  rows: ScanListRow[]
  onRemove: (id: string) => void
  onNext: () => void
}

export function BoxScanScreen({ rows, onRemove, onNext }: BoxScanScreenProps) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <p className="text-center text-sf-lg font-bold text-ink-muted">박스 QR 을 스캔하세요 (여러 개 가능)</p>
      <ScanList rows={rows} onRemove={onRemove} unitLabel="박스" />
      <BigButton size="lg" fullWidth disabled={rows.length === 0} onClick={onNext}>
        다음: 송장 입력
      </BigButton>
    </div>
  )
}

/**
 * PDA-11 업체 바코드 → WO 매핑 (screens-shopfloor §2 PDA-11). 순서: 업체 바코드 → 이어서 WO QR.
 * WO 를 스캔하기 전까지는 안내만, 스캔되면 WO 카드 + [매핑 저장]. 저장은 `ReceivingSession` 이
 * `POST /scan {action:"MAP"}` 로 한다(§2 PDA-11 "대안 API — 화면은 `/scan MAP` 만 쓴다").
 */
import { BigButton, WarnBanner } from '@/shared/ui/shopfloor'
import { PrintMethodCodeLabel } from '@/shared/labels'
import type { WorkOrderDetail } from '@/shared/types'

export type MappingScreenProps = {
  barcode: string
  wo: WorkOrderDetail | null
  loading: boolean
  errorMessage: string | null
  saving: boolean
  onSave: () => void
  onCancel: () => void
}

export function MappingScreen({ barcode, wo, loading, errorMessage, saving, onSave, onCancel }: MappingScreenProps) {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <div className="rounded-sf border-2 border-status-warn-line bg-status-warn-bg p-4 text-center">
        <p className="text-sf-body font-bold text-status-warn-fg">미등록 업체 바코드</p>
        <p className="font-mono text-sf-xl font-bold">{barcode}</p>
      </div>

      {errorMessage ? <WarnBanner kind="error" message={errorMessage} /> : null}

      {!wo ? (
        <p className="text-center text-sf-lg font-bold text-ink-muted">이어서 작업지시 QR 을 스캔하세요</p>
      ) : loading ? (
        <p className="text-center text-sf-lg text-ink-muted">작업지시 조회 중…</p>
      ) : (
        <div className="flex flex-col gap-3 rounded-sf border-2 border-line bg-surface p-4">
          <div className="font-mono text-sf-xl font-bold">{wo.code}</div>
          <dl className="flex flex-col gap-1 text-sf-lg">
            <div className="flex justify-between">
              <dt className="text-ink-muted">거래처</dt>
              <dd>{wo.customer_name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-muted">품목</dt>
              <dd>
                {wo.item.name} {[wo.item.spec, wo.item.color].filter(Boolean).join(' · ')}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-muted">가공방식</dt>
              <dd>{PrintMethodCodeLabel[wo.print_method]}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-muted">지시수량</dt>
              <dd className="tabular-nums">{wo.qty_ordered.toLocaleString('ko-KR')}</dd>
            </div>
          </dl>
          <BigButton size="lg" fullWidth disabled={saving} onClick={onSave}>
            {saving ? '저장 중…' : '매핑 저장'}
          </BigButton>
        </div>
      )}

      <BigButton variant="secondary" onClick={onCancel}>
        취소
      </BigButton>
    </div>
  )
}

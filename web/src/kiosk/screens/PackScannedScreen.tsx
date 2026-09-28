/**
 * KSK-80 SCANNED(포장) — 박스당 입수 (screens-shopfloor §1 KSK-80, P50 단말). KSK-20 과 같은 WO 카드 +
 * StepTimeline 을 재사용하되, 설비 선택 대신 박스당 입수 NumPad 하나만 있다(P50 `requires_equipment=false`).
 *
 * 기존 박스 목록(`wo.boxes`)은 이미 서버에 커밋된 이력이라 `ScanList`(빼기 버튼이 있는 "전송 전 목록" 용
 * 컴포넌트)를 그대로 쓰면 동작하지 않는 [빼기] 버튼이 생겨 §0.9 "조용한 실패 금지"에 어긋난다 — 여기서는
 * 같은 시각 언어로 된 단순 읽기 전용 목록을 직접 그린다(PDA-20 은 반대로 진짜 "빼기 가능한" 목록이라
 * `ScanList` 를 그대로 쓴다).
 */
import { BigButton, NumPad, ScanResultCard, StepTimeline, WarnBanner, type StepTimelineStep } from '@/shared/ui/shopfloor'
import { IconBox } from '@/shared/ui/icons'
import { PrintMethodCodeLabel } from '@/shared/labels'
import { p30NotDoneStatus, packRemainingQty } from '../packLogic'
import type { WorkOrderDetail } from '@/shared/types'

export type PackScannedScreenProps = {
  code: string
  wo: WorkOrderDetail | null
  loading: boolean
  errorMessage: string | null
  offlineNoDetail: boolean
  /** 오프라인 큐 상태 — true 면 "박스 라벨은 연결 후 자동 출력" 경고 (§1 KSK-80 오프라인) */
  offline: boolean
  qtyBox: string
  onQtyBoxChange: (v: string) => void
  onConfirm: () => void
  onCancel: () => void
}

function fmtTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date(iso))
  } catch {
    return iso
  }
}

export function PackScannedScreen({ code, wo, loading, errorMessage, offlineNoDetail, offline, qtyBox, onQtyBoxChange, onConfirm, onCancel }: PackScannedScreenProps) {
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

  const remaining = packRemainingQty(wo)
  const p30Status = p30NotDoneStatus(wo)
  const canPack = remaining > 0 && Number(qtyBox || 0) > 0

  const timeline: StepTimelineStep[] = wo.steps.map((s) => ({
    processCode: s.process_code,
    processName: s.process_name,
    status: s.status,
  }))

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      {offlineNoDetail ? <WarnBanner kind="offline" message="오프라인 캐시로 표시 중입니다" /> : null}
      {p30Status ? <WarnBanner kind="warning" message="직전 공정(인쇄) 미완료 — 포장 시 반장 승인이 필요합니다" /> : null}
      {offline ? (
        <WarnBanner kind="offline" message="오프라인: 박스 라벨은 연결 후 자동 출력됩니다. 박스에 순번을 수기로 적으세요" />
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
          woStatus: wo.status,
          dueDate: wo.due_date,
        }}
      >
        <span className="text-sf-body text-ink-muted">
          양품 {wo.qty_good.toLocaleString('ko-KR')} · 포장 누계 {wo.qty_packed.toLocaleString('ko-KR')} · 남은 수량{' '}
          <strong className="tabular-nums text-brand-700">{remaining.toLocaleString('ko-KR')}</strong>
        </span>
      </ScanResultCard>

      <StepTimeline steps={timeline} currentProcessCode="P50" />

      {wo.boxes.length > 0 ? (
        <div>
          <div className="mb-2 text-sf-body font-bold text-ink-muted">기존 박스 목록</div>
          <ol className="flex flex-col gap-2">
            {wo.boxes.map((b) => (
              <li key={b.code} className="flex flex-wrap items-center gap-3 rounded-sf border-2 border-line bg-surface px-4 py-3">
                <IconBox size={22} className="shrink-0 text-ink-muted" aria-hidden="true" />
                <span className="font-mono text-sf-body font-bold">{b.code}</span>
                <span className="text-sf-body text-ink-muted">박스 {b.box_no}</span>
                <span className="text-sf-body text-ink-muted">{fmtTime(b.packed_at)}</span>
                <span className="ml-auto text-sf-body font-bold tabular-nums">{b.qty.toLocaleString('ko-KR')}장</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {remaining > 0 ? (
        <NumPad
          label="박스당 입수"
          unit="장"
          value={qtyBox}
          onChange={onQtyBoxChange}
          onConfirm={onConfirm}
          max={remaining}
          confirmLabel="포장 — 박스 라벨 출력"
          confirmDisabled={!canPack}
          className="mx-auto"
        />
      ) : (
        <WarnBanner kind="warning" message="포장 완료된 작업지시입니다" />
      )}

      <BigButton variant="secondary" onClick={onCancel}>
        취소
      </BigButton>
    </div>
  )
}

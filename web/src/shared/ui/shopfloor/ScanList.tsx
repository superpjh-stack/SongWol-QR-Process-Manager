/**
 * 연속 스캔 목록 (screens-shopfloor §4.2 A5, PDA-20 본문에서는 "BoxList"). PDA-20 발송의 박스 QR 연속
 * 스캔 목록과 KSK-80 의 기존 박스 목록(boxes[])이 같은 행 모양을 공유한다.
 *
 * 이 컴포넌트는 조회(GET /boxes/{code})를 하지 않는다 — 화면이 스캔마다 조회해서 만든 `ScanListRow` 를
 * 넘기면 그리기만 한다(QueueList·PendingList 와 같은 원칙). 화면이 판단해야 하는 것(§2 PDA-20 표):
 *   - 이미 발송된 박스(`BOX_ALREADY_SHIPPED`) → 목록에 아예 넣지 않는다 (이 컴포넌트가 막지 않는다)
 *   - 중복 스캔(같은 code 재스캔) → `hasScanListDuplicate` 로 미리 걸러 토스트만 띄우고 행을 추가하지 않는다
 *   - 다른 SO 의 박스 → 행은 추가하되 `status:'warn'` + `note` 로 경고 문구를 달아 보여준다(막지 않는다)
 *   - 오프라인이라 조회 자체가 안 됨 → `status:'offline'` 로 code 만 채우고 나머지는 "정보 없음"
 *
 * 합계 줄 "박스 N개 · 합계 {Σqty}장" 은 qty 를 모르는(오프라인) 행을 0 으로 셈한다(연결 후 서버가 정확한
 * 값을 준다 — 이 목록의 합계는 어디까지나 현장 확인용 예상치다).
 */
import { cn } from '../cn'
import { IconBox, IconWarning, IconWifiOff, IconX } from '../icons'

export type ScanListRowStatus = 'ok' | 'warn' | 'offline'

export type ScanListRow = {
  /** React key. 보통 스캔 code(LT-...) — 화면은 이 값으로 hasScanListDuplicate 를 확인한다 */
  id: string
  code: string
  woCode: string | null
  boxNo: number | null
  qty: number | null
  customerName: string | null
  /** 'warn' 이면 note 를 함께 보여준다. 'offline' 이면 조회 불가 고정 문구를 쓴다(정보 없음) */
  status: ScanListRowStatus
  /** status='warn' 일 때만 쓰는 경고 문구 (예: "다른 수주(SO-...)의 박스입니다 — 송장이 분리됩니다") */
  note?: string | null
}

export type ScanListProps = {
  rows: ScanListRow[]
  /** 행 [빼기] — 아직 전송 전이므로 로컬 삭제만 한다(서버 호출 없음) */
  onRemove: (id: string) => void
  emptyText?: string
  /** 합계 줄 라벨. 기본 "박스" (KSK-80 은 다른 명칭이 필요하면 여기로) */
  unitLabel?: string
  className?: string
}

/** 같은 code 가 이미 목록에 있는지 — 화면이 스캔 직후(조회 전) 먼저 확인해 중복 토스트를 띄울 때 쓴다 */
export function hasScanListDuplicate(rows: ScanListRow[], code: string): boolean {
  return rows.some((r) => r.code === code)
}

/** 합계 장수 — qty 를 모르는 행(오프라인)은 0 으로 셈한다 */
export function sumScanListQty(rows: ScanListRow[]): number {
  return rows.reduce((sum, r) => sum + (r.qty ?? 0), 0)
}

const NA = <span className="text-ink-faint">정보 없음</span>

export function ScanList({ rows, onRemove, emptyText = '스캔한 항목이 없습니다', unitLabel = '박스', className }: ScanListProps) {
  return (
    <div className={cn('flex flex-col gap-3', className)} data-component="ScanList">
      {rows.length === 0 ? (
        <div className="rounded-sf border-2 border-dashed border-line p-6 text-center text-sf-lg text-ink-muted">{emptyText}</div>
      ) : (
        <ol className="flex flex-col gap-2">
          {rows.map((row) => {
            const offline = row.status === 'offline'
            const warn = row.status === 'warn'
            return (
              <li
                key={row.id}
                className={cn(
                  'flex flex-wrap items-center gap-3 rounded-sf border-2 px-4 py-3',
                  warn ? 'border-status-warn-line bg-status-warn-bg' : offline ? 'border-line-strong bg-surface-3' : 'border-line bg-surface',
                )}
              >
                <IconBox size={24} className={cn('shrink-0', offline ? 'text-ink-faint' : 'text-ink-muted')} aria-hidden="true" />

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-sf-lg font-bold">{row.code}</span>
                    <span className="text-sf-body text-ink-muted">{row.woCode ?? NA}</span>
                    <span className="text-sf-body text-ink-muted">{row.boxNo !== null ? `박스 ${row.boxNo}` : NA}</span>
                  </div>
                  <div className="text-sf-body text-ink-muted">{row.customerName ?? NA}</div>

                  {offline ? (
                    <p className="mt-1 inline-flex items-center gap-1 text-sf-body font-bold text-ink-muted" role="status">
                      <IconWifiOff size={18} /> 오프라인 — 박스 정보 확인 불가
                    </p>
                  ) : warn ? (
                    <p className="mt-1 inline-flex items-center gap-1 text-sf-body font-bold text-status-warn-fg" role="alert">
                      <IconWarning size={18} /> {row.note ?? '다른 수주의 박스입니다'}
                    </p>
                  ) : null}
                </div>

                <div className="shrink-0 text-right">
                  <span className="block text-sf-lg font-bold tabular-nums">{row.qty !== null ? `${row.qty.toLocaleString('ko-KR')}장` : NA}</span>
                </div>

                <button
                  type="button"
                  onClick={() => onRemove(row.id)}
                  className={cn(
                    'flex min-h-touch-min shrink-0 touch-manipulation items-center gap-1 rounded-sf border-2 border-line-strong bg-surface px-4 text-sf-body font-bold text-ink-muted',
                    'active:scale-[0.98] active:bg-surface-3',
                  )}
                  aria-label={`${row.code} 빼기`}
                >
                  <IconX size={18} /> 빼기
                </button>
              </li>
            )
          })}
        </ol>
      )}

      <div className="flex items-center justify-between rounded-sf border-2 border-line-strong bg-surface-2 px-4 py-3 text-sf-lg font-bold" role="status">
        <span>
          {unitLabel} {rows.length.toLocaleString('ko-KR')}개
        </span>
        <span className="tabular-nums">합계 {sumScanListQty(rows).toLocaleString('ko-KR')}장</span>
      </div>
    </div>
  )
}

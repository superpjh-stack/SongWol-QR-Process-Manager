/**
 * 현황판 하단 티커 (BRD-01 WS `notification`/`approval_pending`, screens-shopfloor §3·§4.2 A9).
 * 한 번에 한 줄만 「{type 표시명} · {target_code} · {message}」 형식으로 보여주고, `dwellMs`(기본값
 * 30_000 — spec 기본값 "30초 노출") 가 지나면 다음 항목으로 넘어간다. `type=DELAY` 는 빨강(§3 색 규칙,
 * 아이콘도 함께 붙여 색만으로 구분하지 않는다 — design-tokens §5.2).
 *
 * 두 가지 사용 방식을 지원한다:
 *  - **제어형** `onExpire(id)` 를 주면: dwellMs 뒤 그 항목의 id 로 한 번 불러준다. 화면이 자기 큐(WS 로
 *    쌓은 알림 배열)에서 그 항목을 지우면 다음 렌더에서 `items[0]` 이 자연히 다음 알림이 된다 — 이 방식이
 *    "한 번 뜨고 사라지는" spec 의 알림 큐 동작에 맞는 기본값이다.
 *  - **비제어형** `onExpire` 를 생략하면: 내부적으로 인덱스를 돌려 목록을 계속 순환한다(정적 목록을
 *    그대로 넘기는 데모/미리보기용).
 */
import { useEffect, useState } from 'react'
import { cn } from '../cn'
import { IconWarning } from '../icons'
import type { NotificationType } from '../../types'

export type TickerItem = {
  /** React key. notification.id 등 고유값 */
  id: string
  type: NotificationType
  /** target_code (WO/SO 코드 등) */
  targetCode: string
  message: string
}

export type TickerProps = {
  items: TickerItem[]
  /** 항목당 노출 시간(ms). spec 기본값 30초 */
  dwellMs?: number | undefined
  /** 제어형 — dwellMs 뒤 현재 항목의 id 로 한 번 불린다. 화면이 큐에서 제거한다 */
  onExpire?: ((id: string) => void) | undefined
  emptyText?: string | undefined
  className?: string | undefined
}

/** NotificationType 한글 표시명 — contracts·spec 어디에도 정의가 없어 디자인 기본값으로 붙였다 */
const TYPE_LABEL: Record<NotificationType, string> = {
  DELAY: '지연',
  DEFECT: '불량',
  RECEIPT_SHORT: '입고 부족',
  QTY_VARIANCE: '수량 차이',
  APPROVAL_REQUEST: '승인 요청',
  OFFLINE_BACKLOG: '오프라인 미전송',
}

export function Ticker({ items, dwellMs = 30_000, onExpire, emptyText = '알림 없음', className }: TickerProps) {
  const [index, setIndex] = useState(0)

  // 목록이 짧아져 index 가 범위를 벗어나면 되돌린다 (비제어형 순환 · items 축소 모두 해당)
  useEffect(() => {
    if (index >= items.length && items.length > 0) setIndex(0)
  }, [items.length, index])

  const current = items[index] ?? null

  useEffect(() => {
    if (!current) return
    const id = current.id
    const t = window.setTimeout(() => {
      if (onExpire) {
        onExpire(id)
      } else {
        setIndex((i) => (items.length <= 1 ? 0 : (i + 1) % items.length))
      }
    }, dwellMs)
    return () => window.clearTimeout(t)
    // current.id 가 바뀔 때만 새로 예약한다 — items 배열 자체(참조)가 바뀌어도 같은 항목이 head 면 다시 돌지 않는다
  }, [current?.id, dwellMs, onExpire])

  return (
    <div
      className={cn('flex min-h-touch items-center gap-3 border-t-2 border-line bg-surface px-6 text-tv-body font-semibold', className)}
      data-component="Ticker"
      role="status"
      aria-live="polite"
    >
      {current ? (
        <div
          key={current.id}
          className={cn('flex min-w-0 flex-1 items-center gap-2', current.type === 'DELAY' && 'text-status-error-fg')}
        >
          {current.type === 'DELAY' ? <IconWarning size={28} className="shrink-0" aria-hidden="true" /> : null}
          <span className="shrink-0 font-bold">{TYPE_LABEL[current.type]}</span>
          <span className="shrink-0 text-ink-muted" aria-hidden="true">
            ·
          </span>
          <span className="shrink-0 font-mono">{current.targetCode}</span>
          <span className="shrink-0 text-ink-muted" aria-hidden="true">
            ·
          </span>
          <span className="min-w-0 truncate">{current.message}</span>
        </div>
      ) : (
        <span className="text-ink-faint">{emptyText}</span>
      )}
    </div>
  )
}

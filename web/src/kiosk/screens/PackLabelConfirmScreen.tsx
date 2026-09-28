/**
 * 오프라인 포장 라벨 부착 확인 (api-contract §13.7 ⑬, DEF-QA2-S3-005 수정). 오프라인 중 포장한 박스가
 * 온라인 복귀로 flush 되면 서버가 LT 코드를 채번하고 박스마다 라벨을 자동 출력한다. 작업자가 오프라인
 * 중 박스에 미리 적어 둔 임시 번호 `#n`(= `client_seq`, 라벨에도 같은 번호가 "임시 #n" 으로 인쇄된다)과
 * 실제 LT 코드를 대조해 붙일 수 있도록 flush 결과를 목록(`#n → LOT 코드 → 수량`)으로 보여준다.
 *
 * 목록은 IndexedDB(`pack_confirmations`, `usePackLabelConfirmations`)에 있어 화면을 보고 있지 않은 사이
 * (30초 주기·재연결 flush)에도, 새로고침돼도 [부착 완료] 전까지 없어지지 않는다(조용한 실패 금지).
 * [재출력]은 KSK-81(`PackResultScreen`)과 같은 `POST /labels/print` 호출을 그대로 재사용한다.
 */
import { useState } from 'react'
import { stationApi } from '@/shared/api'
import { isApiError } from '@/shared/api/client'
import { BigButton } from '@/shared/ui/shopfloor'
import { IconBox, IconCheck, IconTag, IconX } from '@/shared/ui/icons'
import type { LabelJob } from '@/shared/types'
import type { PackLabelConfirmation } from '@/shared/offline'

export type PackLabelConfirmScreenProps = {
  items: PackLabelConfirmation[]
  printerId: string | null
  onLabelUpdated: (id: string, labelJob: LabelJob) => void
  onAckAll: () => void
  onClose: () => void
}

function fmtAt(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date(iso))
  } catch {
    return iso
  }
}

function ConfirmRow({ item, printerId, onLabelUpdated }: { item: PackLabelConfirmation; printerId: string | null; onLabelUpdated: (id: string, labelJob: LabelJob) => void }) {
  const [reprinting, setReprinting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const printed = item.labelJob?.zpl_sent === true

  async function reprint() {
    if (!printerId) return
    setReprinting(true)
    setError(null)
    try {
      const job = await stationApi.printLabel({ target: item.boxCode, label_type: 'BOX_LABEL', printer: printerId, copies: 1 })
      onLabelUpdated(item.id, job)
    } catch (e) {
      setError(isApiError(e) && e.status === 503 ? '프린터 연결 실패 — 다시 누르세요' : isApiError(e) ? e.message : '라벨 재출력에 실패했습니다')
    } finally {
      setReprinting(false)
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-sf border-2 border-line-strong bg-surface px-4 py-3">
      <span className="flex h-touch-min min-w-touch-min shrink-0 items-center justify-center rounded-full bg-brand-700 px-3 font-mono text-sf-lg font-bold text-white" aria-label={`임시 번호 ${item.n}`}>
        #{item.n}
      </span>
      <IconBox size={22} className="shrink-0 text-ink-muted" aria-hidden="true" />
      <span className="font-mono text-sf-lg font-bold">{item.boxCode}</span>
      <span className="text-sf-body text-ink-muted">
        {item.woCode} · 박스 {item.boxNo} · {fmtAt(item.at)}
      </span>
      <span className="text-sf-body font-bold tabular-nums">{item.qty.toLocaleString('ko-KR')}장</span>

      <span className="ml-auto flex flex-wrap items-center gap-3">
        {printed ? (
          <span className="inline-flex items-center gap-1 text-sf-body font-bold text-status-done-fg">
            <IconCheck size={20} /> 출력됨
          </span>
        ) : (
          <>
            <span className="inline-flex items-center gap-1 text-sf-body font-bold text-status-error-fg" role="alert">
              <IconX size={20} /> 미출력
            </span>
            {printerId ? (
              <BigButton onClick={() => void reprint()} disabled={reprinting}>
                {reprinting ? '출력 중…' : '재출력'}
              </BigButton>
            ) : (
              <span className="text-sf-body font-bold text-status-warn-fg">프린터 미설정 — 관리자 문의</span>
            )}
          </>
        )}
      </span>
      {error ? <span className="w-full text-sf-body font-bold text-status-error-fg">{error}</span> : null}
    </li>
  )
}

export function PackLabelConfirmScreen({ items, printerId, onLabelUpdated, onAckAll, onClose }: PackLabelConfirmScreenProps) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-3">
        <IconTag size={28} className="shrink-0 text-brand-700" aria-hidden="true" />
        <div>
          <h2 className="text-sf-xl font-bold">
            박스 라벨 {items.length.toLocaleString('ko-KR')}장 출력 — #n 순서대로 부착
          </h2>
          <p className="text-sf-body text-ink-muted">오프라인 중 박스에 적어 둔 임시 번호(#n)와 아래 LOT 코드를 대조해 라벨을 붙이세요.</p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-sf border-2 border-dashed border-line p-6 text-center text-sf-lg text-ink-muted">확인할 라벨이 없습니다</div>
      ) : (
        <ol className="flex flex-col gap-2">
          {items.map((it) => (
            <ConfirmRow key={it.id} item={it} printerId={printerId} onLabelUpdated={onLabelUpdated} />
          ))}
        </ol>
      )}

      <div className="flex gap-touch-gap">
        <BigButton variant="secondary" onClick={onClose}>
          나중에
        </BigButton>
        <BigButton fullWidth onClick={onAckAll} disabled={items.length === 0}>
          부착 완료
        </BigButton>
      </div>
    </div>
  )
}

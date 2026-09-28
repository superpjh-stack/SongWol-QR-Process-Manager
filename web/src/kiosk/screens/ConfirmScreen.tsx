/**
 * KSK-40 CONFIRM — 요약·전송 (screens-shopfloor §1 KSK-40). 설계상 추가 탭이 없는 상태다: KSK-30/31 의
 * [확인] 이 곧 전송이고, 이 화면은 "무엇을 보냈는지" 요약 + 진행 표시만 한다. 1초 넘으면 "응답 대기 중".
 *
 * P50 포장(KSK-80 → 전송)도 같은 "전송 중…" 대기 화면을 쓴다 — `kind:'pack'` 은 설비·양품·불량 대신
 * 박스당 입수만 보여준다(§1 KSK-80 은 설비 선택이 없다, `requires_equipment=false`).
 */
import { useEffect, useState } from 'react'
import { Spinner } from '@/shared/ui/admin/Spinner'

export type ConfirmScreenProps =
  | { kind: 'done'; woCode: string; equipmentName: string; qtyGood: number; qtyBad: number; varianceReasonLabel?: string | null }
  | { kind: 'pack'; woCode: string; qtyBox: number }

export function ConfirmScreen(props: ConfirmScreenProps) {
  const [waitingLong, setWaitingLong] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setWaitingLong(true), 1000)
    return () => window.clearTimeout(t)
  }, [])

  const { woCode } = props

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-6 pt-10 text-center">
      <Spinner size={48} />
      <p className="text-sf-2xl font-bold">{waitingLong ? '응답 대기 중…' : '전송 중…'}</p>
      <div className="w-full rounded-sf border-2 border-line bg-surface p-5 text-left text-sf-lg">
        <dl className="flex flex-col gap-2">
          <div className="flex justify-between">
            <dt className="text-ink-muted">작업지시</dt>
            <dd className="font-mono font-bold">{woCode}</dd>
          </div>
          {props.kind === 'done' ? (
            <>
              <div className="flex justify-between">
                <dt className="text-ink-muted">설비</dt>
                <dd>{props.equipmentName}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">양품</dt>
                <dd className="tabular-nums">{props.qtyGood.toLocaleString('ko-KR')}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">불량</dt>
                <dd className="tabular-nums">{props.qtyBad.toLocaleString('ko-KR')}</dd>
              </div>
              {props.varianceReasonLabel ? (
                <div className="flex justify-between">
                  <dt className="text-ink-muted">사유</dt>
                  <dd>{props.varianceReasonLabel}</dd>
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex justify-between">
              <dt className="text-ink-muted">박스당 입수</dt>
              <dd className="tabular-nums">{props.qtyBox.toLocaleString('ko-KR')}장</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  )
}

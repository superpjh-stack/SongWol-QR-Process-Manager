/**
 * KSK-40 CONFIRM — 요약·전송 (screens-shopfloor §1 KSK-40). 설계상 추가 탭이 없는 상태다: KSK-30/31 의
 * [확인] 이 곧 전송이고, 이 화면은 "무엇을 보냈는지" 요약 + 진행 표시만 한다. 1초 넘으면 "응답 대기 중".
 */
import { useEffect, useState } from 'react'
import { Spinner } from '@/shared/ui/admin/Spinner'

export type ConfirmScreenProps = {
  woCode: string
  equipmentName: string
  qtyGood: number
  qtyBad: number
  varianceReasonLabel?: string | null
}

export function ConfirmScreen({ woCode, equipmentName, qtyGood, qtyBad, varianceReasonLabel }: ConfirmScreenProps) {
  const [waitingLong, setWaitingLong] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setWaitingLong(true), 1000)
    return () => window.clearTimeout(t)
  }, [])

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
          <div className="flex justify-between">
            <dt className="text-ink-muted">설비</dt>
            <dd>{equipmentName}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-muted">양품</dt>
            <dd className="tabular-nums">{qtyGood.toLocaleString('ko-KR')}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-muted">불량</dt>
            <dd className="tabular-nums">{qtyBad.toLocaleString('ko-KR')}</dd>
          </div>
          {varianceReasonLabel ? (
            <div className="flex justify-between">
              <dt className="text-ink-muted">사유</dt>
              <dd>{varianceReasonLabel}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    </div>
  )
}

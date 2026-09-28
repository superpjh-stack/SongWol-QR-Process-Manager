/**
 * "전송 중…" 대기 화면 — PDA-12→13(RECEIVE)·PDA-21→22(SHIP) 이 공유한다. `kiosk/screens/ConfirmScreen.tsx`
 * (KSK-40, DONE·PACK 전용 요약 모양)와 같은 원칙이지만 액션마다 요약 항목이 달라(수량·검수 vs 박스 목록·
 * 송장) 여기서는 "무엇을 보냈는지" 줄 목록을 `rows` 로 받는 범용형으로 둔다. 1초 넘으면 "응답 대기 중"
 * (spec §13 화면 반영 1초 기준을 그대로 따른다).
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Spinner } from '../ui/admin/Spinner'

export type SendingScreenProps = {
  rows: Array<{ label: string; value: ReactNode }>
}

export function SendingScreen({ rows }: SendingScreenProps) {
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
          {rows.map((r, i) => (
            <div key={i} className="flex justify-between gap-4">
              <dt className="text-ink-muted">{r.label}</dt>
              <dd className="min-w-0 text-right">{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}

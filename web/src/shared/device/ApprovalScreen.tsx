/**
 * KSK-60 경고/승인 — 반장 PIN (screens-shopfloor §1 KSK-60). 온라인 전용(§13.2 ⑪) — `PinDialog` 의
 * `offline` prop 이 [승인]/[거부] 를 막는다. API 호출은 이 화면이 한다(다이얼로그는 순수 UI).
 *
 * `POST /scan/{event_uuid}/approve` 는 액션(DONE·PACK·RECEIVE·SHIP)과 무관하게 같은 모양이라
 * `kiosk/screens/ApprovalScreen.tsx` 에서 여기로 옮겨 PDA 의 승인 대기(WARN+requires_approval)도
 * 그대로 재사용한다.
 */
import { useState } from 'react'
import { scanApi } from '@/shared/api'
import { isApiError } from '@/shared/api/client'
import { lockedMessage } from '@/shared/api/errorCodes'
import { PinDialog } from '@/shared/ui/shopfloor'
import type { ScanResponse } from '@/shared/types'

export type ApprovalScreenProps = {
  message: string
  online: boolean
  eventUuid: string
  approvalToken: string | null
  onApproved: (response: ScanResponse) => void
  onDenied: (response: ScanResponse) => void
  onDefer: () => void
}

function effectTextFor(message: string): string {
  if (message.includes('미완료')) return '직전 공정 단계를 완료(추정)로 기록하고 이번 스캔을 반영합니다.'
  if (message.includes('허용오차') || message.includes('사유')) return '사유 없이 초과·미달된 수량을 승인합니다.'
  if (message.includes('라우팅') || message.includes('공정을 거치')) return '이 공정 단계를 라우팅에 삽입합니다.'
  return '승인하면 이 스캔이 반영됩니다.'
}

export function ApprovalScreen({ message, online, eventUuid, approvalToken, onApproved, onDenied, onDefer }: ApprovalScreenProps) {
  const [approverCard, setApproverCard] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function decide(decision: 'APPROVE' | 'DENY', pin: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await scanApi.approve(eventUuid, { approver_card: approverCard ?? undefined, pin, decision, note: note || undefined }, approvalToken)
      if (decision === 'APPROVE') onApproved(res)
      else onDenied(res)
    } catch (e) {
      if (isApiError(e) && e.status === 429) setError(lockedMessage('PIN_LOCKED', e.retryAfter))
      else if (isApiError(e)) setError(e.message)
      else setError('승인 처리에 실패했습니다')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg pt-6">
      <PinDialog
        open
        title="반장 승인 필요"
        description={`${message} — ${effectTextFor(message)}`}
        onSubmit={(pin) => void decide('APPROVE', pin)}
        onDeny={(pin) => void decide('DENY', pin)}
        onDefer={onDefer}
        onCancel={onDefer}
        approverCard={approverCard}
        onApproverScan={setApproverCard}
        noteEnabled
        note={note}
        onNoteChange={setNote}
        busy={busy}
        error={error}
        offline={!online}
      />
    </div>
  )
}

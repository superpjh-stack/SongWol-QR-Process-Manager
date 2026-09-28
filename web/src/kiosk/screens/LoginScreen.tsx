/**
 * KSK-01 작업자 로그인 (screens-shopfloor §0.3). 카드 스캔 우선, 카드 분실 시 ID+PIN.
 * 오프라인(네트워크 오류)이고 카드 스캔이면 「미검증 작업자」로 로컬 로그인을 허용한다(§0.3 기본값(제안)) —
 * 온라인 복귀 시 화면(KioskSession)이 `/auth/worker` 를 다시 불러 이름으로 교체한다.
 */
import { useState } from 'react'
import { authApi } from '@/shared/api'
import { isApiError } from '@/shared/api/client'
import { lockedMessage } from '@/shared/api/errorCodes'
import { useScannerInput } from '@/shared/hooks'
import { IdleScreen, NumPad, WarnBanner } from '@/shared/ui/shopfloor'
import type { LoginVia, UserSummary } from '@/shared/types'

export type LoginScreenProps = {
  processName: string
  stationId: string
  pendingWoCode: string | null
  onLoggedIn: (worker: UserSummary, loginVia: LoginVia) => void
  onWoScannedWhileLoggedOut: (code: string, check: string | null) => void
}

export function LoginScreen({ processName, stationId, pendingWoCode, onLoggedIn, onWoScannedWhileLoggedOut }: LoginScreenProps) {
  const [mode, setMode] = useState<'card' | 'idpin'>('card')
  const [loginId, setLoginId] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useScannerInput(
    (parsed) => {
      if (busy) return
      if (parsed.type === 'US') void loginByCard(parsed.code)
      else if (parsed.type === 'WO') onWoScannedWhileLoggedOut(parsed.code, parsed.check)
      // SO/LT/VB 는 로그인 화면에서 의미 없다 — 조용히 무시(§0.4 다른 화면과 달리 안내 토스트를 둘 곳이 없다)
    },
    { enabled: !busy },
  )

  async function loginByCard(cardCode: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await authApi.worker({ card_code: cardCode })
      onLoggedIn(res.worker, res.login_via)
    } catch (e) {
      if (isApiError(e) && e.status === 0) {
        // 오프라인 — 카드 형식만 확인하고 로컬 로그인 허용 (§0.3 기본값)
        onLoggedIn({ id: -1, login_id: '', name: `미검증 작업자 ${cardCode}`, role: 'WORKER', card_code: cardCode }, 'OFFLINE_CACHE')
        return
      }
      setError(messageFor(e))
    } finally {
      setBusy(false)
    }
  }

  async function loginByIdPin() {
    if (!loginId.trim() || pin.length < 4) return
    setBusy(true)
    setError(null)
    try {
      const res = await authApi.worker({ login_id: loginId.trim(), pin })
      onLoggedIn(res.worker, res.login_via)
    } catch (e) {
      setError(messageFor(e))
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <IdleScreen
      processName={processName}
      stationId={stationId}
      banner={
        error ? (
          <WarnBanner kind="error" message={error} onDismiss={() => setError(null)} />
        ) : pendingWoCode ? (
          <WarnBanner kind="warning" message={`스캔한 작업지시 ${pendingWoCode} 는 로그인 후 이어서 처리됩니다`} />
        ) : null
      }
      promptExtra={
        mode === 'card' ? (
          <div className="flex flex-col items-center gap-3">
            {busy ? <p className="text-sf-lg text-ink-muted">확인 중…</p> : null}
            <button type="button" className="text-sf-lg text-brand-700 underline" onClick={() => setMode('idpin')}>
              카드가 없어요 — ID·PIN 입력
            </button>
          </div>
        ) : (
          <div className="flex w-full flex-col items-center gap-4">
            <div className="flex w-full max-w-sm flex-col gap-3">
              <label className="flex flex-col gap-1 text-left text-sf-body">
                <span className="font-bold text-ink-muted">사용자 ID</span>
                <input
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  className="min-h-touch rounded-sf border-2 border-line-strong bg-surface px-4 text-sf-lg"
                  autoFocus
                />
              </label>
              <NumPad
                label="PIN"
                masked
                value={pin}
                onChange={setPin}
                onConfirm={() => void loginByIdPin()}
                maxLength={6}
                confirmLabel={busy ? '확인 중…' : '로그인'}
                confirmDisabled={!loginId.trim() || pin.length < 4 || busy}
              />
            </div>
            <button type="button" className="text-sf-lg text-brand-700 underline" onClick={() => setMode('card')}>
              카드로 스캔하기
            </button>
          </div>
        )
      }
    />
  )
}

function messageFor(e: unknown): string {
  if (isApiError(e) && e.status === 429) return lockedMessage('PIN_LOCKED', e.retryAfter)
  if (isApiError(e)) return e.message
  return '로그인에 실패했습니다'
}

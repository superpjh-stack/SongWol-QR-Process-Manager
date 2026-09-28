/**
 * 반장 PIN 다이얼로그 (E1 승인 · E6 취소 · 예외 승인, KSK-60). 4~6자리(api-contract §13.2 ⑩), NumPad(masked) 재사용.
 * 열려 있는 동안 화면(대기·스캔 상태)은 useScannerInput 을 `enabled:false` 로 끄는 것을 권장한다 — 대신 이
 * 다이얼로그 자신이 열려 있는 동안 `US` 스캔만 구독해 승인자 카드를 자동으로 채운다(§4.1).
 * 승인은 온라인 전용(api-contract §13.2 ⑪) — `offline` 이면 승인·거부를 막고 사유를 보여준다.
 * 검증·API 호출은 화면이 한다. 실패 시 `error` 로 문구를 넘기면 값이 지워지고 다시 입력받는다.
 *
 * DEF-QA2-S2-001: 이 다이얼로그는 NumPad 와 useScannerInput(승인자 카드용)을 같은 화면에 동시에 마운트하는
 * 유일한 곳이다. NumPad 의 물리 키보드 지원(기본 켜짐)을 켜 두면 카드 스캔의 숫자 문자가 PIN 입력으로 새고,
 * 드물게는 스캔의 마지막 Enter 가 NumPad 의 confirm() 까지 트리거해 오염된 PIN 으로 조기 제출된다. PIN 입력은
 * 터치 키패드로만 받도록 NumPad 의 `keyboard={false}` 로 물리 키보드 캡처를 꺼서 두 리스너를 분리한다.
 * 또한 승인 요청이 진행 중(`busy`)인 동안은 카드 스캔을 `hold` 로 보류했다가 끝난 뒤 반영한다.
 */
import { useEffect, useState } from 'react'
import { useScannerInput } from '../../hooks/useScannerInput'
import { cn } from '../cn'
import { IconKey, IconUser, IconX } from '../icons'
import { NumPad } from './NumPad'

export type PinDialogProps = {
  open: boolean
  title?: string
  description?: string
  /** [승인] — PIN 을 확정하면 호출 */
  onSubmit: (pin: string) => void
  /** 다이얼로그 닫기(우상단 X). 서버 호출 없음 */
  onCancel: () => void
  /** [거부] — 제공하면 버튼이 보인다 (decision:"DENY") */
  onDeny?: (pin: string) => void
  /** [나중에] — 제공하면 버튼이 보인다. PIN 없이 닫고 서버에는 PENDING 으로 남긴다 */
  onDefer?: () => void
  minLength?: number
  maxLength?: number
  error?: string | null
  /** 서버 확인 중 */
  busy?: boolean
  /** 승인자 카드 자동 채움 표시값(제어하고 싶을 때). 생략하면 다이얼로그가 내부 스캔으로만 채운다 */
  approverCard?: string | null
  onApproverScan?: (cardCode: string) => void
  /** 사유 메모 입력 슬롯 (선택, note → variance_reason) */
  noteEnabled?: boolean
  note?: string
  onNoteChange?: (note: string) => void
  noteMaxLength?: number
  /** 오프라인이면 승인 자체를 막는다 — 이 요청은 승인 대기 목록에 남는다 */
  offline?: boolean
}

export function PinDialog({
  open,
  title = '반장 PIN 입력',
  description,
  onSubmit,
  onCancel,
  onDeny,
  onDefer,
  minLength = 4,
  maxLength = 6,
  error,
  busy,
  approverCard,
  onApproverScan,
  noteEnabled,
  note = '',
  onNoteChange,
  noteMaxLength = 200,
  offline,
}: PinDialogProps) {
  const [pin, setPin] = useState('')
  const [scannedCard, setScannedCard] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setPin('')
      setScannedCard(null)
    }
  }, [open])
  useEffect(() => {
    if (error) setPin('')
  }, [error])

  // 승인자 카드(US-NNNN) 자동 채움. 다이얼로그가 열려 있을 때만 구독한다.
  // 승인 요청이 진행 중(busy)이면 스캔을 보류(hold)했다가 끝난 뒤 마지막 1건만 반영한다.
  useScannerInput(
    (parsed) => {
      if (parsed.type === 'US') {
        setScannedCard(parsed.code)
        onApproverScan?.(parsed.code)
      }
    },
    { enabled: open, hold: Boolean(busy) },
  )

  if (!open) return null

  const card = approverCard ?? scannedCard
  const canAct = !offline && !busy && pin.length >= minLength

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/60 p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pin-dialog-title"
      data-component="PinDialog"
    >
      <div className="flex w-full max-w-[520px] flex-col gap-4 rounded-sf bg-surface p-6 shadow-modal">
        <header className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <IconKey size={32} className="text-status-warn-fg" />
            <h2 id="pin-dialog-title" className="text-sf-xl font-bold">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="취소"
            className="flex h-touch-min w-touch-min items-center justify-center rounded-sf border-2 border-line"
          >
            <IconX size={28} />
          </button>
        </header>
        {description ? <p className="text-sf-body text-ink-muted">{description}</p> : null}

        <div className="flex items-center gap-2 rounded-sf border-2 border-line bg-surface-2 px-4 py-2 text-sf-body">
          <IconUser size={22} className="shrink-0 text-ink-muted" />
          {card ? (
            <span className="font-mono font-bold">승인자: {card}</span>
          ) : (
            <span className="text-ink-muted">승인자 카드를 스캔하세요 (선택)</span>
          )}
        </div>

        {offline ? (
          <p className="rounded-sf border-2 border-status-warn-line bg-status-warn-bg px-4 py-3 text-sf-body font-bold text-status-warn-fg" role="status">
            온라인 복구 후 승인할 수 있습니다 — 이 요청은 승인 대기 목록에 남습니다
          </p>
        ) : (
          <p className={cn('min-h-[28px] text-sf-body font-semibold', error ? 'text-status-error-fg' : 'text-ink-muted')} role="alert">
            {error ?? `${minLength}~${maxLength}자리`}
          </p>
        )}

        <NumPad
          value={pin}
          onChange={setPin}
          onConfirm={onSubmit}
          masked
          maxLength={maxLength}
          keyboard={false}
          confirmLabel={busy ? '확인 중…' : '승인'}
          confirmDisabled={!canAct}
          className="mx-auto"
        />

        {noteEnabled ? (
          <label className="flex flex-col gap-1 text-sf-body">
            <span className="font-bold text-ink-muted">사유 메모 (선택)</span>
            <textarea
              value={note}
              onChange={(e) => onNoteChange?.(e.target.value.slice(0, noteMaxLength))}
              maxLength={noteMaxLength}
              rows={2}
              className="w-full rounded-sf border-2 border-line-strong bg-surface p-3 text-sf-body"
            />
          </label>
        ) : null}

        {onDeny || onDefer ? (
          <div className="flex flex-wrap gap-touch-gap">
            {onDeny ? (
              <button
                type="button"
                disabled={!canAct}
                onClick={() => onDeny(pin)}
                className="min-h-touch flex-1 rounded-sf border-2 border-status-error-line bg-status-error-bg px-6 text-sf-lg font-bold text-status-error-fg disabled:cursor-not-allowed disabled:opacity-50"
              >
                거부
              </button>
            ) : null}
            {onDefer ? (
              <button
                type="button"
                onClick={onDefer}
                className="min-h-touch flex-1 rounded-sf border-2 border-line-strong bg-surface px-6 text-sf-lg font-bold text-ink"
              >
                나중에
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * 검수결과 3버튼 선택 (screens-shopfloor §4.2 A3). PDA-12 입고 입력의 「검수결과 — 합격 PASS / 조건부 COND /
 * 불합격 FAIL」. 색만으로 구분하지 않는다(§0.9) — 색+아이콘+문구는 StatusBadge 와 같은 `INSPECTION_STATUS`
 * 매핑(shared/ui/status.ts)을 그대로 재사용한다(라벨·아이콘·톤을 여기서 새로 짓지 않는다).
 *
 * **기본 선택 없음** (spec §2.2 「반드시 누른다」) — `value` 는 `Inspection | null` 로 완전 제어되고,
 * 이 컴포넌트가 마운트 시 무언가를 자동으로 골라주는 로직은 없다(EquipmentPicker 의 자동 선택과 다른 점).
 */
import { cn } from '../cn'
import { INSPECTION_STATUS, TONE_CLASS } from '../status'
import type { Inspection } from '../../types'

export type TriChoiceProps = {
  /** null = 아직 선택 안 함(기본값이자 초기 상태) */
  value: Inspection | null
  onChange: (value: Inspection) => void
  label?: string
  /** 선택 안 했을 때 아래 보여줄 안내. false 면 안내를 숨긴다 */
  hint?: string | false
  className?: string
}

const ORDER: Inspection[] = ['PASS', 'COND', 'FAIL']

export function TriChoice({ value, onChange, label = '검수결과', hint = '검수결과를 선택하세요', className }: TriChoiceProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)} data-component="TriChoice">
      {label ? <div className="text-sf-body font-bold text-ink-muted">{label}</div> : null}

      <div className="grid grid-cols-3 gap-touch-gap" role="radiogroup" aria-label={label}>
        {ORDER.map((code) => {
          const meta = INSPECTION_STATUS[code]
          const selected = value === code
          return (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(code)}
              className={cn(
                'flex min-h-touch touch-manipulation flex-col items-center justify-center gap-1 rounded-sf border-2 px-3 py-3',
                'font-bold active:scale-[0.98]',
                selected
                  ? cn(TONE_SOLID[meta.tone], 'border-transparent')
                  : cn('border-2 active:brightness-95', TONE_CLASS[meta.tone]),
              )}
            >
              <meta.Icon size={28} />
              <span className="text-sf-lg">{meta.label}</span>
            </button>
          )
        })}
      </div>

      {value === null && hint ? (
        <span className="text-sf-body font-semibold text-status-warn-fg" role="alert">
          {hint}
        </span>
      ) : null}
    </div>
  )
}

/**
 * 선택된 버튼은 배지보다 진하게 — 같은 톤의 -fg 색을 배경으로 채운다(BigButton danger variant 와 같은 방식:
 * status-*-fg 는 흰 글씨 대비가 나오도록 만들어진 진한 색, tokens.css 참고).
 */
const TONE_SOLID: Record<string, string> = {
  done: 'bg-status-done-fg text-white',
  partial: 'bg-status-partial-fg text-white',
  error: 'bg-status-error-fg text-white',
}

/** 화면이 [입고 확정] 버튼의 disabled 조건에 그대로 쓰는 검증 함수 — 선택했는지만 본다 */
export function isTriChoiceSelected(value: Inspection | null): value is Inspection {
  return value !== null
}

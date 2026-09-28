/**
 * 설비 선택 (KSK-20 P30 전용, screens-shopfloor §4.2 A1). `equip_type` 그룹으로 칩(≥64px) 나열,
 * 단일 선택, 마지막 선택을 단말 로컬(`rememberKey` = print_method 코드별)에 기억, 1개면 자동 선택,
 * 0개면 「설비가 등록되지 않았습니다」 안내.
 */
import { useEffect, useMemo, useRef } from 'react'
import { cn } from '../cn'
import { EquipTypeLabel } from '../../labels'
import type { EquipType } from '../../types'

export type EquipmentOption = { code: string; name: string; equipType: EquipType }

export type EquipmentPickerProps = {
  options: EquipmentOption[]
  /** 선택된 설비 code. 아직 없으면 null */
  value: string | null
  onChange: (code: string) => void
  /** 마지막 선택 기억 키(보통 print_method 코드). 없으면 기억하지 않는다 */
  rememberKey?: string | null
  emptyText?: string
  className?: string
}

const REMEMBER_PREFIX = 'sw.equip.last.'

/** 마지막 선택 읽기 — 화면이 초기 선택을 미리 계산하고 싶을 때도 쓸 수 있게 export 한다 */
export function readRememberedEquipment(rememberKey: string): string | null {
  try {
    return localStorage.getItem(REMEMBER_PREFIX + rememberKey)
  } catch {
    return null
  }
}

function rememberEquipment(rememberKey: string, code: string): void {
  try {
    localStorage.setItem(REMEMBER_PREFIX + rememberKey, code)
  } catch {
    // 저장 실패(사생활 보호 모드 등)는 단순 UX 편의 기능이라 조용히 넘긴다 — 선택 자체는 그대로 반영된다
  }
}

export function EquipmentPicker({
  options,
  value,
  onChange,
  rememberKey,
  emptyText = '이 가공방식에 맞는 설비가 등록되지 않았습니다 — 관리자 문의',
  className,
}: EquipmentPickerProps) {
  const groups = useMemo(() => {
    const map = new Map<EquipType, EquipmentOption[]>()
    for (const o of options) {
      const arr = map.get(o.equipType) ?? []
      arr.push(o)
      map.set(o.equipType, arr)
    }
    return [...map.entries()]
  }, [options])

  // 자동 선택: 옵션 1개면 그 값, 아니면 print_method 별 마지막 선택. 같은 code 를 두 번 쏘지 않게 ref 로 막는다.
  const autoAppliedRef = useRef<string | null>(null)
  useEffect(() => {
    if (value) return
    if (options.length === 1) {
      const only = options[0]!.code
      if (autoAppliedRef.current !== only) {
        autoAppliedRef.current = only
        onChange(only)
      }
      return
    }
    if (rememberKey) {
      const remembered = readRememberedEquipment(rememberKey)
      if (remembered && autoAppliedRef.current !== remembered && options.some((o) => o.code === remembered)) {
        autoAppliedRef.current = remembered
        onChange(remembered)
      }
    }
  }, [options, value, rememberKey, onChange])

  const select = (code: string) => {
    onChange(code)
    if (rememberKey) rememberEquipment(rememberKey, code)
  }

  if (options.length === 0) {
    return (
      <div
        role="status"
        className={cn('rounded-sf border-2 border-dashed border-status-warn-line bg-status-warn-bg p-5 text-sf-lg font-semibold text-status-warn-fg', className)}
        data-component="EquipmentPicker"
      >
        {emptyText}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-4', className)} data-component="EquipmentPicker">
      {groups.map(([type, opts]) => (
        <div key={type} className="flex flex-col gap-2">
          <div className="text-sf-body font-bold text-ink-muted">{EquipTypeLabel[type]}</div>
          <div className="flex flex-wrap gap-touch-gap" role="group" aria-label={`${EquipTypeLabel[type]} 설비 선택`}>
            {opts.map((o) => {
              const selected = o.code === value
              return (
                <button
                  key={o.code}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => select(o.code)}
                  className={cn(
                    'min-h-touch touch-manipulation rounded-sf border-2 px-6 text-sf-lg font-bold active:scale-[0.98]',
                    selected ? 'border-brand-700 bg-brand-600 text-white' : 'border-line-strong bg-surface text-ink active:bg-surface-3',
                  )}
                >
                  {o.name}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

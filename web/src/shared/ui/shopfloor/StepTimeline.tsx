/**
 * 공정 라우팅 가로 타임라인 (screens-shopfloor §4.2 A2). KSK-20 에서 P20→P30→P50→P60 을 보여주고
 * 현재 단말 공정을 강조한다. KSK-80·PDA-12(S3)도 재사용할 수 있게 범용으로 만들었다.
 * `works[]` 는 [S6] 인쇄+자수 설비별 진행 하위 표시 자리 — 파일럿은 항상 빈 배열이며, 비어 있어도
 * 깨지지 않아야 한다(그냥 하위 목록을 그리지 않는다).
 */
import { cn } from '../cn'
import { IconChevronRight } from '../icons'
import { StatusBadge } from '../StatusBadge'
import type { StepStatus } from '../status'

export type StepTimelineWork = {
  equipmentName: string
  startedAt?: string | null
  doneAt?: string | null
}

export type StepTimelineStep = {
  processCode: string
  processName: string
  status: StepStatus
  /** spec §4.4 "인쇄 중 (자수 대기)" 같은 문구 대체 */
  labelOverride?: string | undefined
  /** [S6] 설비별 진행. 파일럿은 항상 [] — 없어도(undefined) 동작한다 */
  works?: StepTimelineWork[]
}

export type StepTimelineProps = {
  steps: StepTimelineStep[]
  /** 이 단말의 공정 코드 — 해당 단계를 강조 표시 */
  currentProcessCode?: string
  className?: string
}

function fmtTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date(iso))
  } catch {
    return iso
  }
}

export function StepTimeline({ steps, currentProcessCode, className }: StepTimelineProps) {
  if (steps.length === 0) {
    return (
      <div className={cn('rounded-sf border-2 border-dashed border-line p-4 text-sf-body text-ink-muted', className)} data-component="StepTimeline">
        공정 라우팅 정보 없음
      </div>
    )
  }

  return (
    <ol className={cn('flex flex-wrap items-stretch gap-2', className)} data-component="StepTimeline">
      {steps.map((s, i) => {
        const current = s.processCode === currentProcessCode
        const works = s.works ?? []
        return (
          <li key={s.processCode} className="flex items-center gap-2">
            <div
              className={cn(
                'flex min-h-touch flex-col justify-center gap-1 rounded-sf border-2 px-4 py-2',
                current ? 'border-brand-600 bg-brand-50' : 'border-line bg-surface',
              )}
              data-current={current || undefined}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('text-sf-body font-bold', current && 'text-brand-700')}>{s.processName}</span>
                <StatusBadge kind="step" status={s.status} density="shopfloor" labelOverride={s.labelOverride} />
              </div>
              {works.length > 0 ? (
                <ul className="flex flex-col text-sf-body text-ink-muted">
                  {works.map((w, wi) => (
                    <li key={wi}>
                      {w.equipmentName} {w.doneAt ? `완료 ${fmtTime(w.doneAt)}` : w.startedAt ? '진행 중' : '대기'}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {i < steps.length - 1 ? <IconChevronRight size={22} className="shrink-0 text-ink-faint" aria-hidden="true" /> : null}
          </li>
        )
      })}
    </ol>
  )
}

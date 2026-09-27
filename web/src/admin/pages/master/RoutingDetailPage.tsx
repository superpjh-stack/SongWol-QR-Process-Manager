/** ADM-06 라우팅 상세 — 헤더 읽기 전용(item_group·print_method 불변, admin #10) + 단계 통째 교체 PUT /routings/{id}/steps */
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button, PageHeader, useToast } from '@/shared/ui/admin'
import { useApiMutation, useArray, useAuth, useOne } from '@/shared/hooks'
import { routingsApi } from '@/shared/api'
import type { PrintMethod, Process, Routing, RoutingStepInput } from '@/shared/types'
import { formatQty } from '../../format'
import { canWrite } from '../../permissions'
import { ActiveBadge, ApiErrorAlert, CodeText, QueryState, ToggleActiveDialog } from '../../components'
import { RoutingStepsEditor } from './RoutingStepsEditor'
import { defaultRows, leadSum, rowsFrom, stepsText, validateRows, type StepErrors, type StepRow } from './routingSteps'

function StepsSection({ routing, processes, printMethod, write, onSaved }: { routing: Routing; processes: Process[]; printMethod: PrintMethod | undefined; write: boolean; onSaved: () => void }) {
  const toast = useToast()
  const [rows, setRows] = useState<StepRow[]>(() => rowsFrom([...routing.steps].sort((a, b) => a.seq - b.seq)))
  const [errors, setErrors] = useState<StepErrors>({})
  const [dirty, setDirty] = useState(false)
  const save = useApiMutation((steps: RoutingStepInput[]) => routingsApi.replaceSteps(routing.id, steps), [['res', 'routings']])
  useEffect(() => {
    setRows(rowsFrom([...routing.steps].sort((a, b) => a.seq - b.seq)))
    setDirty(false)
    setErrors({})
  }, [routing])
  const change = (r: StepRow[]) => {
    setRows(r)
    setDirty(true)
  }
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-ad-lg font-semibold">단계</h2>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={!dirty || save.loading} onClick={() => change(rowsFrom([...routing.steps].sort((a, b) => a.seq - b.seq)))}>
            되돌리기
          </Button>
          <Button
            variant="primary"
            disabled={!write || !dirty}
            loading={save.loading}
            onClick={async () => {
              const v = validateRows(rows)
              setErrors(v.errors)
              if (!v.ok) return
              try {
                await save.mutate(v.steps)
                toast.success('저장되었습니다')
                setDirty(false)
                onSaved()
              } catch {
                /* save.error 로 표시 */
              }
            }}
          >
            단계 저장
          </Button>
        </div>
      </div>
      {save.error ? <ApiErrorAlert error={save.error} /> : null}
      <p className="text-ad-xs text-ink-muted">발행된 WO 의 라우팅 스냅샷은 바뀌지 않습니다 (spec §4.1). 저장은 단계 전체를 교체합니다.</p>
      <RoutingStepsEditor rows={rows} onChange={change} processes={processes} errors={errors} disabled={!write || save.loading} onFillDefault={() => change(defaultRows(printMethod))} />
    </section>
  )
}

export function RoutingDetailPage() {
  const { id: idParam } = useParams<{ id: string }>()
  const id = Number(idParam)
  const { role } = useAuth()
  const write = canWrite(role, 'master.routings')
  const routing = useOne<Routing>('routings', Number.isFinite(id) ? id : null)
  const processes = useArray<Process>('processes')
  const printMethods = useArray<PrintMethod>('print-methods')
  const [toggling, setToggling] = useState<Routing | null>(null)

  return (
    <QueryState state={routing}>
      {(r) => {
        const pm = (printMethods.data ?? []).find((p) => p.code === r.print_method)
        return (
          <>
            <PageHeader
              title={`${r.item_group} × ${r.print_method}${pm ? ` ${pm.name}` : ''}`}
              breadcrumb={
                <>
                  기준정보 › <Link className="underline" to="/admin/master/routings">라우팅</Link> › 상세 (ADM-06)
                </>
              }
              description={`${stepsText(r)} · 표준 리드타임 합 ${formatQty(leadSum(r), 1)}h`}
              actions={
                <>
                  <ActiveBadge active={r.active} />
                  <Button variant={r.active ? 'danger' : 'secondary'} disabled={!write} onClick={() => setToggling(r)}>
                    {r.active ? '비활성' : '재활성'}
                  </Button>
                </>
              }
            />
            <dl className="mb-6 grid grid-cols-2 gap-4 rounded-ad border border-line bg-surface p-4 md:grid-cols-4">
              <div>
                <dt className="text-ad-xs text-ink-muted">품목군</dt>
                <dd className="font-mono">{r.item_group}</dd>
              </div>
              <div>
                <dt className="text-ad-xs text-ink-muted">가공방식</dt>
                <dd>
                  <CodeText code={r.print_method} /> {pm?.name ?? ''}
                </dd>
              </div>
              <div className="md:col-span-2">
                <dt className="text-ad-xs text-ink-muted">헤더 변경</dt>
                <dd className="text-ink-muted">품목군·가공방식은 바꿀 수 없습니다 — 비활성 후 새 라우팅으로 등록 (admin #10)</dd>
              </div>
            </dl>
            {processes.error ? <ApiErrorAlert error={processes.error} onRetry={() => void processes.refetch()} className="mb-3" /> : null}
            <StepsSection routing={r} processes={processes.data ?? []} printMethod={pm} write={write} onSaved={() => void routing.refetch()} />
            <ToggleActiveDialog<Routing>
              resource="routings"
              entityLabel="라우팅"
              target={toggling}
              idOf={(x) => x.id}
              describe={(x) => (
                <>
                  {x.item_group} × <CodeText code={x.print_method} />
                </>
              )}
              onClose={() => setToggling(null)}
              onDone={() => void routing.refetch()}
            />
          </>
        )
      }}
    </QueryState>
  )
}

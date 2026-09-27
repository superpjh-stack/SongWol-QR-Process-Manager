/** ADM-06 라우팅 — 목록·등록(헤더+단계)·비활성·재활성 · 라우팅 조회 도구(resolve) · 누락 매트릭스 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, DataTable, Input, Modal, PageHeader, Select, useToast, type Column } from '@/shared/ui/admin'
import { useApiMutation, useArray, useAuth, useCreate, useList } from '@/shared/hooks'
import { ApiError, routingsApi } from '@/shared/api'
import type { ItemGroup, PrintMethod, PrintMethodCode, Process, Routing, RoutingCreate } from '@/shared/types'
import { formatQty } from '../../format'
import { canWrite } from '../../permissions'
import { ActiveBadge, ApiErrorAlert, CodeText, ListToolbar, RowActions, ToggleActiveDialog, serverTable, useListParams } from '../../components'
import { RoutingStepsEditor } from './RoutingStepsEditor'
import { defaultRows, leadSum, stepsText, validateRows, type StepErrors, type StepRow } from './routingSteps'

function RoutingCreateModal({ open, groups, printMethods, processes, onClose, onSaved }: { open: boolean; groups: ItemGroup[]; printMethods: PrintMethod[]; processes: Process[]; onClose: () => void; onSaved: (r: Routing) => void }) {
  const create = useCreate<Routing, RoutingCreate>('routings')
  const [itemGroup, setItemGroup] = useState('')
  const [pm, setPm] = useState('')
  const [rows, setRows] = useState<StepRow[]>([])
  const [errors, setErrors] = useState<StepErrors>({})
  const [headErr, setHeadErr] = useState<{ item_group?: string; print_method?: string; steps?: string }>({})
  const [topError, setTopError] = useState<unknown>(null)
  const resetCreate = create.reset
  useEffect(() => {
    if (open) {
      setItemGroup('')
      setPm('')
      setRows([])
      setErrors({})
      setHeadErr({})
      setTopError(null)
      resetCreate()
    }
  }, [open, resetCreate])
  const selectedPm = printMethods.find((p) => p.code === pm)
  const submit = async () => {
    const he: typeof headErr = {}
    if (!itemGroup.trim()) he.item_group = '품목군을 입력하세요'
    else if (itemGroup.length > 30) he.item_group = '30자 이하'
    if (!pm) he.print_method = '가공방식을 선택하세요'
    const v = validateRows(rows)
    if (rows.length === 0) he.steps = '단계를 1행 이상 넣으세요'
    setHeadErr(he)
    setErrors(v.errors)
    if (Object.keys(he).length || !v.ok) return
    setTopError(null)
    try {
      const saved = await create.mutate({ item_group: itemGroup.trim(), print_method: pm as PrintMethodCode, steps: v.steps })
      onSaved(saved)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setHeadErr({ item_group: e.message })
      setTopError(e)
    }
  }
  return (
    <Modal
      open={open}
      title="라우팅 등록"
      onClose={onClose}
      size="lg"
      dismissible={!create.loading}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={create.loading}>
            취소
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={create.loading}>
            저장
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {topError ? <ApiErrorAlert error={topError} /> : null}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input label="품목군" required maxLength={30} list="routing-item-groups" value={itemGroup} onChange={(e) => setItemGroup(e.target.value)} hint="UK(item_group, print_method) — 중복이면 409" error={headErr.item_group} />
          <datalist id="routing-item-groups">
            {groups.map((g) => (
              <option key={g.code} value={g.code}>
                {g.name}
              </option>
            ))}
          </datalist>
          <Select
            label="가공방식"
            required
            value={pm}
            onChange={(e) => setPm(e.target.value)}
            options={printMethods.filter((p) => p.active).map((p) => ({ value: p.code, label: `${p.code} ${p.name}${p.skips_p30 ? ' (P30 생략)' : ''}` }))}
            placeholder="선택"
            error={headErr.print_method}
          />
        </div>
        {headErr.steps ? <p className="text-ad-xs text-status-error-fg">{headErr.steps}</p> : null}
        <RoutingStepsEditor rows={rows} onChange={setRows} processes={processes} errors={errors} disabled={create.loading} onFillDefault={() => setRows(defaultRows(selectedPm))} />
      </div>
    </Modal>
  )
}

function ResolveTool({ groups, printMethods }: { groups: ItemGroup[]; printMethods: PrintMethod[] }) {
  const navigate = useNavigate()
  const [g, setG] = useState('')
  const [pm, setPm] = useState('')
  const resolve = useApiMutation(({ g, pm }: { g: string; pm: string }) => routingsApi.resolve(g, pm))
  const [result, setResult] = useState<Routing | null>(null)
  return (
    <div className="mb-4 rounded-ad border border-line bg-surface p-3">
      <div className="mb-2 text-ad-xs font-semibold text-ink-muted">라우팅 조회 (GET /routings/resolve) — WO 발행 전 확인용</div>
      <div className="flex flex-wrap items-end gap-2">
        <Input label="품목군" list="routing-item-groups-2" value={g} onChange={(e) => setG(e.target.value)} wrapperClassName="w-44" />
        <datalist id="routing-item-groups-2">
          {groups.map((x) => (
            <option key={x.code} value={x.code} />
          ))}
        </datalist>
        <Select label="가공방식" value={pm} onChange={(e) => setPm(e.target.value)} options={printMethods.map((p) => ({ value: p.code, label: `${p.code} ${p.name}` }))} placeholder="선택" wrapperClassName="w-44" />
        <Button
          variant="secondary"
          loading={resolve.loading}
          disabled={!g || !pm}
          onClick={async () => {
            setResult(null)
            try {
              setResult(await resolve.mutate({ g, pm }))
            } catch {
              /* resolve.error 로 표시 */
            }
          }}
        >
          조회
        </Button>
        {result ? (
          <span className="self-center">
            ✓ {stepsText(result)} · 리드타임 합 {formatQty(leadSum(result), 1)}h ·{' '}
            <button type="button" className="underline" onClick={() => navigate(`/admin/master/routings/${result.id}`)}>
              상세
            </button>
          </span>
        ) : null}
      </div>
      {resolve.error ? <ApiErrorAlert error={resolve.error.status === 404 ? new ApiError(404, resolve.error.code, '해당 조합의 라우팅이 없습니다') : resolve.error} className="mt-2" /> : null}
    </div>
  )
}

export function RoutingsPage() {
  const { role } = useAuth()
  const write = canWrite(role, 'master.routings')
  const navigate = useNavigate()
  const toast = useToast()
  const params = useListParams({ defaultSort: 'item_group' })
  const list = useList<Routing>('routings', { ...params.query, q: undefined })
  const groups = useArray<ItemGroup>('item-groups')
  const printMethods = useArray<PrintMethod>('print-methods')
  const processes = useArray<Process>('processes')
  const pmName = useMemo(() => new Map((printMethods.data ?? []).map((p) => [p.code, p.name])), [printMethods.data])
  const [formOpen, setFormOpen] = useState(false)
  const [toggling, setToggling] = useState<Routing | null>(null)
  const [showMatrix, setShowMatrix] = useState(false)

  const columns: Column<Routing>[] = [
    { key: 'item_group', header: '품목군', sortable: true, render: (r) => <span className={r.active ? '' : 'text-ink-faint'}>{r.item_group}</span> },
    { key: 'print_method', header: '가공방식', sortable: true, render: (r) => `${r.print_method}${pmName.get(r.print_method) ? ` ${pmName.get(r.print_method)}` : ''}` },
    { key: 'steps', header: '공정 순서', render: (r) => <span className="font-mono">{stepsText(r)}</span> },
    { key: '_lead', header: '표준 리드타임 합(h) ※', align: 'right', render: (r) => <span className="tabular-nums">{formatQty(leadSum(r), 1)}</span> },
    { key: 'active', header: '활성', render: (r) => <ActiveBadge active={r.active} /> },
    {
      key: '_actions',
      header: '',
      render: (r) =>
        write ? (
          <RowActions>
            <Button size="sm" variant={r.active ? 'danger' : 'secondary'} onClick={() => setToggling(r)}>
              {r.active ? '비활성' : '재활성'}
            </Button>
          </RowActions>
        ) : null,
    },
  ]

  // 누락 매트릭스: 활성 품목군 × 활성 가공방식 (클라이언트 조합, 전용 API 없음)
  const matrix = useMemo(() => {
    const gs = (groups.data ?? []).filter((g) => g.active)
    const pms = (printMethods.data ?? []).filter((p) => p.active)
    const have = new Set((list.data?.items ?? []).filter((r) => r.active).map((r) => `${r.item_group}|${r.print_method}`))
    return { gs, pms, have }
  }, [groups.data, printMethods.data, list.data])

  return (
    <>
      <PageHeader
        title="라우팅"
        breadcrumb="기준정보 › 라우팅 (ADM-06)"
        description="품목군 × 가공방식 → 공정 순서(기본 P20→P30→P50→P60, 무가공은 P30 생략) + 단계별 표준 리드타임(h)·허용오차(%)"
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowMatrix((v) => !v)}>
              {showMatrix ? '누락 매트릭스 닫기' : '누락 매트릭스'}
            </Button>
            <Button variant="primary" disabled={!write} onClick={() => setFormOpen(true)}>
              등록
            </Button>
          </>
        }
      />
      <ResolveTool groups={groups.data ?? []} printMethods={printMethods.data ?? []} />
      {showMatrix ? (
        <div className="mb-4 overflow-auto rounded-ad border border-line bg-surface p-3">
          <div className="mb-2 text-ad-xs font-semibold text-ink-muted">누락 매트릭스 — 현재 페이지의 활성 라우팅 기준 (M0 완료 기준: 가공방식별 100% 등록)</div>
          <table className="text-ad-body">
            <thead>
              <tr>
                <th className="px-2 py-1 text-left">품목군 \ 가공방식</th>
                {matrix.pms.map((p) => (
                  <th key={p.code} className="px-2 py-1 font-mono">
                    {p.code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.gs.map((g) => (
                <tr key={g.code} className="border-t border-line">
                  <td className="px-2 py-1 font-mono">{g.code}</td>
                  {matrix.pms.map((p) => (
                    <td key={p.code} className="px-2 py-1 text-center">
                      {matrix.have.has(`${g.code}|${p.code}`) ? <span className="text-status-done-fg">✓</span> : <span className="text-ink-faint">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
              {matrix.gs.length === 0 ? (
                <tr>
                  <td colSpan={matrix.pms.length + 1} className="px-2 py-3 text-ink-muted">
                    활성 품목군이 없습니다 (미결 U-1)
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
      <ListToolbar params={params} withQ={false} />
      <DataTable<Routing>
        columns={columns}
        rows={list.data?.items ?? []}
        rowKey={(r) => r.id}
        loading={list.loading}
        error={list.error ? <ApiErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : undefined}
        emptyText="조회 조건에 해당하는 데이터가 없습니다"
        emptyAction={
          <Button variant="secondary" onClick={params.reset}>
            필터 초기화
          </Button>
        }
        onRowClick={(r) => navigate(`/admin/master/routings/${r.id}`)}
        {...serverTable(params, list.data)}
      />
      <RoutingCreateModal
        open={formOpen}
        groups={groups.data ?? []}
        printMethods={printMethods.data ?? []}
        processes={processes.data ?? []}
        onClose={() => setFormOpen(false)}
        onSaved={(r) => {
          setFormOpen(false)
          toast.success('저장되었습니다')
          void list.refetch()
          navigate(`/admin/master/routings/${r.id}`)
        }}
      />
      <ToggleActiveDialog<Routing>
        resource="routings"
        entityLabel="라우팅"
        target={toggling}
        idOf={(r) => r.id}
        describe={(r) => (
          <>
            {r.item_group} × <CodeText code={r.print_method} />
          </>
        )}
        onClose={() => setToggling(null)}
        onDone={() => void list.refetch()}
      />
    </>
  )
}

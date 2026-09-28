/**
 * ADM-25 실적 집계 (B5-04) — [S4-4]
 * `GET /reports/output?from&to&group=day|week|month&process_code&equipment_id&worker_id&format=json|xlsx` → OutputReport.
 * 전 역할 R. 필터: from/to(기본 이번 주 — 정의 없음), group 라디오, process_code, equipment_id, worker_id.
 * 차트는 계약·spec 에 정의 없음 → 표만 (screens-admin §9.1 「차트는 [확장] 검토」).
 */
import { useSearchParams } from 'react-router-dom'
import { Button, DataTable, DateInput, PageHeader, Select, StatCard, type Column } from '@/shared/ui/admin'
import { useApiMutation, useApiQuery, useArray, useList } from '@/shared/hooks'
import { reportsApi } from '@/shared/api'
import type { Equipment, OutputReportRow, Process, User } from '@/shared/types'
import { EquipTypeLabel } from '@/shared/labels'
import { formatQty, todayIso } from '../../format'
import { ApiErrorAlert, RadioGroup } from '../../components'
import { badRate, thisWeekMonday } from './outputReport'

type Group = 'day' | 'week' | 'month'

export function OutputReportPage() {
  const [sp, setSp] = useSearchParams()
  const from = sp.get('from') || thisWeekMonday()
  const to = sp.get('to') || todayIso()
  const group = (sp.get('group') as Group | null) ?? 'day'
  const processCode = sp.get('process_code') ?? ''
  const equipmentId = sp.get('equipment_id') ?? ''
  const workerId = sp.get('worker_id') ?? ''

  const patch = (changes: Record<string, string | null>) =>
    setSp((prev) => {
      const n = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(changes)) {
        if (v === null || v === '') n.delete(k)
        else n.set(k, v)
      }
      return n
    }, { replace: true })

  const processes = useArray<Process>('processes')
  const equipment = useList<Equipment>('equipment', { size: 200, active: true })
  const workers = useList<User>('users', { size: 200, active: true, sort: 'name' })

  const query = {
    from,
    to,
    group,
    process_code: processCode || undefined,
    equipment_id: equipmentId || undefined,
    worker_id: workerId || undefined,
  }
  const report = useApiQuery(['reports', 'output', query], () => reportsApi.output(query))
  const excel = useApiMutation(() => reportsApi.outputExcel(query, `실적집계_${from}_${to}.xlsx`))

  const columns: Column<OutputReportRow & { _i: number }>[] = [
    { key: 'period', header: '기간' },
    { key: 'process_code', header: '공정' },
    { key: 'equipment_code', header: '설비', render: (r) => (r.equipment_code ? `${r.equipment_code}${r.equip_type ? ` (${EquipTypeLabel[r.equip_type]})` : ''}` : '—') },
    { key: 'worker_name', header: '작업자', render: (r) => r.worker_name ?? '—' },
    { key: 'qty_good', header: '양품', align: 'right', render: (r) => <span className="tabular-nums">{formatQty(r.qty_good)}</span> },
    { key: 'qty_bad', header: '불량', align: 'right', render: (r) => <span className="tabular-nums">{formatQty(r.qty_bad)}</span> },
    {
      key: 'bad_rate',
      header: '불량률',
      align: 'right',
      render: (r) => {
        const rate = badRate(r)
        return <span className="tabular-nums">{rate === null ? '—' : `${rate.toFixed(1)}%`}</span>
      },
    },
    { key: 'wo_count', header: 'WO 수', align: 'right', render: (r) => <span className="tabular-nums">{formatQty(r.wo_count)}</span> },
    { key: 'output_per_hour', header: '시간당', align: 'right', render: (r) => <span className="tabular-nums">{r.output_per_hour === null ? '—' : formatQty(r.output_per_hour, 1)}</span> },
  ]

  const totalBadRate = report.data ? (report.data.totals.qty_good + report.data.totals.qty_bad > 0 ? (report.data.totals.qty_bad / (report.data.totals.qty_good + report.data.totals.qty_bad)) * 100 : null) : null

  return (
    <>
      <PageHeader
        title="실적 집계"
        breadcrumb="실적·분석 › 실적 집계 (ADM-25)"
        actions={
          <Button variant="primary" loading={excel.loading} onClick={() => void excel.mutate(undefined).catch(() => undefined)}>
            Excel 다운로드
          </Button>
        }
      />
      {excel.error ? <ApiErrorAlert error={excel.error} onRetry={() => void excel.mutate(undefined).catch(() => undefined)} className="mb-3" /> : null}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <DateInput label="부터" value={from} onChange={(e) => patch({ from: e.target.value })} wrapperClassName="w-40" />
        <DateInput label="까지" value={to} onChange={(e) => patch({ to: e.target.value })} wrapperClassName="w-40" />
        <RadioGroupInline group={group} onChange={(g) => patch({ group: g })} />
        <Select label="공정" value={processCode} onChange={(e) => patch({ process_code: e.target.value })} placeholder="전체" wrapperClassName="w-36" options={(processes.data ?? []).slice().sort((a, b) => a.seq - b.seq).map((p) => ({ value: p.code, label: `${p.code} ${p.name}` }))} />
        <Select label="설비" value={equipmentId} onChange={(e) => patch({ equipment_id: e.target.value })} placeholder="전체" wrapperClassName="w-40" options={(equipment.data?.items ?? []).map((e) => ({ value: String(e.id), label: `${e.code} ${e.name}` }))} />
        <Select label="작업자" value={workerId} onChange={(e) => patch({ worker_id: e.target.value })} placeholder="전체" wrapperClassName="w-40" options={(workers.data?.items ?? []).map((u) => ({ value: String(u.id), label: u.name }))} />
      </div>

      {report.data ? (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="양품 합계" value={formatQty(report.data.totals.qty_good)} />
          <StatCard label="불량 합계" value={formatQty(report.data.totals.qty_bad)} tone={report.data.totals.qty_bad > 0 ? 'warn' : 'default'} />
          <StatCard label="불량률" value={totalBadRate === null ? '—' : `${totalBadRate.toFixed(1)}%`} />
          <StatCard label="시간당 생산량" value={report.data.totals.output_per_hour === null ? '—' : formatQty(report.data.totals.output_per_hour, 1)} />
        </div>
      ) : null}

      <DataTable<OutputReportRow & { _i: number }>
        columns={columns}
        rows={(report.data?.rows ?? []).map((r, i) => ({ ...r, _i: i }))}
        rowKey={(r) => r._i}
        loading={report.loading}
        error={report.error ? <ApiErrorAlert error={report.error} onRetry={() => void report.refetch()} /> : undefined}
        emptyText="조회 조건에 해당하는 실적이 없습니다"
        pageSize={0}
      />
    </>
  )
}

function RadioGroupInline({ group, onChange }: { group: Group; onChange: (g: Group) => void }) {
  return (
    <RadioGroup<Group>
      label="집계 단위"
      name="output_group"
      value={group}
      onChange={onChange}
      options={[
        { value: 'day', label: '일' },
        { value: 'week', label: '주' },
        { value: 'month', label: '월' },
      ]}
    />
  )
}

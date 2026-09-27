/**
 * ADM-11 기준정보 엑셀 일괄 등록 — Stepper 5단계
 * ① 대상 선택·템플릿 다운로드 → ② 업로드·검증(preview) → ③ 검증 결과(오류·중복 후보) → ④ 미리보기 → ⑤ 적재(commit)·결과
 * 규칙: api-contract §13.3 admin #12·#22·#23 (5MB·5,000행, duplicates, merge_policy, skip_invalid, errors>0 → 409 IMPORT_HAS_ERRORS)
 */
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, DataTable, ErrorAlert, PageHeader, Select, useToast, type Column } from '@/shared/ui/admin'
import { useApiMutation, useAuth } from '@/shared/hooks'
import { importApi } from '@/shared/api'
import { MIGRATION_SOURCES, type ImportCommitRequest, type ImportDuplicate, type ImportEntity, type ImportError, type ImportPreview, type ImportResult, type MigrationSource } from '@/shared/types'
import { ImportEntityLabel, MigrationSourceLabel } from '@/shared/labels'
import { formatQty } from '../../format'
import { importEntitiesFor } from '../../permissions'
import { ApiErrorAlert, Checkbox, ConfirmDialog, FileDropzone, RadioGroup, Stepper } from '../../components'

const STEPS = ['대상 선택 · 템플릿', '업로드', '검증 결과', '미리보기', '적재 · 결과']
const MAX_MB = 5
const LIST_LINK: Record<ImportEntity, string> = { customer: '/admin/master/customers', item: '/admin/master/items', stock: '/admin/material/stock' }

export function ImportPage() {
  const { role } = useAuth()
  const allowed = importEntitiesFor(role)
  const toast = useToast()
  const [sp, setSp] = useSearchParams()
  const entityParam = sp.get('entity') as ImportEntity | null
  const entity: ImportEntity = entityParam && allowed.includes(entityParam) ? entityParam : (allowed[0] ?? 'customer')
  const setEntity = (e: ImportEntity) =>
    setSp(
      (p) => {
        const n = new URLSearchParams(p)
        n.set('entity', e)
        n.delete('batch')
        return n
      },
      { replace: true },
    )
  const [source, setSource] = useState<MigrationSource | ''>('')
  const [step, setStep] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [mergePolicy, setMergePolicy] = useState<ImportCommitRequest['merge_policy']>('SKIP')
  const [skipInvalid, setSkipInvalid] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const template = useApiMutation((e: ImportEntity) => importApi.downloadTemplate(e))
  const doPreview = useApiMutation(({ f, e, s }: { f: File; e: ImportEntity; s?: MigrationSource }) => importApi.preview(f, e, s))
  const doCommit = useApiMutation(({ id, body }: { id: number; body: ImportCommitRequest }) => importApi.commit(id, body))

  const errorRows = useMemo(() => new Set((preview?.errors ?? []).map((e) => e.row)).size, [preview])
  const sampleColumns: Column<Record<string, unknown>>[] = useMemo(() => {
    const keys = new Set<string>()
    for (const r of preview?.rows_sample ?? []) Object.keys(r).forEach((k) => keys.add(k))
    return [...keys].map((k) => ({ key: k, header: k, render: (r: Record<string, unknown>) => (r[k] === null || r[k] === undefined ? <span className="text-ink-faint">—</span> : String(r[k])) }))
  }, [preview])

  const restart = () => {
    setStep(0)
    setFile(null)
    setPreview(null)
    setResult(null)
    setSkipInvalid(false)
    setMergePolicy('SKIP')
    doPreview.reset()
    doCommit.reset()
    setSp(
      (p) => {
        const n = new URLSearchParams(p)
        n.delete('batch')
        return n
      },
      { replace: true },
    )
  }

  const canCommit = preview !== null && (preview.errors.length === 0 || skipInvalid) && preview.valid > 0

  if (allowed.length === 0) return <ErrorAlert title="접근 권한이 없습니다" message="엑셀 일괄 등록은 ADMIN(전체)·SALES(거래처·품목)·MANAGER(기초재고) 만 할 수 있습니다." />

  return (
    <>
      <PageHeader title="기준정보 엑셀 일괄 등록" breadcrumb="기준정보 › 엑셀 일괄 등록 (ADM-11)" description="템플릿 다운로드 → 업로드 → 검증 → 미리보기 → 적재. 모든 배치는 마이그레이션 현황(ADM-31)에 남습니다" />
      <Stepper steps={STEPS} current={step} onSelect={(i) => (result ? undefined : setStep(i))} />

      {step === 0 ? (
        <section className="max-w-2xl space-y-4">
          <Select label="대상" required value={entity} onChange={(e) => setEntity(e.target.value as ImportEntity)} options={allowed.map((e) => ({ value: e, label: `${ImportEntityLabel[e]} (${e})` }))} wrapperClassName="w-64" />
          <Select
            label="출처 (source)"
            value={source}
            onChange={(e) => setSource(e.target.value as MigrationSource | '')}
            options={MIGRATION_SOURCES.map((s) => ({ value: s, label: `${MigrationSourceLabel[s]} (${s})` }))}
            placeholder={`기본값 — ${entity === 'stock' ? 'COUNT 실사' : 'IMS_XLS IMS 엑셀'}`}
            hint="customer/item 기본 IMS_XLS, stock 기본 COUNT (admin #12)"
            wrapperClassName="w-64"
          />
          {template.error ? <ApiErrorAlert error={template.error} onRetry={() => void template.mutate(entity)} /> : null}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              loading={template.loading}
              onClick={async () => {
                try {
                  const r = await template.mutate(entity)
                  toast.success(`템플릿 다운로드: ${r.filename}`)
                } catch {
                  /* template.error 표시 */
                }
              }}
            >
              템플릿 다운로드
            </Button>
            <Button variant="primary" onClick={() => setStep(1)}>
              다음 — 업로드
            </Button>
          </div>
          <div className="rounded-ad border border-line bg-surface p-3 text-ad-xs text-ink-muted">
            <p>템플릿: 첫 행 헤더 · 시트 1개 · .xlsx · 최대 {MAX_MB}MB · 5,000행 (admin #22). `*` 필수</p>
            <p className="mt-1 font-mono">
              {entity === 'customer'
                ? 'code*, name*, contact_name, phone, email, default_carrier, legacy_id, addr_label, addr_receiver, addr_phone, addr_postal_code, addr_address1, addr_address2'
                : entity === 'item'
                  ? 'code*, name*, item_group*, spec, color, weight_g, vendor_item_code, vendor_barcode, qty_tolerance_pct, legacy_id'
                  : 'item_code*, qty_on_hand*, note'}
            </p>
            <p className="mt-1">코드가 같은 행은 중복 후보(duplicates)로 표시되며, 적재 시 병합 정책(SKIP/UPDATE)으로 처리합니다 (admin #23).</p>
          </div>
        </section>
      ) : null}

      {step === 1 ? (
        <section className="max-w-2xl space-y-4">
          <div className="text-ink-muted">
            대상: <b>{ImportEntityLabel[entity]}</b> {source ? `· 출처 ${MigrationSourceLabel[source]}` : ''}
          </div>
          <FileDropzone accept=".xlsx" file={file} onChange={setFile} hint={`.xlsx 1개, 최대 ${MAX_MB}MB`} disabled={doPreview.loading} />
          {file && file.size > MAX_MB * 1024 * 1024 ? <ErrorAlert title="FILE_TOO_LARGE" message={`파일이 ${MAX_MB}MB 를 넘습니다 (admin #22)`} /> : null}
          {doPreview.error ? <ApiErrorAlert error={doPreview.error} /> : null}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep(0)} disabled={doPreview.loading}>
              이전
            </Button>
            <Button
              variant="primary"
              disabled={!file || file.size > MAX_MB * 1024 * 1024}
              loading={doPreview.loading}
              onClick={async () => {
                if (!file) return
                try {
                  const p = await doPreview.mutate({ f: file, e: entity, ...(source ? { s: source } : {}) })
                  setPreview(p)
                  setSkipInvalid(false)
                  setSp(
                    (prev) => {
                      const n = new URLSearchParams(prev)
                      n.set('batch', String(p.batch_id))
                      return n
                    },
                    { replace: true },
                  )
                  setStep(2)
                } catch {
                  /* doPreview.error 표시 */
                }
              }}
            >
              {doPreview.loading ? '검증 중…' : '검증'}
            </Button>
          </div>
        </section>
      ) : null}

      {step === 2 && preview ? (
        <section className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="총 행" value={preview.row_count} />
            <Stat label="정상" value={preview.valid} tone="done" />
            <Stat label="오류 행 / 오류 건" value={`${formatQty(errorRows)} / ${formatQty(preview.errors.length)}`} tone={preview.errors.length ? 'error' : undefined} />
            <Stat label="중복 후보" value={preview.duplicates.length} tone={preview.duplicates.length ? 'warn' : undefined} />
            <Stat label="무시 (예시 행 #)" value={preview.ignored ?? 0} />
          </div>
          <div className="text-ad-xs text-ink-muted">
            batch #{preview.batch_id} · {ImportEntityLabel[preview.entity]} · 출처 {MigrationSourceLabel[preview.source]} · 적재하지 않은 배치는 현황에 PREVIEW 로 남습니다
          </div>
          {preview.errors.length ? (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <h2 className="font-semibold">오류 ({preview.errors.length})</h2>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await navigator.clipboard.writeText(['row,col,msg', ...preview.errors.map((e) => `${e.row},${e.col},"${e.msg.replace(/"/g, '""')}"`)].join('\n'))
                    toast.success('오류 목록을 CSV 로 복사했습니다')
                  }}
                >
                  오류만 CSV 복사
                </Button>
              </div>
              <DataTable<ImportError>
                columns={[
                  { key: 'row', header: '행', align: 'right', sortable: true },
                  { key: 'col', header: '컬럼', sortable: true },
                  { key: 'msg', header: '메시지' },
                ]}
                rows={preview.errors}
                rowKey={(e) => `${e.row}-${e.col}-${e.msg}`}
                pageSize={50}
                dense
              />
            </div>
          ) : (
            <div className="rounded-ad border border-status-done-line bg-status-done-bg p-3 text-status-done-fg">행 오류 없음</div>
          )}
          {preview.duplicates.length ? (
            <div>
              <h2 className="mb-1 font-semibold">중복 후보 ({preview.duplicates.length}) — 적재 시 병합 정책으로 처리</h2>
              <DataTable<ImportDuplicate>
                columns={[
                  { key: 'row', header: '행', align: 'right', sortable: true },
                  { key: 'existing_code', header: '기존 코드', render: (d) => <span className="font-mono">{d.existing_code}</span> },
                  { key: 'reason', header: '사유', render: (d) => (d.reason === 'CODE' ? 'CODE — 코드 일치' : 'NAME_PHONE — 상호+전화 일치') },
                ]}
                rows={preview.duplicates}
                rowKey={(d) => `${d.row}-${d.existing_code}`}
                pageSize={50}
                dense
              />
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep(1)}>
              이전 — 파일 다시 올리기
            </Button>
            <Button variant="primary" onClick={() => setStep(3)}>
              다음 — 미리보기
            </Button>
          </div>
        </section>
      ) : null}

      {step === 3 && preview ? (
        <section className="space-y-4">
          <div className="text-ink-muted">
            상위 {formatQty(preview.rows_sample.length)}건 미리보기 — 전체 {formatQty(preview.row_count)}건
          </div>
          <DataTable<Record<string, unknown>> columns={sampleColumns} rows={preview.rows_sample} rowKey={(r) => preview.rows_sample.indexOf(r)} pageSize={0} dense className="max-h-[60vh]" emptyText="샘플 행이 없습니다" />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep(2)}>
              이전
            </Button>
            <Button variant="primary" onClick={() => setStep(4)}>
              다음 — 적재
            </Button>
          </div>
        </section>
      ) : null}

      {step === 4 && preview ? (
        <section className="max-w-2xl space-y-4">
          {result ? (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="적재 loaded" value={result.loaded} tone="done" />
                <Stat label="병합 merged" value={result.merged} tone="progress" />
                <Stat label="건너뜀 skipped" value={result.skipped} />
                <Stat label="실패 failed" value={result.failed} tone={result.failed ? 'warn' : undefined} />
              </div>
              <div className={`rounded-ad border p-3 ${preview.row_count === result.loaded + result.merged + result.skipped + result.failed + (preview.ignored ?? 0) ? 'border-status-done-line bg-status-done-bg text-status-done-fg' : 'border-status-warn-line bg-status-warn-bg text-status-warn-fg'}`}>
                대사: 원본 {formatQty(preview.row_count)} = 적재 {formatQty(result.loaded)} + 병합 {formatQty(result.merged)} + 건너뜀 {formatQty(result.skipped)} + 실패 {formatQty(result.failed)}
                {' '}+ 무시 {formatQty(preview.ignored ?? 0)} (spec §12.5 · F30)
                {result.failed > 0 ? ' — 실패 행은 마이그레이션 현황(ADM-31)에서 확인' : ''}
              </div>
              <div className="flex flex-wrap gap-2">
                <Link to="/admin/system/migration" className="underline">
                  마이그레이션 현황 보기 →
                </Link>
                <Link to={LIST_LINK[preview.entity]} className="underline">
                  {ImportEntityLabel[preview.entity]} 목록 보기 →
                </Link>
                <Button variant="secondary" size="sm" onClick={restart}>
                  새 업로드
                </Button>
              </div>
            </>
          ) : (
            <>
              <RadioGroup<ImportCommitRequest['merge_policy']>
                label="중복 행 병합 정책 (merge_policy)"
                name="merge_policy"
                value={mergePolicy}
                onChange={setMergePolicy}
                options={[
                  { value: 'SKIP', label: 'SKIP — 건너뛰기 (기본)', hint: '기존 행을 두고 중복 행은 skipped 로 집계. 상호+전화 일치(NAME_PHONE) 중복의 기본 정책 (D31)' },
                  { value: 'UPDATE', label: 'UPDATE — 갱신', hint: '기존 행을 엑셀 값으로 갱신, merged 로 집계. NAME_PHONE 중복은 다른 코드를 합치므로 명시 선택 시에만' },
                ]}
              />
              {preview.errors.length ? (
                <Checkbox label={`오류 행 ${formatQty(errorRows)}건을 제외하고 적재 (skip_invalid)`} checked={skipInvalid} onChange={(e) => setSkipInvalid(e.target.checked)} hint="체크하지 않으면 409 IMPORT_HAS_ERRORS — 파일을 고쳐 다시 올리는 것이 안전합니다 (spec §12.5 대사)" />
              ) : null}
              {doCommit.error ? <ApiErrorAlert error={doCommit.error} {...(doCommit.error.status === 423 ? { onRetry: () => void commit() } : {})} /> : null}
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setStep(3)} disabled={doCommit.loading}>
                  이전
                </Button>
                <Button variant="primary" disabled={!canCommit} loading={doCommit.loading} onClick={() => setConfirmOpen(true)}>
                  {ImportEntityLabel[preview.entity]} {formatQty(skipInvalid ? preview.valid : preview.row_count)}건 적재
                </Button>
              </div>
            </>
          )}
        </section>
      ) : null}
      <ConfirmDialog open={confirmOpen} title="적재 확인" confirmLabel="적재" loading={doCommit.loading} error={doCommit.error} onClose={() => setConfirmOpen(false)} onConfirm={() => void commit()}>
        {preview ? (
          <p>
            {ImportEntityLabel[preview.entity]} {formatQty(skipInvalid ? preview.valid : preview.row_count)}건을 적재합니다. 병합 정책 {mergePolicy}
            {skipInvalid ? ' · 오류 행 제외' : ''}.
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  )

  async function commit() {
    if (!preview) return
    try {
      const body: ImportCommitRequest = { merge_policy: mergePolicy }
      if (skipInvalid) body.skip_invalid = true
      const r = await doCommit.mutate({ id: preview.batch_id, body })
      setResult(r)
      setConfirmOpen(false)
      toast.success(`적재 완료 — 적재 ${r.loaded} · 병합 ${r.merged} · 실패 ${r.failed}`)
    } catch {
      /* doCommit.error 는 확인 모달·화면에 표시 */
    }
  }
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'done' | 'error' | 'warn' | 'progress' | undefined }) {
  const cls = tone === 'done' ? 'border-status-done-line bg-status-done-bg text-status-done-fg' : tone === 'error' ? 'border-status-error-line bg-status-error-bg text-status-error-fg' : tone === 'warn' ? 'border-status-warn-line bg-status-warn-bg text-status-warn-fg' : tone === 'progress' ? 'border-status-progress-line bg-status-progress-bg text-status-progress-fg' : 'border-line bg-surface'
  return (
    <div className={`rounded-ad border p-3 ${cls}`}>
      <div className="text-ad-xs opacity-80">{label}</div>
      <div className="text-ad-title font-bold tabular-nums">{typeof value === 'number' ? formatQty(value) : value}</div>
    </div>
  )
}

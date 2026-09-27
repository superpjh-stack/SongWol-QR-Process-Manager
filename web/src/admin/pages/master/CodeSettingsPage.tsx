/** ADM-10 코드 체계 — GET/PUT /settings/codes. 접두사 4종·최소 순번 자릿수·체크코드 키 세대(읽기 전용) */
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Input, PageHeader, Select, useToast } from '@/shared/ui/admin'
import { useApiMutation, useApiQuery, useAuth } from '@/shared/hooks'
import { codeSettingsApi } from '@/shared/api'
import type { CodeSettings } from '@/shared/types'
import { todayYymmdd } from '../../format'
import { canWrite } from '../../permissions'
import { ApiErrorAlert, ConfirmDialog, QueryState, useFormApiError } from '../../components'

const prefix = z.string().trim().min(1, '입력하세요').max(4, '4자 이하 (VARCHAR(4))').regex(/^[A-Z]+$/, '영문 대문자')
const schema = z.object({ SO: prefix, WO: prefix, LT: prefix, US: prefix, seq_digits: z.enum(['4', '5']) })
type Form = z.infer<typeof schema>
const FIELDS = ['prefixes', 'SO', 'WO', 'LT', 'US', 'seq_digits']
const KEYS = ['SO', 'WO', 'LT', 'US'] as const

function SettingsForm({ initial, write, onSaved }: { initial: CodeSettings; write: boolean; onSaved: () => void }) {
  const toast = useToast()
  const save = useApiMutation((body: CodeSettings) => codeSettingsApi.put(body), [['settings', 'codes']])
  const toForm = (s: CodeSettings): Form => ({ ...s.prefixes, seq_digits: String(s.seq_digits) as '4' | '5' })
  const { register, handleSubmit, reset, setError, watch, formState } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: toForm(initial) })
  const { topError, apply, clear } = useFormApiError<Form>(setError, FIELDS)
  const [pending, setPending] = useState<CodeSettings | null>(null)
  useEffect(() => reset(toForm(initial)), [initial, reset])
  const v = watch()
  const digits = Number(v.seq_digits) || 4
  const today = todayYymmdd()
  const example = (p: string) => `${p || '?'}-${today}-${'0'.repeat(Math.max(0, digits - 1))}1`

  const onSubmit = handleSubmit((f) => {
    clear()
    const body: CodeSettings = { prefixes: { SO: f.SO, WO: f.WO, LT: f.LT, US: f.US }, seq_digits: Number(f.seq_digits) as 4 | 5, checkcode_key_generation: initial.checkcode_key_generation }
    const prefixChanged = KEYS.some((k) => body.prefixes[k] !== initial.prefixes[k])
    if (prefixChanged) setPending(body)
    else void doSave(body)
  })
  const doSave = async (body: CodeSettings) => {
    try {
      await save.mutate(body)
      toast.success('저장되었습니다')
      setPending(null)
      onSaved()
    } catch (e) {
      setPending(null)
      apply(e)
    }
  }
  const err = formState.errors
  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-5" noValidate>
      {topError ? <ApiErrorAlert error={topError} /> : null}
      <fieldset className="rounded-ad border border-line bg-surface p-4">
        <legend className="px-1 text-ad-xs font-semibold text-ink-muted">접두사 (spec §2.1 기본 SO/WO/LT/US)</legend>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {KEYS.map((k) => (
            <Input key={k} label={k} required maxLength={4} readOnly hint={<span className="font-mono">{example(v[k])}</span>} error={err[k]?.message} {...register(k)} />
          ))}
        </div>
        <p className="mt-3 text-ad-xs text-ink-muted">S0 에서는 접두사가 SO/WO/LT/US 로 고정되어 읽기 전용입니다 (서버 422 PREFIX_FIXED). 바뀌더라도 이미 발행된 코드는 바뀌지 않고 새 채번부터 적용됩니다.</p>
      </fieldset>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Select
          label="최소 순번 자릿수"
          required
          disabled={!write}
          options={[
            { value: '4', label: '4자리 (NNNN)' },
            { value: '5', label: '5자리 (NNNNN)' },
          ]}
          hint="그 자릿수 범위를 넘으면 자동 확장 (spec §2.1, admin #21)"
          error={err.seq_digits?.message}
          {...register('seq_digits')}
        />
        <Input label="체크코드 비밀키 세대" readOnly value={String(initial.checkcode_key_generation)} hint="비밀키는 환경변수 CHECKCODE_SECRET — 화면에서 읽거나 쓰지 않습니다. 회전은 인프라 작업(구 secret 도 검증 허용, 2세대)" />
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={!write || !formState.isDirty} loading={save.loading}>
          저장
        </Button>
        <Button type="button" variant="ghost" disabled={!formState.isDirty} onClick={() => reset(toForm(initial))}>
          되돌리기
        </Button>
      </div>
      <ConfirmDialog open={pending !== null} title="접두사 변경" danger confirmLabel="변경 저장" loading={save.loading} onClose={() => setPending(null)} onConfirm={() => pending && void doSave(pending)}>
        <p>접두사를 바꿉니다. 이미 발행된 코드는 바뀌지 않으며 새 채번부터 적용됩니다.</p>
        {pending ? (
          <ul className="mt-2 font-mono text-ad-xs">
            {KEYS.filter((k) => pending.prefixes[k] !== initial.prefixes[k]).map((k) => (
              <li key={k}>
                {k}: {initial.prefixes[k]} → {pending.prefixes[k]}
              </li>
            ))}
          </ul>
        ) : null}
      </ConfirmDialog>
    </form>
  )
}

export function CodeSettingsPage() {
  const { role } = useAuth()
  const write = canWrite(role, 'master.codes')
  const settings = useApiQuery<CodeSettings>(['settings', 'codes'], () => codeSettingsApi.get())
  return (
    <>
      <PageHeader title="코드 체계" breadcrumb="기준정보 › 코드체계 (ADM-10)" description="접두사(SO/WO/LT/US), 순번 자릿수, 체크코드 비밀키 세대. 저장처 app_setting.CODE_SETTINGS" />
      <QueryState state={settings}>{(s) => <SettingsForm initial={s} write={write} onSaved={() => void settings.refetch()} />}</QueryState>
    </>
  )
}

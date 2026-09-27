/** ADM-08 사용자 — 목록(q·active·role)·등록·수정·카드 발급·PIN·비밀번호·비활성·재활성 */
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, DataTable, Input, Modal, PageHeader, Select, useToast, type Column } from '@/shared/ui/admin'
import { useApiMutation, useAuth, useCreate, useList, useUpdate } from '@/shared/hooks'
import { usersApi } from '@/shared/api'
import { ROLES, type IssueCardRequest, type IssueCardResponse, type User, type UserCreate, type UserUpdate } from '@/shared/types'
import { RoleLabel } from '@/shared/labels'
import { StatusBadge } from '@/shared/ui'
import { formatDateTime } from '../../format'
import { canWrite } from '../../permissions'
import { ActiveBadge, ApiErrorAlert, Checkbox, CodeText, ListToolbar, RowActions, ToggleActiveDialog, lowerId, serverTable, useFormApiError, useListParams, zx } from '../../components'

const ROLE_OPTIONS = ROLES.map((r) => ({ value: r, label: `${r} ${RoleLabel[r]}` }))
const CARD_ROLES: readonly string[] = ['WORKER', 'MANAGER']

const schema = z.object({
  login_id: zx.req(30, '로그인 ID'),
  name: zx.req(50, '이름'),
  role: z.enum(ROLES, { error: '역할을 선택하세요' }),
  password: z.string().refine((v) => v === '' || zx.password().safeParse(v).success, '8자 이상, 영문과 숫자 각 1자 이상 (admin #16)'),
  pin: z.string().refine((v) => v === '' || /^\d{4,6}$/.test(v), '숫자 4~6자리'),
  issue_card: z.boolean(),
})
type Form = z.infer<typeof schema>
const FIELDS = Object.keys(schema.shape)
const EMPTY: Form = { login_id: '', name: '', role: 'WORKER', password: '', pin: '', issue_card: true }

function UserFormModal({ open, initial, onClose, onSaved }: { open: boolean; initial: User | null; onClose: () => void; onSaved: (u: User, created: boolean) => void }) {
  const isEdit = initial !== null
  const create = useCreate<User, UserCreate>('users')
  const update = useUpdate<User, UserUpdate>('users')
  const toForm = (u: User): Form => ({ login_id: u.login_id, name: u.name, role: u.role, password: '', pin: '', issue_card: false })
  const { register, handleSubmit, reset, setError, setValue, watch, formState } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: initial ? toForm(initial) : EMPTY })
  const { topError, apply, clear } = useFormApiError<Form>(setError, FIELDS, 'login_id')
  useEffect(() => {
    if (open) {
      reset(initial ? toForm(initial) : EMPTY)
      clear()
    }
  }, [open, initial, reset, clear])
  const role = watch('role')
  useEffect(() => {
    if (!isEdit && !formState.dirtyFields.issue_card) setValue('issue_card', CARD_ROLES.includes(role))
  }, [role, isEdit, setValue, formState.dirtyFields.issue_card])
  const busy = create.loading || update.loading
  const onSubmit = handleSubmit(async (v) => {
    clear()
    try {
      if (isEdit) {
        const body: UserUpdate = {}
        if (formState.dirtyFields.name) body.name = v.name
        if (formState.dirtyFields.role) body.role = v.role
        onSaved(await update.mutate({ id: initial.id, body }), false)
      } else {
        const body: UserCreate = { login_id: v.login_id, name: v.name, role: v.role, issue_card: v.issue_card }
        if (v.password) body.password = v.password
        if (v.pin) body.pin = v.pin
        onSaved(await create.mutate(body), true)
      }
    } catch (e) {
      apply(e)
    }
  })
  const err = formState.errors
  return (
    <Modal
      open={open}
      title={isEdit ? `사용자 수정 — ${initial.login_id}` : '사용자 등록'}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button variant="primary" onClick={() => void onSubmit()} loading={busy}>
            저장
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-2" noValidate>
        {topError ? (
          <div className="md:col-span-2">
            <ApiErrorAlert error={topError} />
          </div>
        ) : null}
        <Input label="로그인 ID" required maxLength={30} readOnly={isEdit} autoComplete="off" className="lowercase" hint={isEdit ? '수정 불가' : '소문자로 저장 (D28)'} error={err.login_id?.message} {...register('login_id', { setValueAs: lowerId })} />
        <Input label="이름" required maxLength={50} error={err.name?.message} {...register('name')} />
        <Select label="역할" required options={ROLE_OPTIONS} error={err.role?.message} {...register('role')} />
        {!isEdit ? (
          <>
            <Input label="비밀번호" type="password" autoComplete="new-password" hint="웹 로그인이 필요한 역할만. 8자 이상, 영문+숫자" error={err.password?.message} {...register('password')} />
            <Input label="PIN" inputMode="numeric" maxLength={6} autoComplete="off" hint="키오스크 로그인·반장 승인 PIN. 숫자 4~6자리" error={err.pin?.message} {...register('pin')} />
            <Checkbox label="작업자 카드 발급 (US 채번)" hint="WORKER·MANAGER 는 기본 발급 — 단말 로그인에 카드 필수 (§13.2 ⑥)" {...register('issue_card')} />
          </>
        ) : (
          <p className="text-ad-xs text-ink-muted md:col-span-2">비밀번호·PIN·카드는 목록의 행 액션에서 설정합니다 (UserUpdate 는 name·role 만)</p>
        )}
        <button type="submit" className="hidden" aria-hidden="true" />
      </form>
    </Modal>
  )
}

/** 카드 발급 (POST /users/{id}/issue-card {reissue?, printer_id?}) → 결과 카드 코드 */
function IssueCardModal({ user, onClose, onDone }: { user: User | null; onClose: () => void; onDone: () => void }) {
  const issue = useApiMutation(({ id, body }: { id: number; body: IssueCardRequest }) => usersApi.issueCard(id, body), [['res', 'users']])
  const [reissue, setReissue] = useState(false)
  const [printerId, setPrinterId] = useState('')
  const [result, setResult] = useState<IssueCardResponse | null>(null)
  const resetIssue = issue.reset
  useEffect(() => {
    setReissue(false)
    setPrinterId('')
    setResult(null)
    resetIssue()
  }, [user, resetIssue])
  const hasCard = Boolean(user?.card_code)
  return (
    <Modal
      open={user !== null}
      title={`카드 발급 — ${user?.name ?? ''}`}
      onClose={onClose}
      dismissible={!issue.loading}
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>
            닫기
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={issue.loading}>
              취소
            </Button>
            <Button
              variant="primary"
              loading={issue.loading}
              disabled={hasCard && !reissue}
              onClick={async () => {
                if (!user) return
                const body: IssueCardRequest = {}
                if (reissue) body.reissue = true
                if (printerId.trim()) body.printer_id = printerId.trim()
                try {
                  setResult(await issue.mutate({ id: user.id, body }))
                  onDone()
                } catch {
                  /* issue.error 표시 */
                }
              }}
            >
              발급
            </Button>
          </>
        )
      }
    >
      {user ? (
        <div className="space-y-3">
          {issue.error ? <ApiErrorAlert error={issue.error} /> : null}
          {result ? (
            <div className="rounded-ad border border-status-done-line bg-status-done-bg p-3 text-status-done-fg">
              카드 <CodeText code={result.card_code} copy /> 발급.{' '}
              {result.label_job ? (result.label_job.zpl_sent ? `프린터 ${result.label_job.printer_id ?? ''} 로 출력했습니다.` : `출력 실패: ${result.label_job.error ?? '프린터 미지정'}`) : '인쇄하지 않았습니다 (printer_id 없음). 재출력은 POST /labels/print WORKER_CARD [S1].'}
            </div>
          ) : (
            <>
              {hasCard ? (
                <>
                  <p>
                    현재 카드 <CodeText code={user.card_code} />. 재발급하면 <b>새 US 코드를 채번</b>하고 이전 코드는 즉시 무효가 됩니다 (admin #17).
                  </p>
                  <Checkbox label="재발급 (reissue)" checked={reissue} onChange={(e) => setReissue(e.target.checked)} />
                </>
              ) : (
                <p>{user.name} 에게 작업자 QR 카드(US-NNNN)를 발급합니다. 서버가 label_issue(WORKER_CARD) 를 기록합니다.</p>
              )}
              <Input label="프린터 ID (즉시 인쇄, 선택)" value={printerId} onChange={(e) => setPrinterId(e.target.value)} hint="비우면 인쇄하지 않습니다. 프린터 등록은 ADM-09 [S1]" />
            </>
          )}
        </div>
      ) : null}
    </Modal>
  )
}

/** PIN / 비밀번호 설정 모달 (값 + 확인) */
function SecretSetModal({ kind, user, onClose }: { kind: 'pin' | 'password' | null; user: User | null; onClose: () => void }) {
  const toast = useToast()
  const set = useApiMutation(({ id, value }: { id: number; value: string }) => (kind === 'pin' ? usersApi.setPin(id, value) : usersApi.setPassword(id, value)), [['res', 'users']])
  const [v1, setV1] = useState('')
  const [v2, setV2] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const resetSet = set.reset
  useEffect(() => {
    setV1('')
    setV2('')
    setErr(null)
    resetSet()
  }, [kind, user, resetSet])
  const open = kind !== null && user !== null
  const isPin = kind === 'pin'
  const submit = async () => {
    const parsed = (isPin ? zx.pin() : zx.password()).safeParse(v1)
    if (!parsed.success) return setErr(parsed.error.issues[0]?.message ?? '형식 오류')
    if (v1 !== v2) return setErr('확인 값이 다릅니다')
    setErr(null)
    if (!user) return
    try {
      await set.mutate({ id: user.id, value: v1 })
      toast.success(isPin ? 'PIN 이 설정되었습니다' : '비밀번호가 설정되었습니다')
      onClose()
    } catch {
      /* set.error 표시 */
    }
  }
  return (
    <Modal
      open={open}
      title={`${isPin ? 'PIN' : '비밀번호'} 설정 — ${user?.name ?? ''}`}
      onClose={onClose}
      size="sm"
      dismissible={!set.loading}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={set.loading}>
            취소
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={set.loading}>
            저장
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {set.error ? <ApiErrorAlert error={set.error} /> : null}
        <Input label={isPin ? 'PIN' : '비밀번호'} type="password" inputMode={isPin ? 'numeric' : undefined} maxLength={isPin ? 6 : undefined} autoComplete="new-password" value={v1} onChange={(e) => setV1(e.target.value)} hint={isPin ? '숫자 4~6자리' : '8자 이상, 영문과 숫자 각 1자 이상'} error={err} />
        <Input label={`${isPin ? 'PIN' : '비밀번호'} 확인`} type="password" inputMode={isPin ? 'numeric' : undefined} maxLength={isPin ? 6 : undefined} autoComplete="new-password" value={v2} onChange={(e) => setV2(e.target.value)} />
        <button type="submit" className="hidden" aria-hidden="true" />
      </form>
    </Modal>
  )
}

export function UsersPage() {
  const { role } = useAuth()
  const write = canWrite(role, 'master.users')
  const toast = useToast()
  const params = useListParams({ defaultSort: 'login_id', extraKeys: ['role'] })
  const list = useList<User>('users', params.query)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [toggling, setToggling] = useState<User | null>(null)
  const [issuing, setIssuing] = useState<User | null>(null)
  const [secret, setSecret] = useState<{ kind: 'pin' | 'password'; user: User } | null>(null)

  const columns: Column<User>[] = [
    { key: 'login_id', header: '로그인 ID', sortable: true, render: (r) => <span className={`font-mono ${r.active ? '' : 'text-ink-faint'}`}>{r.login_id}</span> },
    { key: 'name', header: '이름', sortable: true },
    { key: 'role', header: '역할', sortable: true, render: (r) => <StatusBadge kind="role" status={r.role} /> },
    { key: 'card_code', header: '카드', render: (r) => (r.card_code ? <CodeText code={r.card_code} /> : <span className="text-ink-muted">미발급</span>) },
    { key: 'has_pin', header: 'PIN', render: (r) => (r.has_pin ? '설정' : <span className="text-ink-muted">미설정</span>) },
    { key: 'has_password', header: '비밀번호', render: (r) => (r.has_password ? '설정' : <span className="text-ink-muted">미설정</span>) },
    { key: 'active', header: '활성', render: (r) => <ActiveBadge active={r.active} /> },
    { key: 'created_at', header: '등록일 ※', render: (r) => formatDateTime(r.created_at) },
    {
      key: '_actions',
      header: '',
      render: (r) =>
        write ? (
          <RowActions>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(r)
                setFormOpen(true)
              }}
            >
              수정
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setIssuing(r)}>
              {r.card_code ? '카드 재발급' : '카드 발급'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setSecret({ kind: 'pin', user: r })}>
              PIN
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setSecret({ kind: 'password', user: r })}>
              비밀번호
            </Button>
            <Button size="sm" variant={r.active ? 'danger' : 'secondary'} onClick={() => setToggling(r)}>
              {r.active ? '비활성' : '재활성'}
            </Button>
          </RowActions>
        ) : null,
    },
  ]

  return (
    <>
      <PageHeader
        title="사용자"
        breadcrumb="기준정보 › 사용자 (ADM-08)"
        description="역할, 작업자 QR 카드 발급(US-NNNN), PIN, 관리자 웹 비밀번호"
        actions={
          <Button
            variant="primary"
            disabled={!write}
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
          >
            등록
          </Button>
        }
      />
      <ListToolbar params={params}>
        <Select label="역할" value={params.extra.role ?? ''} onChange={(e) => params.setExtra('role', e.target.value)} options={ROLE_OPTIONS} placeholder="전체" wrapperClassName="w-44" />
      </ListToolbar>
      <DataTable<User>
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
        {...serverTable(params, list.data)}
      />
      <p className="mt-2 text-ad-xs text-ink-muted">비활성 사용자의 카드는 스캔 불가(USER_CARD_NOT_FOUND/403). 초기 사용자 admin 은 시드</p>
      <UserFormModal
        open={formOpen}
        initial={editing}
        onClose={() => setFormOpen(false)}
        onSaved={(u, created) => {
          setFormOpen(false)
          toast.success(created && u.card_code ? `저장되었습니다 · 카드 ${u.card_code} 발급` : '저장되었습니다')
          void list.refetch()
        }}
      />
      <IssueCardModal user={issuing} onClose={() => setIssuing(null)} onDone={() => void list.refetch()} />
      <SecretSetModal kind={secret?.kind ?? null} user={secret?.user ?? null} onClose={() => setSecret(null)} />
      <ToggleActiveDialog<User>
        resource="users"
        entityLabel="사용자"
        target={toggling}
        idOf={(r) => r.id}
        describe={(r) => (
          <>
            <span className="font-mono">{r.login_id}</span> {r.name}
          </>
        )}
        onClose={() => setToggling(null)}
        onDone={() => void list.refetch()}
      />
    </>
  )
}

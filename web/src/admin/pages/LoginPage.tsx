/** ADM-00 로그인 — POST /auth/login → 토큰·user 저장 → next 또는 /admin */
import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Input, Spinner, useToast } from '@/shared/ui/admin'
import { useAuth, useAuthStore } from '@/shared/hooks'
import { ApiError } from '@/shared/api'
import { ApiErrorAlert, lowerId, useFormApiError } from '../components'

const schema = z.object({
  login_id: z.string().trim().min(1, '아이디를 입력하세요').max(30, '30자 이하'),
  password: z.string().min(1, '비밀번호를 입력하세요'),
})
type Form = z.infer<typeof schema>
const FIELDS = ['login_id', 'password'] as const

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/admin'
  return raw
}

export function LoginPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const next = safeNext(new URLSearchParams(location.search).get('next'))
  const [busy, setBusy] = useState(false)
  const { register, handleSubmit, setError, formState } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { login_id: '', password: '' } })
  const { topError, apply, clear } = useFormApiError<Form>(setError, FIELDS)

  useEffect(() => {
    if (useAuthStore.getState().consumeExpiredNotice()) toast.info('로그인이 필요합니다')
  }, [toast])

  if (auth.status === 'idle' || auth.status === 'loading') {
    return (
      <main className="density-admin flex min-h-dvh items-center justify-center">
        <Spinner label="확인 중…" />
      </main>
    )
  }
  if (auth.isAuthenticated) return <Navigate to={next} replace />

  const onSubmit = handleSubmit(async (v) => {
    clear()
    setBusy(true)
    try {
      await auth.login(v.login_id, v.password)
      navigate(next, { replace: true })
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) apply(new ApiError(401, e.code, e.message || '아이디 또는 비밀번호가 올바르지 않습니다', e.detail))
      else apply(e)
    } finally {
      setBusy(false)
    }
  })

  return (
    <main className="density-admin flex min-h-dvh items-center justify-center bg-surface-2 p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-ad border border-line bg-surface p-6 shadow-card" noValidate>
        <h1 className="text-ad-title font-bold">송월 QR 공정관리</h1>
        {topError ? <ApiErrorAlert error={topError} onRetry={() => void onSubmit()} /> : null}
        <Input label="아이디" required autoComplete="username" maxLength={30} autoFocus error={formState.errors.login_id?.message} {...register('login_id', { setValueAs: lowerId })} />
        <Input label="비밀번호" required type="password" autoComplete="current-password" error={formState.errors.password?.message} {...register('password')} />
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          로그인
        </Button>
      </form>
    </main>
  )
}

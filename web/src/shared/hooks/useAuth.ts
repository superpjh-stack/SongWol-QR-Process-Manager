/**
 * 인증 상태 (zustand). 역할 판정은 `user.role` 한 곳에서 한다 — 화면이 JWT 를 직접 파싱하지 않는다 (screens-admin §0.7).
 * 토큰은 client.ts 의 localStorage `sw.jwt`. 앱 진입 시 `hydrate()` 가 GET /auth/me 로 유효성을 확인한다.
 */
import { create } from 'zustand'
import { ApiError, authApi, clearToken, getToken, setToken, setUnauthorizedHandler } from '../api'
import type { Role, UserSummary } from '../types'

export type AuthStatus =
  | 'idle' // hydrate 전
  | 'loading' // /auth/me 확인 중
  | 'ready' // 로그인됨
  | 'anon' // 토큰 없음/무효
  | 'error' // /auth/me 가 401 외 오류 (503·네트워크) — 재시도 가능

export type AuthState = {
  status: AuthStatus
  user: UserSummary | null
  error: ApiError | null
  /** 401 로 세션이 끊겨 /login 으로 온 경우 「로그인이 필요합니다」 안내용 */
  expiredNotice: boolean
  hydrate: () => Promise<void>
  login: (login_id: string, password: string) => Promise<UserSummary>
  logout: () => void
  consumeExpiredNotice: () => boolean
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'idle',
  user: null,
  error: null,
  expiredNotice: false,

  hydrate: async () => {
    if (!getToken()) {
      set({ status: 'anon', user: null, error: null })
      return
    }
    set({ status: 'loading', error: null })
    try {
      const user = await authApi.me()
      set({ status: 'ready', user, error: null })
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        clearToken()
        set({ status: 'anon', user: null, error: null })
        return
      }
      set({ status: 'error', error: e instanceof ApiError ? e : null })
    }
  },

  login: async (login_id, password) => {
    const res = await authApi.login({ login_id, password })
    setToken(res.access_token)
    set({ status: 'ready', user: res.user, error: null, expiredNotice: false })
    return res.user
  },

  logout: () => {
    clearToken()
    set({ status: 'anon', user: null, error: null, expiredNotice: false })
  },

  consumeExpiredNotice: () => {
    const v = get().expiredNotice
    if (v) set({ expiredNotice: false })
    return v
  },
}))

// client.ts 401 → 세션 종료. 토큰은 client 가 이미 지웠다.
setUnauthorizedHandler(() => {
  useAuthStore.setState({ status: 'anon', user: null, expiredNotice: true })
})

export type Auth = {
  status: AuthStatus
  user: UserSummary | null
  role: Role | null
  isAuthenticated: boolean
  error: ApiError | null
  login: AuthState['login']
  logout: AuthState['logout']
  hydrate: AuthState['hydrate']
}

/** 화면용 훅. `role` 로 메뉴·버튼 노출을 판정한다 */
export function useAuth(): Auth {
  const s = useAuthStore()
  return {
    status: s.status,
    user: s.user,
    role: s.user?.role ?? null,
    isAuthenticated: s.status === 'ready' && s.user !== null,
    error: s.error,
    login: s.login,
    logout: s.logout,
    hydrate: s.hydrate,
  }
}

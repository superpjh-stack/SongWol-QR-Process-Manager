/** 인증 API — api-contract §7.1 */
import { api, API_PREFIX } from './client'
import type { LoginRequest, LoginResponse, UserSummary } from '../types'

export const authApi = {
  /** 로그인 요청의 401 은 리다이렉트 대상이 아니다 (아이디/비밀번호 오류) */
  login: (body: LoginRequest) => api.post<LoginResponse>(`${API_PREFIX}/auth/login`, body, { skipUnauthorized: true }),
  me: () => api.get<UserSummary>(`${API_PREFIX}/auth/me`),
}

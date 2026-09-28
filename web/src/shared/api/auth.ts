/** 인증 API — api-contract §7.1 */
import { api, API_PREFIX } from './client'
import { stationHeaders } from './scan'
import type { LoginRequest, LoginResponse, UserSummary, WorkerLoginRequest, WorkerLoginResponse } from '../types'

export const authApi = {
  /** 로그인 요청의 401 은 리다이렉트 대상이 아니다 (아이디/비밀번호 오류) */
  login: (body: LoginRequest) => api.post<LoginResponse>(`${API_PREFIX}/auth/login`, body, { skipUnauthorized: true }),
  me: () => api.get<UserSummary>(`${API_PREFIX}/auth/me`),
  /**
   * POST /auth/worker — STATION 자격 (api-contract §7.1, §13.2 ⑤). 키오스크·PDA 로그인(KSK-01).
   * 401(BAD_PIN) 등은 로그인 화면 자체 오류이지 단말 JWT 세션과 무관하므로 skipUnauthorized.
   */
  worker: (body: WorkerLoginRequest) =>
    api.post<WorkerLoginResponse>(`${API_PREFIX}/auth/worker`, body, { headers: stationHeaders(), skipUnauthorized: true }),
}

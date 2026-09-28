/**
 * 현황판 API — api-contract §7.8. `GET /dashboard/summary` 는 STATION 키(`type=BOARD` 단말)로도
 * 허용된다(`dependencies=[_dashboard_r]` → `require_roles(*P.DASHBOARD_READ, station=True)`,
 * backend/app/domain/board/router.py). `/board` 라우트는 로그인 없이 단말 키만 쓰므로(§8, BRD-01)
 * `stationHeaders()` 를 그대로 재사용한다 — `scan.ts` 의 STATION 전용 API들과 같은 이유로 분리한다.
 */
import { api, API_PREFIX } from './client'
import { stationHeaders } from './scan'
import type { DashboardSummary } from '../types'

const P = API_PREFIX

export const boardApi = {
  /** GET /api/v1/dashboard/summary — BRD-01 초기 데이터 · WS 단절 중 폴링 대체(§3 BRD-02) */
  summary: () => api.get<DashboardSummary>(`${P}/dashboard/summary`, { headers: stationHeaders() }),
}

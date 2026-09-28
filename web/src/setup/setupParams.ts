/**
 * 단말 등록 QR URL 파싱 — `{PUBLIC_HOST}/setup?s={station_id}&k={api_key}&p={printer_id?}&v=1` (api-contract §13.2 admin #15).
 * 저장·파싱 로직은 `@/shared/hooks/useStationConfig` 로 옮겼다(S2 — 키오스크 화면들도 재사용해야 해서).
 * 이 파일은 `/setup` 라우트가 쓰던 이름을 그대로 유지하기 위한 재노출이다.
 */
export {
  STATION_KEY,
  SETUP_VERSION,
  parseSetupParams,
  maskKey,
  loadStationConfig,
  saveStationConfig,
  clearStationConfig,
  useStationConfig,
} from '@/shared/hooks/useStationConfig'
export type { SetupParams, StationConfig, SetupParse, UseStationConfigResult } from '@/shared/hooks/useStationConfig'

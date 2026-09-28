// QA② S3 화면 E2E 설정. 실행: cd web && npx playwright test --config ../tools/playwright.config.ts
// @playwright/test 는 web/package.json 의 실 devDependency (npm install -D 로 설치, package-lock.json 갱신됨) —
// tools/ 자체는 이 리포(songwol-qr)의 git 이력에 커밋된다 (S2 때 문서 폴더 tools/ 가 git 저장소가 아니어서
// 스펙 파일이 사라진 신뢰도 문제 재발 방지 — progress.md 「검증 신뢰도 메모」 참고).
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: process.env.E2E_SPEC ? new RegExp(process.env.E2E_SPEC) : /qa_s3_e2e\.spec\.ts/,
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: process.env.E2E_JSON ?? 'qa_s3_e2e.result.json' }]],
  use: {
    baseURL: process.env.E2E_BASE ?? 'http://localhost:5186',
    headless: true,
    viewport: { width: 480, height: 900 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    permissions: [],
  },
  outputDir: process.env.E2E_OUT ?? 'qa_s3_e2e.out',
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})

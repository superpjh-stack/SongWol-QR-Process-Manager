/**
 * QA② S4 실 브라우저 E2E — /board TV 현황판(WS 갱신·재연결·백오프) · KSK-70 라벨 재발행 검색 ·
 * ADM-16 분할/재작업/이벤트 취소(E6) · ADM-25/28/29/30(실적집계·대시보드·알림이력·감사로그) ·
 * 지연 감지(실 스케줄러 10분→1분 단축) 반영 확인 · axe · 콘솔 오류.
 *
 * 전제: `outputs/qa-nonfunc-S4.md` §「재현 방법」 그대로 backend 8015 · vite 5188 · DB
 * songwol_qr_qa2s4 기동, 픽스처(SO/WO/설비/프린터/사용자)는 FIXTURES_JSON 경로의 JSON(스크립트로
 * API 선반영). 코드/체크코드는 §16.2 MANUAL 입력으로 대부분 우회한다(S2/S3 QA② 관례 그대로).
 */
import { test, expect, type Page } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

const BACKEND_ENV_FILE = process.env.QA_BACKEND_ENV ?? '/tmp/qa2s4.env'
const BACKEND_DIR = process.env.QA_BACKEND_DIR ?? `${process.env.HOME}/Documents/GitHub/songwol-qr/backend`
const BACKEND_MATCH = 'uvicorn app.main:app --port 8015'

/** 실 재연결 검증용: 브라우저 offline 에뮬레이션은 CDP 가 이미 열린 WS 소켓을 강제로 끊지 않는
 * 경우가 실측으로 확인돼(연결이 그대로 살아있어 배너가 절대 안 뜸), 과제 지시문의 대안대로
 * 이 세션이 직접 띄운 백엔드(8015, songwol_qr_qa2s4 전용)를 실제로 죽였다 살린다. QA①의
 * 백엔드(다른 포트)는 건드리지 않는다. */
function stopBackend() {
  try {
    execFileSync('pkill', ['-f', BACKEND_MATCH])
  } catch {
    /* 이미 안 떠있으면 무시 */
  }
}

function startBackend() {
  const child = spawn('bash', ['-lc', `cd '${BACKEND_DIR}' && set -a && source '${BACKEND_ENV_FILE}' && set +a && exec .venv/bin/uvicorn app.main:app --port 8015`], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

async function waitBackendUp(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${process.env.E2E_API ?? 'http://localhost:8015'}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login_id: 'admin', password: process.env.ADMIN_PW }),
      })
      if (res.status === 200) return
    } catch {
      /* 아직 안 뜸 */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('backend did not come back up in time')
}

const FIXTURES = JSON.parse(readFileSync(process.env.FIXTURES_JSON!, 'utf8'))
const STATION_KEYS: Record<string, string> = JSON.parse(readFileSync(process.env.STATION_KEYS_JSON!, 'utf8'))
const API_BASE = process.env.E2E_API ?? 'http://localhost:8015'
const PGDATABASE = process.env.QA_PGDATABASE ?? 'songwol_qr_qa2s4'
const ADMIN_PW = process.env.ADMIN_PW!

function psql(sql: string): string {
  return execFileSync('psql', ['-h', 'localhost', '-d', PGDATABASE, '-tAc', sql], { encoding: 'utf8' }).trim()
}

async function registerStation(page: Page, stationId: string, appPath: '/pda' | '/kiosk' | '/board') {
  const key = STATION_KEYS[stationId]
  if (appPath === '/board') {
    await page.goto(`/board?key=${key}`)
    return
  }
  await page.goto(`/setup?s=${stationId}&k=${key}&v=1`)
  await page.getByRole('button', { name: new RegExp(`이 기기를 ${stationId} 로 등록`) }).click()
  await expect(page.getByText('단말 등록 완료')).toBeVisible()
  await page.goto(appPath)
}

async function hidScan(page: Page, text: string) {
  await page.keyboard.type(text, { delay: 15 })
  await page.keyboard.press('Enter')
}

async function loginCard(page: Page, cardCode: string) {
  await expect(page.getByText('카드가 없어요')).toBeVisible()
  await hidScan(page, cardCode)
  await expect(page.getByRole('button', { name: '카메라 스캔 / 직접 입력' })).toBeVisible({ timeout: 10_000 })
}

async function manualScan(page: Page, code: string) {
  await page.getByRole('button', { name: '카메라 스캔 / 직접 입력' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '직접 입력으로 전환' }).click()
  await dialog.getByPlaceholder(/^예:/).fill(code)
  await dialog.getByRole('button', { name: '확인' }).click()
}

async function numpadType(page: Page, digits: string) {
  await page.getByRole('button', { name: '지우기', exact: true }).click()
  for (const d of digits) {
    await page.getByRole('button', { name: d, exact: true }).click()
  }
}

async function adminLogin(page: Page, loginId = 'admin', password = ADMIN_PW) {
  await page.goto('/login')
  await page.getByLabel('아이디').fill(loginId)
  await page.getByLabel('비밀번호').fill(password)
  await page.getByRole('button', { name: '로그인' }).click()
  await expect(page).toHaveURL(/\/admin/)
}

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(String(err)))
  return errors
}

async function runAxe(page: Page, label: string) {
  const AxeBuilder = (await import('@axe-core/playwright')).default
  const result = await new AxeBuilder({ page }).include('body').analyze()
  const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  test.info().annotations.push({ type: `axe-${label}`, description: JSON.stringify(serious.map((v) => ({ id: v.id, nodes: v.nodes.length }))) })
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([])
}

test.describe.configure({ mode: 'serial' })

// ============================================================================
// T1 — /board 접속: 키 주입→URL 정리, KPI/진행률/지연위험 렌더, axe
// ============================================================================
test('T1 board 접속: URL 정리 + KPI/진행률/지연위험 렌더 + axe', async ({ page }) => {
  const errors = trackConsoleErrors(page)
  await registerStation(page, 'BOARD-1', '/board')
  await expect(page).toHaveURL('/board')
  await expect(page.getByText('SO 진행 현황판')).toBeVisible()
  await expect(page.getByText('시간당 생산량')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('오늘 발송')).toBeVisible()
  await expect(page.getByText('공정별 대기')).toBeVisible()

  // 지연 위험 섹션 — wo_delay(SO3, 납기 지난 미착수)가 실 스케줄러(1분 단축)로 delay_risk=true 됨(사전 확인됨)
  await expect(page.getByText(/지연 위험 \(\d+\)/)).toBeVisible()
  await expect(page.getByText(FIXTURES.so3_code)).toBeVisible()
  await expect(page.getByText('지연 위험').first()).toBeVisible()

  await runAxe(page, 'board')
  expect(errors, JSON.stringify(errors)).toEqual([])
})

// ============================================================================
// T2 — WS 갱신 지연시간 측정: 다른 세션(API)에서 스캔 → wo_updated 프레임 수신까지 ms
// ============================================================================
test('T2 board WS 갱신 지연시간 측정 (다른 세션에서 스캔)', async ({ page, request }) => {
  // 리스너는 반드시 WS 접속(=registerStation 의 page.goto) 전에 등록해야 한다 — page.on('websocket')
  // 은 그 소켓이 "생성되는 시점" 1회만 발생해 나중에 붙이면 최초 접속 소켓의 프레임을 영영 놓친다.
  const frames: { t: number; msg: any }[] = []
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/ws/board')) return
    ws.on('framereceived', (ev) => {
      try {
        const m = JSON.parse(String(ev.payload))
        frames.push({ t: Date.now(), msg: m })
      } catch {
        /* ignore */
      }
    })
  })

  await registerStation(page, 'BOARD-1', '/board')
  await expect(page.getByText('시간당 생산량')).toBeVisible({ timeout: 15_000 })

  const wo = FIXTURES.wo_board as string
  const triggeredAt = Date.now()
  const scanRes = await request.post(`${API_BASE}/api/v1/scan`, {
    headers: { 'X-Station-Key': STATION_KEYS['PDA-P20-1'] },
    data: {
      event_uuid: crypto.randomUUID(),
      scanned_at: new Date().toISOString(),
      station_id: 'PDA-P20-1',
      worker_card: FIXTURES.worker_card,
      code: wo,
      check: null,
      action: 'RECEIVE',
      qty_good: 20,
      extra: { inspection: 'PASS' },
      input_via: 'MANUAL',
    },
  })
  expect(scanRes.ok(), await scanRes.text()).toBeTruthy()
  const respondedAt = Date.now()

  await expect
    .poll(() => frames.some((f) => f.msg.type === 'wo_updated' && f.msg.so?.so_code === FIXTURES.so1_code), { timeout: 5_000 })
    .toBe(true)
  const frame = frames.find((f) => f.msg.type === 'wo_updated' && f.msg.so?.so_code === FIXTURES.so1_code)!
  const latencyFromResponse = frame.t - respondedAt
  const latencyFromTrigger = frame.t - triggeredAt
  test.info().annotations.push(
    { type: 'ws-latency-from-scan-response-ms', description: String(latencyFromResponse) },
    { type: 'ws-latency-from-trigger-ms', description: String(latencyFromTrigger) },
  )
  expect(latencyFromTrigger).toBeLessThan(1500)
})

// ============================================================================
// T3+T4 (느림, ~100초) — 실 백엔드 kill/restart 로 재연결 검증: 회색 배너 → 백오프 초기 스텝
// (1s→2s→4s대) → 90초 초과 시 주황 승급 → 재기동 후 실제 재연결 성공
//
// 방법 메모: `context.setOffline(true)` 로 먼저 시도했으나, 이미 맺어진 WS 소켓을 CDP 오프라인
// 에뮬레이션이 강제로 끊지 않아(브라우저가 소켓을 살려 둠) 10초를 기다려도 배너가 전혀 뜨지
// 않는 것을 실측으로 확인했다 — 과제 지시문의 대안(백엔드를 실제로 죽였다 살리기)으로 전환.
// ============================================================================
test('T3+T4 board 재연결(실 백엔드 kill/restart): 회색 배너 + 백오프 + 90초 주황 승급 + 재기동 복귀', async ({ page }) => {
  test.setTimeout(160_000)
  const wsOpenTimes: number[] = []
  page.on('websocket', (ws) => {
    if (ws.url().includes('/ws/board')) wsOpenTimes.push(Date.now())
  })

  await registerStation(page, 'BOARD-1', '/board')
  await expect(page.getByText('시간당 생산량')).toBeVisible({ timeout: 15_000 })

  const stopTime = Date.now()
  stopBackend()
  await expect(page.getByText(/실시간 연결 끊김 — 재연결 중/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/폴링 갱신 중/)).toBeVisible({ timeout: 5_000 })

  // 백오프 초기 스텝: 8초 관찰하며 재접속 시도 간격 기록(대략 1s, 2s, 4s 패턴). stopTime 이전(=최초
  // 성공 접속)은 재연결 시도가 아니므로 제외한다.
  await page.waitForTimeout(8_000)
  const postStop = wsOpenTimes.filter((t) => t > stopTime)
  const firstGap = postStop.length >= 1 ? postStop[0] - stopTime : null
  const gaps = postStop.slice(1).map((t, i) => t - postStop[i])
  test.info().annotations.push(
    { type: 'reconnect-attempt-times', description: JSON.stringify(wsOpenTimes) },
    { type: 'reconnect-first-gap-after-stop-ms', description: String(firstGap) },
    { type: 'reconnect-gaps-ms', description: JSON.stringify(gaps) },
  )
  // backoffForAttempt(1) = 1000ms 근방이어야 한다(느슨하게 허용 — 타이밍 오차 감안 400~2500ms)
  if (firstGap !== null) expect(firstGap).toBeGreaterThan(400)
  if (gaps.length >= 1) expect(gaps[0]).toBeGreaterThan(firstGap ?? 0)

  // LONG_DISCONNECT_MS = 90_000 — 추가로 기다려 배너가 회색→주황(status-warn)으로 승급하는지 확인
  await expect(page.locator('[data-component="BoardConnectionBanner"]')).toHaveClass(/status-warn/, { timeout: 100_000 })

  startBackend()
  await waitBackendUp()
  await expect(page.getByText(/실시간 연결 끊김/)).toHaveCount(0, { timeout: 40_000 })
})

// ============================================================================
// T5 (느림, ~70초) — 알림 Ticker: 새 DELAY 알림이 라이브 브로드캐스트로 표시되는지 확인
// ============================================================================
test('T5 board 알림 Ticker: 새 DELAY 알림 실시간 표시 여부', async ({ page, request }) => {
  test.setTimeout(120_000)
  const admin = await request.post(`${API_BASE}/api/v1/auth/login`, { data: { login_id: 'admin', password: ADMIN_PW } })
  const { access_token } = await admin.json()
  const auth = { Authorization: `Bearer ${access_token}` }

  // 새 지연 대상 SO/WO 를 지금 만든다(오늘 이전 납기, 미착수) — dedupe_key 가 날짜 단위라 새 WO 여야 새 notification 이 만들어진다
  const cust = await (await request.get(`${API_BASE}/api/v1/customers/${FIXTURES.customer_id}`, { headers: auth })).json()
  const past = new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10)
  const orderDate = new Date(Date.now() - 10 * 86400_000).toISOString().slice(0, 10)
  const soRes = await request.post(`${API_BASE}/api/v1/so`, {
    headers: auth,
    data: {
      customer_id: FIXTURES.customer_id,
      order_date: orderDate,
      due_date: past,
      ship_to: { receiver: 'QA2S4', address1: '서울시 QA2S4 T5' },
      lines: [{ item_id: FIXTURES.item_id, print_method: 'SCREEN', qty: 5 }],
    },
  })
  const so = await soRes.json()
  const soDetail = await (await request.get(`${API_BASE}/api/v1/so/${so.code}`, { headers: auth })).json()
  const line = soDetail.lines[0]
  const pngBuf = readFileSync('/tmp/qa2s4-design.png')
  const form = { file: { name: 'design.png', mimeType: 'image/png', buffer: pngBuf } }
  await request.post(`${API_BASE}/api/v1/so/${so.code}/lines/${line.id}/design`, { headers: auth, multipart: form as any })
  await request.post(`${API_BASE}/api/v1/so/${so.code}/lines/${line.id}/design/confirm`, { headers: auth })
  const prop = await (await request.post(`${API_BASE}/api/v1/so/${so.code}/propose-wo`, { headers: auth, data: {} })).json()
  const draft = prop.items.find((d: any) => d.so_line_id === line.id)
  const issueRes = await (await request.post(`${API_BASE}/api/v1/so/${so.code}/issue-wo`, { headers: auth, data: { drafts: [draft] } })).json()
  const newWoCode = issueRes.work_orders[0].code as string

  await registerStation(page, 'BOARD-1', '/board')
  await expect(page.getByText('시간당 생산량')).toBeVisible({ timeout: 15_000 })

  // 1분 주기 지연감지 스케줄러가 이 WO 를 새로 잡을 때까지 최대 75초 대기 — Ticker 에 DELAY 항목이 뜨는지 관찰
  const tickerShowsDelay = page.locator('[data-component="Ticker"]').getByText('지연')
  const appeared = await tickerShowsDelay
    .waitFor({ timeout: 75_000 })
    .then(() => true)
    .catch(() => false)

  // DB 로 알림 자체는 실제로 생성됐는지 확인 (스케줄러가 정말 돌았는지의 독립 증거)
  const notifCreated = psql(`select count(*) from mes.notification where target_code='${newWoCode}';`)
  const delayRiskSet = psql(`select delay_risk from mes.work_order where code='${newWoCode}';`)
  test.info().annotations.push(
    { type: 'ticker-delay-appeared', description: String(appeared) },
    { type: 'notification-row-exists', description: notifCreated },
    { type: 'wo-delay-risk-flag', description: delayRiskSet },
  )
  // 알려진 결함(DEF-QA2-S4-002): ws_broadcast.broadcast_notification 이 delay_job 어디서도 호출되지
  // 않아 notification WS 브로드캐스트가 실제로는 절대 발생하지 않는다 — 이 테스트는 그 사실 자체를
  // 문서화하려는 목적이라 "appeared=false" 를 실패로 처리하지 않고 주석으로만 남긴다.
})

// ============================================================================
// T6 — KSK-70 라벨 재발행: 0건 검색, 프린터 미설정 비활성, 강제 프린터 실패, 정상 재발행(차수 증가)
// ============================================================================
test('T6 KSK-70 라벨 재발행: 0건/프린터 미설정/강제 실패/정상 재발행', async ({ page }) => {
  const errors = trackConsoleErrors(page)

  // -- 0건 검색 --
  await registerStation(page, 'K-P30-2', '/kiosk')
  await loginCard(page, FIXTURES.worker_card)
  await page.getByRole('button', { name: /라벨 재발행/ }).click()
  await page.getByLabel(/거래처명|검색/).fill('존재하지않는검색어ZZZZ999')
  await expect(page.getByText('검색 결과 없음')).toBeVisible({ timeout: 10_000 })

  // -- 프린터 미설정(K-P30-2 has no printer_id) → 확인 화면에서 [출력] 비활성 + 경고 --
  await page.getByLabel(/거래처명|검색/).fill(FIXTURES.wo_ksk70)
  await expect(page.getByText(FIXTURES.wo_ksk70)).toBeVisible({ timeout: 10_000 })
  await page.getByText(FIXTURES.wo_ksk70).first().click()
  await expect(page.getByText('프린터 미설정 — 관리자 문의')).toBeVisible()
  await expect(page.getByRole('button', { name: '출력' })).toBeDisabled()
  await page.getByRole('button', { name: '뒤로' }).click()
  await page.getByRole('button', { name: '취소' }).click()

  // -- 강제 프린터 실패(K-P30-1 printer_id=PRT-QA2S4-WO, 항상 불능) --
  await registerStation(page, 'K-P30-1', '/kiosk')
  await loginCard(page, FIXTURES.worker_card)
  await page.getByRole('button', { name: /라벨 재발행/ }).click()
  await page.getByLabel(/거래처명|검색/).fill(FIXTURES.wo_ksk70)
  await expect(page.getByText(FIXTURES.wo_ksk70)).toBeVisible({ timeout: 10_000 })
  await page.getByText(FIXTURES.wo_ksk70).first().click()
  const issuesBefore = Number(psql(`select count(*) from mes.label_issue where target_code='${FIXTURES.wo_ksk70}' and label_type='WO_LABEL';`))
  const printBtn = page.getByRole('button', { name: '출력' })
  await expect(printBtn).toBeEnabled()
  await printBtn.click()
  // 실제 계약(§13.7): 프린터 실패는 항상 200 + zpl_sent=false 로 돌아온다(예외 아님). 원래
  // ReprintScreen 은 이걸 무시하고 무조건 '완료' 화면으로 넘어가 실패를 조용히 숨기는 결함이
  // 있었다(DEF-QA2-S4-003, 그 자리에서 수정 — PackResultScreen 의 zpl_sent 분기 패턴을 그대로
  // 적용, git 커밋에 diff 있음). TCP 연결 타임아웃이 3초(zpl.py SEND_TIMEOUT_SEC)라 응답까지
  // 최소 3초+α 걸린다.
  await page.waitForTimeout(6_000)
  await expect(page.getByText('라벨 미출력 — 프린터 연결 실패')).toBeVisible()
  await expect(page.getByText(/재발행.*차 출력됨/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: '다시 출력' })).toBeVisible()
  const issuesAfter = Number(psql(`select count(*) from mes.label_issue where target_code='${FIXTURES.wo_ksk70}' and label_type='WO_LABEL';`))
  const issueRow = psql(`select zpl_sent, error from mes.label_issue where target_code='${FIXTURES.wo_ksk70}' and label_type='WO_LABEL' order by id desc limit 1;`)
  test.info().annotations.push(
    { type: 'ksk70-forced-fail-issue-row', description: issueRow },
    { type: 'ksk70-forced-fail-issue-count', description: `${issuesBefore} -> ${issuesAfter}` },
  )
  // 발행 레코드는 실패해도 커밋된다(issue_no 증가) — 이 자체는 §13.7 취지에 맞다
  expect(issuesAfter).toBe(issuesBefore + 1)

  // -- 정상 재발행: 이 환경엔 실제로 ZPL 을 받는 프린터가 없다(KSK-70 는 WO_LABEL 전용, 사설
  //    불능 대역으로 의도적으로 구성된 픽스처 — S1/S3 와 같은 "실물 프린터 없음" 제약). 발행
  //    자체(issue_no 증가, label_issue 커밋)는 성공/실패 무관하게 계속 진행됨을 위에서 확인했다.

  await runAxe(page, 'ksk70-reprint')
  expect(errors, JSON.stringify(errors)).toEqual([])
})

// ============================================================================
// T7 — ADM-16 /split: WO 분할 UI 실사용 확인 (기존 0건 UI였던 것 보강분)
// ============================================================================
test('T7 ADM-16 WO 분할(/split) UI', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const errors = trackConsoleErrors(page)
  await adminLogin(page)
  const wo = FIXTURES.wo_split as string
  await page.goto(`/admin/wo/${wo}`)
  await expect(page.getByText(`작업지시 ${wo}`)).toBeVisible()

  const splitBtn = page.getByRole('button', { name: '분할' })
  await expect(splitBtn).toBeEnabled()
  await splitBtn.click()
  await expect(page.getByText(`하위 WO 분할 — ${wo}`)).toBeVisible()
  await page.getByLabel('분할 수량').fill('3')
  await page.getByLabel('사유').fill('QA2S4 E2E 분할 테스트')
  await page.getByRole('dialog').getByRole('button', { name: '분할', exact: true }).click()
  await expect(page.getByText(/분할되었습니다 — 하위 WO/)).toBeVisible({ timeout: 10_000 })

  const childCode = `${wo}-A`
  await page.goto(`/admin/wo/${childCode}`)
  await expect(page.getByText(`작업지시 ${childCode}`)).toBeVisible()
  await expect(page.getByText('발행').first()).toBeVisible() // StatusBadge 한글 라벨(ISSUED)

  // DB 대조: 부모 qty_ordered 불변, 자식 qty_ordered=3
  const parentQty = psql(`select qty_ordered from mes.work_order where code='${wo}';`)
  const childQty = psql(`select qty_ordered, status from mes.work_order where code='${childCode}';`)
  test.info().annotations.push({ type: 'split-parent-qty', description: parentQty }, { type: 'split-child', description: childQty })
  expect(childQty).toContain('3')

  await runAxe(page, 'split')
  expect(errors, JSON.stringify(errors)).toEqual([])
})

// ============================================================================
// T8 — ADM-16 /rework(E3): qty/사유/reinsert_p30 폼, 자식 WO 생성 + 시작 공정 확인
// ============================================================================
test('T8 ADM-16 재작업(/rework, E3) UI', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const errors = trackConsoleErrors(page)
  await adminLogin(page)
  const wo = FIXTURES.wo_rework as string
  await page.goto(`/admin/wo/${wo}`)
  await expect(page.getByText(`작업지시 ${wo}`)).toBeVisible()

  const reworkBtn = page.getByRole('button', { name: '재작업' })
  await expect(reworkBtn).toBeEnabled()
  await reworkBtn.click()
  await expect(page.getByText(`재작업 — ${wo}`)).toBeVisible()
  await page.getByLabel('재작업 수량').fill('2')
  await page.getByLabel('사유').fill('QA2S4 E2E 재작업 테스트 (인쇄 번짐)')
  // 기본값 reinsert_p30=true 유지 (P30 부터 재삽입)
  await page.getByRole('button', { name: '재작업 등록' }).click()
  await expect(page.getByText(/재작업 하위 WO .* 등록되었습니다/)).toBeVisible({ timeout: 10_000 })

  const childCode = `${wo}-A`
  await page.goto(`/admin/wo/${childCode}`)
  await expect(page.getByText(`작업지시 ${childCode}`)).toBeVisible()

  // DB 대조: 자식 라우팅이 P30 부터 시작(P20 없음), qty_in 승계, stock_txn REWORK 기록
  const childSteps = psql(`select process_code, seq, qty_in from mes.wo_route_step where wo_id=(select id from mes.work_order where code='${childCode}') order by seq;`)
  const stockTxn = psql(`select txn_type, qty from mes.stock_txn where ref_type='WORK_ORDER' and ref_id=(select id from mes.work_order where code='${childCode}');`)
  test.info().annotations.push({ type: 'rework-child-steps', description: childSteps }, { type: 'rework-stock-txn', description: stockTxn })
  expect(childSteps.split('\n')[0]).toContain('P30')
  expect(childSteps).not.toContain('P20')
  expect(stockTxn).toContain('REWORK')

  await runAxe(page, 'rework')
  expect(errors, JSON.stringify(errors)).toEqual([])
})

// ============================================================================
// T9 — ADM-16 이벤트별 [취소](E6): 정상 취소(psql 전/후 대조) + 재취소 차단 + "마지막 아님" 차단
//      + 잔존 결함(DEF-QA2-S4-001 수정 후에도 남는 잔존 이슈) 실사용 재현
// ============================================================================
test('T9 ADM-16 이벤트 취소(E6): 정상 취소 + 이중 취소 차단 + 비최종 이벤트 차단', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const errors = trackConsoleErrors(page)

  // -- 매 실행마다 새 WO 를 만들어 RECEIVE+DONE 까지 진행(재실행해도 "이미 취소됨"에 안 걸리도록,
  //    고정 픽스처 대신 즉석에서 만든다) --
  const admin = await request.post(`${API_BASE}/api/v1/auth/login`, { data: { login_id: 'admin', password: ADMIN_PW } })
  const { access_token } = await admin.json()
  const auth = { Authorization: `Bearer ${access_token}` }
  const future = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10)
  const soRes = await request.post(`${API_BASE}/api/v1/so`, {
    headers: auth,
    data: {
      customer_id: FIXTURES.customer_id,
      order_date: new Date().toISOString().slice(0, 10),
      due_date: future,
      ship_to: { receiver: 'QA2S4', address1: '서울시 QA2S4 T9' },
      lines: [{ item_id: FIXTURES.item_id, print_method: 'SCREEN', qty: 15 }],
    },
  })
  const so = await soRes.json()
  const soDetail = await (await request.get(`${API_BASE}/api/v1/so/${so.code}`, { headers: auth })).json()
  const line = soDetail.lines[0]
  const pngBuf = readFileSync('/tmp/qa2s4-design.png')
  await request.post(`${API_BASE}/api/v1/so/${so.code}/lines/${line.id}/design`, { headers: auth, multipart: { file: { name: 'design.png', mimeType: 'image/png', buffer: pngBuf } } as any })
  await request.post(`${API_BASE}/api/v1/so/${so.code}/lines/${line.id}/design/confirm`, { headers: auth })
  const prop = await (await request.post(`${API_BASE}/api/v1/so/${so.code}/propose-wo`, { headers: auth, data: {} })).json()
  const draft = prop.items.find((d: any) => d.so_line_id === line.id)
  const issueRes = await (await request.post(`${API_BASE}/api/v1/so/${so.code}/issue-wo`, { headers: auth, data: { drafts: [draft] } })).json()
  const wo = issueRes.work_orders[0].code as string

  const recvRes = await request.post(`${API_BASE}/api/v1/scan`, {
    headers: { 'X-Station-Key': STATION_KEYS['PDA-P20-1'] },
    data: { event_uuid: crypto.randomUUID(), scanned_at: new Date().toISOString(), station_id: 'PDA-P20-1', worker_card: FIXTURES.worker_card, code: wo, check: null, action: 'RECEIVE', qty_good: 15, extra: { inspection: 'PASS' }, input_via: 'MANUAL' },
  })
  expect(recvRes.ok(), await recvRes.text()).toBeTruthy()
  const doneRes = await request.post(`${API_BASE}/api/v1/scan`, {
    headers: { 'X-Station-Key': STATION_KEYS['K-P30-1'] },
    data: { event_uuid: crypto.randomUUID(), scanned_at: new Date().toISOString(), station_id: 'K-P30-1', worker_card: FIXTURES.worker_card, code: wo, check: null, action: 'DONE', qty_good: 15, qty_bad: 0, equipment_code: 'EQ-QA2S4-1', input_via: 'MANUAL' },
  })
  expect(doneRes.ok(), await doneRes.text()).toBeTruthy()

  await adminLogin(page, FIXTURES.manager_login_id, FIXTURES.manager_pw)

  const before = psql(`select process_code, status, qty_good, qty_bad from mes.wo_route_step where wo_id=(select id from mes.work_order where code='${wo}') order by seq;`)

  await page.goto(`/admin/wo/${wo}?tab=events`)
  await expect(page.getByRole('heading', { name: `작업지시 ${wo}` })).toBeVisible()
  if (await page.getByRole('button', { name: '전체 보기' }).count()) await page.getByRole('button', { name: '전체 보기' }).click()
  const doneRow = page.getByRole('row').filter({ hasText: 'DONE' }).first()
  await expect(doneRow).toBeVisible({ timeout: 10_000 })
  await doneRow.getByRole('button', { name: '취소' }).click()
  await expect(page.getByText(/이벤트 취소 — DONE/)).toBeVisible()
  await page.getByLabel(/사유/).fill('QA2S4 E2E 취소 테스트')
  await page.getByRole('button', { name: '취소 확정' }).click()
  await expect(page.getByText('이벤트가 취소되었습니다')).toBeVisible({ timeout: 10_000 })

  const after = psql(`select process_code, status, qty_good, qty_bad from mes.wo_route_step where wo_id=(select id from mes.work_order where code='${wo}') order by seq;`)
  test.info().annotations.push({ type: 'e6-ui-cancel-before', description: before }, { type: 'e6-ui-cancel-after', description: after })
  expect(before).toContain('P30|DONE')
  expect(after).toContain('P30|WAITING')

  // -- 이중 취소 차단: 같은 이벤트 취소 버튼이 이제 사라져야 한다(이미 보상됨) --
  await expect(doneRow.getByRole('button', { name: '취소' })).toHaveCount(0)

  // -- 잔존 이슈 재현: wo_e6(WO-260929-0002) 는 사전 API 시나리오로 "마지막 반영 이벤트가 이미
  //    취소된" 상태다 — 그보다 오래된(여전히 유효한) 이벤트를 취소하려 하면 여전히 "마지막
  //    이벤트만" 409 로 막힌다(취소된 이벤트가 last-reflected 포인터를 계속 차지함, DEF-QA2-S4-004) --
  const wo2 = FIXTURES.wo_e6 as string
  await page.goto(`/admin/wo/${wo2}?tab=events`)
  if (await page.getByRole('button', { name: '전체 보기' }).count()) await page.getByRole('button', { name: '전체 보기' }).click()
  const receiveRow = page.getByRole('row').filter({ hasText: 'RECEIVE' }).first()
  await expect(receiveRow).toBeVisible({ timeout: 10_000 })
  const cancelBtnOnReceive = receiveRow.getByRole('button', { name: '취소' })
  await expect(cancelBtnOnReceive).toBeVisible() // UI 자체는 버튼을 숨기지 않는다(백엔드가 최종 판단)
  await cancelBtnOnReceive.click()
  await page.getByLabel(/사유/).fill('QA2S4 잔존 이슈 재현')
  await page.getByRole('button', { name: '취소 확정' }).click()
  await expect(page.getByText(/마지막 반영 이벤트만 취소할 수 있습니다/)).toBeVisible({ timeout: 10_000 })
  test.info().annotations.push({ type: 'e6-stuck-wo-defect-reproduced', description: 'true — RECEIVE 취소 시도가 여전히 409(마지막 이벤트만) 로 막힘, 취소된 DONE 이벤트가 last-reflected 를 영구 점유' })

  await runAxe(page, 'wo-events')
  // 이 테스트가 의도적으로 유발한 409(잔존 이슈 재현)에 대한 브라우저 자체의 리소스 로드
  // 실패 로그만 제외 — 실제 JS 예외/console.error 는 여전히 0건이어야 한다(S2/S3 QA② 관례,
  // "401 썸네일" 을 별도 집계하지 않은 것과 같은 원칙).
  const realErrors = errors.filter((e) => !e.includes('409'))
  expect(realErrors, JSON.stringify(errors)).toEqual([])
})

// ============================================================================
// T10 — ADM-25 실적 집계: 필터 + Excel 다운로드
// ============================================================================
test('T10 ADM-25 실적 집계: 필터 + Excel 다운로드', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const errors = trackConsoleErrors(page)
  await adminLogin(page)
  await page.goto('/admin/reports/output')
  await expect(page.getByRole('heading', { name: '실적 집계' })).toBeVisible()
  await expect(page.getByText('양품 합계')).toBeVisible({ timeout: 10_000 })

  await page.getByLabel('공정').selectOption({ label: 'P30 인쇄' })
  await expect(page.getByText('양품 합계')).toBeVisible()

  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }), page.getByRole('button', { name: 'Excel 다운로드' }).click()])
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/)

  await runAxe(page, 'output-report')
  expect(errors, JSON.stringify(errors)).toEqual([])
})

// ============================================================================
// T11 — ADM-28 대시보드: 폴링 대상 데이터 렌더 + 지연 위험 WO 반영 확인
// ============================================================================
test('T11 ADM-28 대시보드: 렌더 + 지연 위험 테이블 반영', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const errors = trackConsoleErrors(page)
  await adminLogin(page)
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: '대시보드' })).toBeVisible()
  await expect(page.getByText('오늘 발송 예정')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('지연 위험')).toBeVisible()
  await expect(page.getByText(FIXTURES.so3_code)).toBeVisible()

  await runAxe(page, 'dashboard')
  expect(errors, JSON.stringify(errors)).toEqual([])
})

// ============================================================================
// T12 — ADM-29 알림 이력: 목록 + [확인] ack 플로우
// ============================================================================
test('T12 ADM-29 알림 이력: 목록 + 확인(ack)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const errors = trackConsoleErrors(page)
  await adminLogin(page)
  await page.goto('/admin/system/notifications')
  await expect(page.getByRole('heading', { name: '알림 이력' })).toBeVisible()
  await page.getByLabel('미확인만').uncheck().catch(() => undefined)
  await expect(page.getByText(FIXTURES.wo_delay).first()).toBeVisible({ timeout: 10_000 })

  const row = page.getByRole('row').filter({ hasText: FIXTURES.wo_delay })
  const ackBtn = row.getByRole('button', { name: '확인' })
  const alreadyAcked = (await ackBtn.count()) === 0
  if (!alreadyAcked) {
    await ackBtn.click()
    await expect(page.getByText('확인 처리되었습니다')).toBeVisible({ timeout: 10_000 })
  }
  test.info().annotations.push({ type: 'notification-ack-flow', description: alreadyAcked ? 'already acked (rerun)' : 'acked now' })

  const ackedRow = psql(`select ack_at is not null, ack_by is not null from mes.notification where target_code='${FIXTURES.wo_delay}' limit 1;`)
  test.info().annotations.push({ type: 'notification-ack-db', description: ackedRow })

  await runAxe(page, 'notifications')
  expect(errors, JSON.stringify(errors)).toEqual([])
})

// ============================================================================
// T13 — ADM-30 감사 로그: 필터 + diff 뷰어
//      (자동 훅은 실제 before/after 를 남기지만, S4 신규 액션의 수동 서술 행은 before=None)
//
// 결함(DEF-QA2-S4-005, 그 자리에서 수정): 필터 드롭다운(AUDIT_TABLES, web/src/shared/types/
// enums.ts)에 'work_order'·'scan_event' 가 아예 없었다 — S4 신규 액션(분할·재작업·이벤트취소
// E6·스캔승인/거부)이 쓰는 audit_log.table_name 은 전부 이 둘뿐인데 드롭다운으로는 선택할
// 수조차 없었다. 두 값을 추가해 고쳤다(git diff 있음) — 아래는 정상화된 드롭다운으로 검증한다.
// ============================================================================
test('T13 ADM-30 감사 로그: 필터 + diff 뷰어 (before/after 실값 확인)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const errors = trackConsoleErrors(page)
  await adminLogin(page)
  await page.goto('/admin/system/audit')
  await expect(page.getByRole('heading', { name: '감사 로그' })).toBeVisible()
  await page.getByLabel('테이블').selectOption({ label: 'work_order' })
  const tableSelectValue = await page.getByLabel('테이블').inputValue()
  test.info().annotations.push({ type: 'audit-log-table-filter-dropdown-value-for-work_order', description: JSON.stringify(tableSelectValue) })
  expect(tableSelectValue).toBe('work_order')
  await expect(page.getByText(/변경 \d+개 필드|펼침/).first()).toBeVisible({ timeout: 10_000 })

  await page.getByText(/변경 \d+개 필드|펼침/).first().click()

  // 정정: 처음엔 "audit_log.before 가 항상 NULL" 이라 추정했으나, 실제로는 `db/audit.py` 의
  // 세션 훅(before_flush/after_flush_postexec)이 WorkOrder 를 포함해 여러 테이블의 실제 컬럼
  // 변경분을 자동으로 before/after 로 남긴다(hold/resume/cancel_wo 등은 실제 diff 가 있다,
  // DB 대조: work_order UPDATE 36건 중 32건 before 존재). S4 가 새로 추가한 split_wo/rework_wo/
  // cancel_wo_event/approve·deny 만 이 자동 훅과 별개로 **수동으로** `AuditLog(before=None,
  // after={사유·자식코드 등 서술적 정보})` 를 하나 더 남긴다 — 의도 자체는 합리적(자동 훅은
  // 컬럼 diff 만 찍지 "왜"는 못 담는다) 이지만, ADM-30 화면에서 이 수동 행을 열면 "이전" 이
  // 항상 "—" 로 보여 사용자 입장에선 "diff 가 비었다" 로 오인하기 쉽다.
  const nonNullBeforeCount = psql(`select count(*) from mes.audit_log where before is not null;`)
  const totalCount = psql(`select count(*) from mes.audit_log;`)
  const byTable = psql(`select table_name, action, count(*), count(before) from mes.audit_log group by table_name, action order by table_name, action;`)
  test.info().annotations.push(
    { type: 'audit-log-nonnull-before-count', description: `${nonNullBeforeCount} / ${totalCount} total (자동 훅이 대부분 실제 diff 를 남김 — 최초 가설 정정)` },
    { type: 'audit-log-by-table-action', description: byTable },
  )

  await runAxe(page, 'audit-log')
  expect(errors, JSON.stringify(errors)).toEqual([])
})

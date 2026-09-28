/**
 * QA② S3 실 브라우저 E2E — 입고(PDA P20)·인쇄(P30 키오스크 재검증)·포장(P50 키오스크, 프린터 실패 WARN
 * 포함)·발송(PDA P60) 골든 패스 + 오프라인 큐(PACK/SHIP) + 접근성 스팟체크.
 *
 * 전제: `outputs/qa-nonfunc-S3.md` §「재현 방법」 그대로 backend 8013 · vite 5186 · DB songwol_qr_qa2s3 기동,
 * 픽스처(SO/WO/설비/프린터/사용자)는 스크립트로 API 선반영(FIXTURES_JSON 환경변수 경로). 코드/체크코드는
 * §16.2 MANUAL 입력(IDLE 화면의 "카메라 스캔 / 직접 입력" → 직접 입력)로 대부분 우회하고, MappingScreen 처럼
 * 수기 입력 다이얼로그가 없는 화면만 HID 키보드 시뮬레이션 + 체크코드(HMAC-SHA256 base32 4자, backend
 * app/core/checkcode.py 와 동일 알고리즘)를 계산해 쓴다.
 *
 * 단말 전환(예: PDA 입고 -> P30 키오스크 -> P50 키오스크 -> PDA 발송)은 같은 `page` 를 재사용해 `/setup` 으로
 * 재등록 후 해당 앱 경로로 이동한다(새 탭을 열지 않는다 — 여러 탭을 동시에 열면 HID 키보드 시뮬레이션 이벤트가
 * 비활성 탭에 안정적으로 전달되지 않는 경우가 있었다, 실측 확인됨).
 */
import { test, expect, type Page } from '@playwright/test'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

const FIXTURES = JSON.parse(readFileSync(process.env.FIXTURES_JSON!, 'utf8'))
const STATION_KEYS: Record<string, string> = JSON.parse(readFileSync(process.env.STATION_KEYS_JSON!, 'utf8'))
const CHECKCODE_SECRET = process.env.CHECKCODE_SECRET!
const API_BASE = process.env.E2E_API ?? 'http://localhost:8013'

function checkCode(code: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const digest = createHmac('sha256', CHECKCODE_SECRET).update(code, 'utf8').digest()
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of digest) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  return out.slice(0, 4)
}

async function registerStation(page: Page, stationId: string, appPath: '/pda' | '/kiosk') {
  const key = STATION_KEYS[stationId]
  await page.goto(`/setup?s=${stationId}&k=${key}&v=1`)
  await page.getByRole('button', { name: new RegExp(`이 기기를 ${stationId} 로 등록`) }).click()
  await expect(page.getByText('단말 등록 완료')).toBeVisible()
  await page.goto(appPath)
}

/** HID 스캐너 흉내 — 문자 사이 15ms 간격(useScannerInput gapMs=50 이내) + Enter */
async function hidScan(page: Page, text: string) {
  await page.keyboard.type(text, { delay: 15 })
  await page.keyboard.press('Enter')
}

async function loginCard(page: Page, cardCode: string) {
  await expect(page.getByText('카드가 없어요')).toBeVisible()
  await hidScan(page, cardCode)
  await expect(page.getByRole('button', { name: '카메라 스캔 / 직접 입력' })).toBeVisible({ timeout: 10_000 })
}

/** IDLE 화면의 "카메라 스캔 / 직접 입력" → 직접 입력 전환 → 코드 입력 → 확인 (§16.2 MANUAL, 체크코드 불필요) */
async function manualScan(page: Page, code: string) {
  await page.getByRole('button', { name: '카메라 스캔 / 직접 입력' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '직접 입력으로 전환' }).click()
  await dialog.getByPlaceholder(/^예:/).fill(code)
  await dialog.getByRole('button', { name: '확인' }).click()
}

/** 단일/다중 NumPad 숫자 버튼 클릭 (exact 텍스트 매치 — 숫자 버튼은 화면에 하나뿐이다).
 * 항상 [C](지우기) 먼저 누른다 — P50 포장 등 일부 화면은 필드가 기본값(남은 수량 전량)으로 미리 채워져
 * 있어(controlled value), 지우지 않고 숫자를 이어 치면 max 상한에 걸려 조용히 무시된다(실측 확인됨). */
async function numpadType(page: Page, digits: string) {
  await page.getByRole('button', { name: '지우기', exact: true }).click()
  for (const d of digits) {
    await page.getByRole('button', { name: d, exact: true }).click()
  }
}

test.describe.configure({ mode: 'serial' })

// ============================================================================
// T1 — 골든 패스: PDA 입고(P20) → P30 키오스크 DONE(재검증) → P50 포장(프린터 실패 WARN+재출력)
//      → PDA 발송(P60, cross-SO 경고+빼기)
// ============================================================================
test('T1 골든 패스: 입고 -> 인쇄 -> 포장(프린터 실패) -> 발송', async ({ page }) => {
  const wo = FIXTURES.wo_main as string
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err)))

  // --- PDA 입고 (P20) ---
  await registerStation(page, 'PDA-P20-1', '/pda')
  await loginCard(page, FIXTURES.worker.card_code)
  await manualScan(page, wo)

  await expect(page.getByText(wo)).toBeVisible()
  await numpadType(page, '100')
  await page.getByRole('radio', { name: '합격', exact: true }).click()
  const receiveConfirm = page.getByRole('button', { name: '입고 확정' }).last()
  await expect(receiveConfirm).toBeEnabled()
  await receiveConfirm.click()

  await expect(page.getByText(/입고 완료했습니다/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/LOT/)).toBeVisible()
  await page.getByRole('button', { name: '확인' }).click()

  // --- P30 키오스크 DONE (재검증) ---
  await registerStation(page, 'K-P30-1', '/kiosk')
  await loginCard(page, FIXTURES.worker.card_code)
  await manualScan(page, wo)
  await expect(page.getByText(wo)).toBeVisible()
  // 설비 1개뿐이라 자동 선택됨 — [완료] 활성화 대기
  const p30Confirm = page.getByRole('button', { name: '완료' })
  await expect(p30Confirm).toBeEnabled({ timeout: 10_000 })
  await p30Confirm.click()
  await page.getByRole('button', { name: '양품 전량' }).click()
  await page.getByRole('button', { name: '확인', exact: true }).click()
  await expect(page.getByText(/완료 처리했습니다/)).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '확인' }).click()

  // --- P50 키오스크 포장 (프린터가 고장난 사설 IP뿐이라 항상 PRINTER_UNREACHABLE 강제) ---
  await registerStation(page, 'K-P50-1', '/kiosk')
  await loginCard(page, FIXTURES.worker.card_code)
  await manualScan(page, wo)
  await expect(page.getByText(wo)).toBeVisible()
  // 박스당 입수 — 60 + 40 (2박스로 나눠 포장, PDA 발송에서 여러 박스 목록 테스트에 쓴다)
  await numpadType(page, '60')
  await page.getByRole('button', { name: /포장 — 박스 라벨 출력/ }).click()
  await expect(page.getByText(/라벨 미출력/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: '라벨 재출력' })).toBeVisible()
  const boxCodeEl1 = page.locator('span.font-mono', { hasText: /^LT-/ }).first()
  const box1 = (await boxCodeEl1.textContent())!.trim()
  // 재출력 시도 — 여전히 실패해도 화면이 죽지 않는지 확인
  await page.getByRole('button', { name: '라벨 재출력' }).click()
  await expect(page.getByText(/라벨 미출력/)).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '다음 박스' }).click()

  await expect(page.getByText(/남은 수량/)).toBeVisible()
  await numpadType(page, '40')
  await page.getByRole('button', { name: /포장/ }).click()
  await expect(page.getByText(/라벨 미출력/)).toBeVisible({ timeout: 15_000 })
  const boxCodeEl2 = page.locator('span.font-mono', { hasText: /^LT-/ }).first()
  const box2 = (await boxCodeEl2.textContent())!.trim()
  await expect(page.getByText(/포장 완료 — 발송 대기/)).toBeVisible()
  await page.getByRole('button', { name: '완료' }).click()

  // --- PDA 발송 (P60) — 2박스 스캔 + cross-SO 박스 경고 후 빼기 + 발송 확정 ---
  await registerStation(page, 'PDA-P60-1', '/pda')
  await loginCard(page, FIXTURES.worker.card_code)
  // 첫 박스는 IDLE 의 "카메라 스캔 / 직접 입력"(수기), 이후 박스는 phase=BOXES 라 그 버튼이 없다 —
  // 실제 PDA-20 UX 그대로 전역 HID 스캐너 구독(useScannerInput)이 계속 살아있는 경로를 쓴다(§2 PDA-20 "연속 스캔").
  // 박스 코드는 평문(LT-YYMMDD-NNNN)만으로 `stationApi.box()` 조회가 되므로 체크코드는 필요 없다.
  await manualScan(page, box1)
  await expect(page.getByText(box1)).toBeVisible()
  await hidScan(page, box2)
  await expect(page.getByText(box2)).toBeVisible()

  // cross-SO 박스(WO_cross, 이미 API 로 포장됨) 를 같은 목록에 추가 — 경고가 뜨는지, 발송을 막지는 않는지 확인
  const crossBoxCode = FIXTURES.wo_cross_box as string
  await hidScan(page, crossBoxCode)
  await expect(page.getByText(/다른 수주.*박스입니다.*송장이 분리/)).toBeVisible()
  // [빼기] 로 cross-SO 박스는 제거 — WO_main SO 만 발송해 골든 패스를 깔끔히 완결
  await page.getByRole('button', { name: `${crossBoxCode} 빼기` }).click()
  await expect(page.getByText(/다른 수주/)).toHaveCount(0)

  await page.getByRole('button', { name: '다음: 송장 입력' }).click()
  await page.getByLabel('송장번호').fill('QA2S3-TRACK-0001')
  await page.getByRole('button', { name: '발송 확정' }).click()
  const shipResultOrSave = page.getByText(/발송 확정|저장됨.*미전송/).first()
  await expect(shipResultOrSave).toBeVisible({ timeout: 15_000 })
  const shipCards = await page.getByText(/발송 확정 —/).allTextContents()
  test.info().annotations.push({ type: 'ship-result-cards', description: JSON.stringify(shipCards) })

  // --- 관리자 API 로 최종 상태 대조 ---
  const admin = await page.request.post(`${API_BASE}/api/v1/auth/login`, { data: { login_id: 'admin', password: process.env.ADMIN_PW } })
  const { access_token } = await admin.json()
  const woResp = await page.request.get(`${API_BASE}/api/v1/wo/${wo}`, { headers: { Authorization: `Bearer ${access_token}` } })
  const woJson = await woResp.json()
  test.info().annotations.push({ type: 'wo-final-status', description: JSON.stringify({ status: woJson.status, qty_shipped: woJson.qty_shipped }) })

  test.info().annotations.push({ type: 'box1', description: box1 }, { type: 'box2', description: box2 })

  // 골든 패스 전체(4개 단말 전환 포함)에서 진짜 콘솔 오류 0건 확인. 401(도안 썸네일 등) 은 브라우저가 자동
  // 기록하는 리소스 로드 실패라 console.error 로 잡히지 않는다 — S2 QA 컨벤션과 동일(별도 집계 없음, 여기선 0건).
  test.info().annotations.push({ type: 'console-errors', description: JSON.stringify(consoleErrors) })
  expect(consoleErrors, JSON.stringify(consoleErrors)).toEqual([])
})

// ============================================================================
// T2 — PDA 입고: 미매핑 업체바코드 → 매핑 화면(HID, 체크코드) → 재스캔(직접입력) 해소
// ============================================================================
test('T2 PDA 입고: VB 매핑 미등록 -> 매핑 저장 -> 재스캔 해소', async ({ page }) => {
  const wo = FIXTURES.wo_vb as string
  const vb = FIXTURES.vendor_barcode as string

  await registerStation(page, 'PDA-P20-1', '/pda')
  await loginCard(page, FIXTURES.worker.card_code)

  await manualScan(page, vb)
  await expect(page.getByText('미등록 업체 바코드')).toBeVisible()
  await expect(page.getByText(vb)).toBeVisible()
  await expect(page.getByText('이어서 작업지시 QR 을 스캔하세요')).toBeVisible()

  // MappingScreen 에는 수기입력 다이얼로그가 없다 — HID 로 q-landing URL(+체크코드) 을 스캔한다
  const origin = new URL(page.url()).origin
  await hidScan(page, `${origin}/q/${wo}?c=${checkCode(wo)}`)
  await expect(page.getByText(wo)).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '매핑 저장' }).click()

  // 매핑 저장 성공 시 바로 ENTRY 화면으로 진행한다 (MAP 이벤트 + goToEntry)
  await expect(page.getByText(/입고 누계/)).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '취소' }).click()

  // 재스캔 해소 확인: IDLE 에서 같은 VB 를 다시 스캔하면 매핑을 즉시 찾아 곧장 ENTRY 로 간다
  await expect(page.getByRole('button', { name: '카메라 스캔 / 직접 입력' })).toBeVisible()
  await manualScan(page, vb)
  await expect(page.getByText('미등록 업체 바코드')).toHaveCount(0)
  await expect(page.getByText(/입고 누계/)).toBeVisible({ timeout: 10_000 })

  await numpadType(page, '60')
  await page.getByRole('radio', { name: '합격', exact: true }).click()
  await page.getByRole('button', { name: '입고 확정' }).last().click()
  await expect(page.getByText(/입고 완료했습니다/)).toBeVisible({ timeout: 15_000 })
})

// ============================================================================
// T3 — PDA 입고: 검수 불합격(FAIL) -> LOT 격리 메모
// ============================================================================
test('T3 PDA 입고: FAIL -> 격리 메모', async ({ page }) => {
  const wo = FIXTURES.wo_fail as string
  await registerStation(page, 'PDA-P20-1', '/pda')
  await loginCard(page, FIXTURES.worker.card_code)
  await manualScan(page, wo)
  await expect(page.getByText(wo)).toBeVisible()

  await numpadType(page, '40')
  await page.getByRole('radio', { name: '불합격' }).click()
  await expect(page.getByText('이 LOT 은 격리되고 입고 누계에 포함되지 않습니다')).toBeVisible()
  await page.getByRole('button', { name: '입고 확정' }).last().click()

  await expect(page.getByText('격리(QUARANTINE) — 입고 누계 미포함')).toBeVisible({ timeout: 15_000 })

  // DEF-QA2-S3-002 재현: RECEIVE(FAIL) 이 LOT 을 이미 QUARANTINE 으로 자동 격리해 두기 때문에(메모 없이),
  // 이 화면의 [격리 메모 저장](POST /lots/{code}/quarantine) 은 항상 409("이미 격리된 LOT 입니다")로 실패한다
  // — FAIL 격리의 정상 경로에서 매번 재현되는 결함이라 "저장됨"이 아니라 이 실패를 단언해 문서화한다.
  await page.getByPlaceholder('격리 메모 (선택)').fill('QA2S3 자동화 테스트 — FAIL 격리 메모')
  await page.getByRole('button', { name: '격리 메모 저장' }).click()
  await expect(page.getByText('이미 격리된 LOT 입니다')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('격리 메모 저장됨')).toHaveCount(0)
})

// ============================================================================
// T4 — P50 포장: 직전 공정(P30) 미완료(PARTIAL) 경고 배너 확인
// ============================================================================
// 관찰(DEF-QA2-S3-003): 배너 문구는 "포장 시 반장 승인이 필요합니다"라고 예고하지만, 실제로는 반장 승인이
// 걸리지 않는다 — engine.py STEP_PREV_BLOCKING = {WAITING, STARTED} 뿐이라 P30=PARTIAL 인 직전 단계는
// 막지 않는다(§4.3 E1 의 "직전 공정 미완료"는 WAITING/STARTED 만 해당). 또한 P30 이 정말 WAITING(전혀
// 손대지 않음)이면 wo.qty_good=0 이라 NumPad 자체가 "포장 완료된 작업지시입니다"로 비활성화돼 버튼을 누를
// 수조차 없다 — 결과적으로 이 배너 뒤에 있어야 할 승인 게이트는 현재 코드로는 통해서 갈 수 있는 경로가
// 없다(WAITING 은 화면이 막고, PARTIAL 은 엔진이 막지 않는다). 아래는 실제로 일어나는 일(경고만 뜨고 그대로
// 진행)을 그대로 단언한다 — 문구와 실제 동작 불일치는 보고서에 기록.
test('T4 P50 포장: P30 미완료(PARTIAL) 경고 -> 승인 없이 그대로 진행됨', async ({ page }) => {
  const wo = FIXTURES.wo_e1 as string
  await registerStation(page, 'K-P50-1', '/kiosk')
  await loginCard(page, FIXTURES.worker.card_code)
  await manualScan(page, wo)

  await expect(page.getByText('직전 공정(인쇄) 미완료 — 포장 시 반장 승인이 필요합니다')).toBeVisible()
  await numpadType(page, '40')
  await page.getByRole('button', { name: /포장 — 박스 라벨 출력/ }).click()

  // 실제 동작: 승인 다이얼로그 없이 곧장 결과 화면으로 간다(프린터도 고장난 상태라 WARN)
  await expect(page.getByText('반장 승인 필요')).toHaveCount(0)
  await expect(page.getByText(/포장 완료했습니다|박스.*장/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/라벨 미출력/)).toBeVisible()
})

// ============================================================================
// T5 — 오프라인 포장(P50): 오프라인 중 박스 커밋(#n) -> 온라인 복귀 자동 flush(자동 출력 시도)
// ============================================================================
test('T5 오프라인 포장 -> 온라인 복귀 자동 flush', async ({ page, context }) => {
  const wo = FIXTURES.wo_off_pack as string
  await registerStation(page, 'K-P50-1', '/kiosk')
  await loginCard(page, FIXTURES.worker.card_code)
  await manualScan(page, wo)
  await expect(page.getByText(wo)).toBeVisible()

  await context.setOffline(true)
  await numpadType(page, '60')
  await page.getByRole('button', { name: /포장/ }).click()

  await expect(page.getByText(/저장됨.*미전송/).first()).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '확인' }).click()
  await expect(page.getByText(/미전송 1건|미전송 1 건/)).toBeVisible({ timeout: 10_000 })

  await context.setOffline(false)
  await expect(page.getByText(/미전송 1건|미전송 1 건/)).toHaveCount(0, { timeout: 20_000 })

  const admin = await page.request.post(`${API_BASE}/api/v1/auth/login`, { data: { login_id: 'admin', password: process.env.ADMIN_PW } })
  const { access_token } = await admin.json()
  const woResp = await page.request.get(`${API_BASE}/api/v1/wo/${wo}`, { headers: { Authorization: `Bearer ${access_token}` } })
  const woJson = await woResp.json()
  test.info().annotations.push({ type: 'offline-pack-wo', description: JSON.stringify({ status: woJson.status, qty_packed: woJson.qty_packed, boxes: woJson.boxes.length }) })
  expect(woJson.status).toBe('PACKED')
  expect(woJson.qty_packed).toBe(60)
  expect(woJson.boxes.length).toBe(1)
})

// ============================================================================
// T6 — 오프라인 발송(P60): 박스 조회 불가(offline row) -> 배치 저장 -> 온라인 복귀 자동 flush 정합
// ============================================================================
test('T6 오프라인 발송 -> 온라인 복귀 자동 flush 정합', async ({ page, context }) => {
  const box = FIXTURES.wo_off_ship_box as string
  await registerStation(page, 'PDA-P60-1', '/pda')
  await loginCard(page, FIXTURES.worker.card_code)

  await context.setOffline(true)
  await manualScan(page, box)
  await expect(page.getByText('오프라인 — 박스 정보 확인 불가').first()).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '다음: 송장 입력' }).click()
  await page.getByLabel('송장번호').fill('QA2S3-OFFLINE-TRACK-0001')
  await page.getByRole('button', { name: '발송 확정' }).click()
  await expect(page.getByText(/저장됨.*미전송/).first()).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '확인' }).last().click()

  await context.setOffline(false)
  await expect(page.getByRole('button', { name: '카메라 스캔 / 직접 입력' })).toBeVisible({ timeout: 20_000 })
  // "카메라 스캔/직접 입력"이 보이는 건 IDLE 화면일 뿐, flush 완료를 보장하지 않는다 — 미전송 배지가
  // 사라질 때까지 기다린다(§0.6, T5 와 같은 패턴).
  await expect(page.getByText(/미전송 1건|미전송 1 건/)).toHaveCount(0, { timeout: 20_000 })

  const admin = await page.request.post(`${API_BASE}/api/v1/auth/login`, { data: { login_id: 'admin', password: process.env.ADMIN_PW } })
  const { access_token } = await admin.json()
  const boxResp = await page.request.get(`${API_BASE}/api/v1/boxes/${box}`, { headers: { Authorization: `Bearer ${access_token}` } })
  const boxJson = await boxResp.json()
  test.info().annotations.push({ type: 'offline-ship-box-shipment', description: JSON.stringify(boxJson.shipment) })
  expect(boxJson.shipment).not.toBeNull()
  expect(boxJson.shipment.tracking_no).toBe('QA2S3-OFFLINE-TRACK-0001')
  expect(boxJson.shipment.status).toBe('SHIPPED')
})

// ============================================================================
// T7 — 접근성(axe) 스팟체크: PDA 입고 입력(TriChoice) · PDA 발송 목록(ScanList) · 송장 입력(TextEntry)
// ============================================================================
test('T7 접근성(axe) 스팟체크: TriChoice/ScanList/TextEntry', async ({ page }) => {
  const AxeBuilder = (await import('@axe-core/playwright')).default
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => consoleErrors.push(String(err)))

  await registerStation(page, 'PDA-P20-1', '/pda')
  await loginCard(page, FIXTURES.worker.card_code)
  await manualScan(page, FIXTURES.wo_fail as string)
  await expect(page.getByText(FIXTURES.wo_fail)).toBeVisible()

  const a1 = await new AxeBuilder({ page }).include('main, body').analyze()
  const serious1 = a1.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  test.info().annotations.push({ type: 'axe-receive-entry', description: JSON.stringify(serious1.map((v) => v.id)) })
  expect(serious1, JSON.stringify(serious1, null, 2)).toEqual([])

  await registerStation(page, 'PDA-P60-1', '/pda')
  await loginCard(page, FIXTURES.worker.card_code)
  await manualScan(page, FIXTURES.wo_cross_box as string)
  await expect(page.getByText(FIXTURES.wo_cross_box)).toBeVisible()
  const a2 = await new AxeBuilder({ page }).include('main, body').analyze()
  const serious2 = a2.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  test.info().annotations.push({ type: 'axe-boxscan', description: JSON.stringify(serious2.map((v) => v.id)) })
  expect(serious2, JSON.stringify(serious2, null, 2)).toEqual([])

  await page.getByRole('button', { name: '다음: 송장 입력' }).click()
  const a3 = await new AxeBuilder({ page }).include('main, body').analyze()
  const serious3 = a3.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  test.info().annotations.push({ type: 'axe-tracking', description: JSON.stringify(serious3.map((v) => v.id)) })
  expect(serious3, JSON.stringify(serious3, null, 2)).toEqual([])

  expect(consoleErrors, JSON.stringify(consoleErrors)).toEqual([])
})

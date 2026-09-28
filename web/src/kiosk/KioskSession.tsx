/**
 * 키오스크 세션 — 로그인 이후 상태 머신을 한 컴포넌트가 소유한다 (screens-shopfloor §1.0).
 * 화면 조각은 `screens/*` 로 나눴지만 "현재 화면 + 스캔한 WO + 수량" 상태는 전부 여기서 관리한다 —
 * 일반화된 FSM 라이브러리 없이, KSK-10~61 의 전이만 `phase` 로 표현한다.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { stationApi } from '@/shared/api'
import { isApiError } from '@/shared/api/client'
import { parseScanCode, useIdleLogout, useScannerInput, useWakeLock } from '@/shared/hooks'
import { nextClientSeq, recordPackConfirmations, submitScan, useOfflineQueue, usePackLabelConfirmations, type FlushedEntry } from '@/shared/offline'
import { IdleScreen, QueueList, WarnBannerList, type EquipmentOption, type QueueItem as UiQueueItem, type ScanResultVariant, type WarnBannerEntry } from '@/shared/ui/shopfloor'
import { IconTag } from '@/shared/ui/icons'
import { DeviceChrome } from '@/shared/device/DeviceChrome'
import { CameraScanDialog } from '@/shared/device/CameraScanDialog'
import { LoginScreen } from '@/shared/device/LoginScreen'
import { ApprovalScreen } from '@/shared/device/ApprovalScreen'
import { PendingApprovalsScreen } from '@/shared/device/PendingApprovalsScreen'
import { PendingQueueScreen } from '@/shared/device/PendingQueueScreen'
import type { Equipment, InputVia, LoginVia, ParsedCode, PendingScan, QueueItem, QueueResponse, ScanResponse, Station, UserSummary, VarianceReasonCode, WorkOrderDetail } from '@/shared/types'
import { buildDoneScanRequest, defaultGoodQty, isToleranceExceeded, newEventUuid, nowKstIso, scanResultVariant } from './kioskLogic'
import { buildPackScanRequest, computeDefaultQtyBox, packConfirmationsFromFlush, packRemainingQty, readRememberedPackQtyBox, rememberPackQtyBox } from './packLogic'
import { ScannedScreen } from './screens/ScannedScreen'
import { QtyScreen } from './screens/QtyScreen'
import { ReasonScreen } from './screens/ReasonScreen'
import { ConfirmScreen } from './screens/ConfirmScreen'
import { ResultScreen } from './screens/ResultScreen'
import { PackScannedScreen } from './screens/PackScannedScreen'
import { PackResultScreen } from './screens/PackResultScreen'
import { PackLabelConfirmScreen } from './screens/PackLabelConfirmScreen'
import { ReprintScreen } from './screens/ReprintScreen'

type Phase =
  | 'IDLE'
  | 'SCANNED'
  | 'QTY'
  | 'REASON'
  | 'CONFIRM'
  | 'RESULT'
  | 'APPROVAL'
  | 'PENDING_APPROVALS'
  | 'PENDING_QUEUE'
  | 'PACK_SCANNED'
  | 'PACK_RESULT'
  | 'PACK_LABEL_CONFIRM'
  | 'REPRINT'

type ScannedCode = { code: string; check: string | null; inputVia: InputVia }
type ResultData =
  | { kind: 'response'; variant: ScanResultVariant; response: ScanResponse }
  // clientSeq 는 P50 오프라인 저장일 때만 채운다 — §13.7 ⑬ "#n"(박스에 수기로 적는 임시 번호)
  | { kind: 'saved'; pendingCount: number; clientSeq?: number }
type ApprovalCtx = { eventUuid: string; approvalToken: string | null; message: string }

function equipmentOptionsOf(list: Equipment[]): EquipmentOption[] {
  return list.filter((e) => e.active).map((e) => ({ code: e.code, name: e.name, equipType: e.equip_type }))
}

function woDetailFromQueueItem(item: QueueItem, processCode: string, processName: string): WorkOrderDetail {
  // 오프라인 캐시 대체 카드 — 타임라인·오차 판정에 필요한 정보가 부족하므로 tolerance/qty_in 은 비워
  // 화면이 "판정 불가 → 바로 전송" 경로를 타게 한다 (screens-shopfloor §13 스캔 엔진 개발자 전제 3).
  // 단일 fake step 은 이 단말의 공정(P30 또는 P50)으로 라벨링한다 — 둘 다 같은 함수를 쓴다.
  return {
    ...item.wo,
    steps: [
      {
        id: 0,
        seq: item.wo.current_step_seq ?? 1,
        process_code: processCode,
        process_name: processName,
        std_lead_hours: 0,
        tolerance_pct: 0,
        status: item.step_status,
        started_at: null,
        done_at: null,
        qty_in: null,
        qty_good: null,
        qty_bad: null,
        equipment: null,
        worker: null,
        is_estimated: false,
        approved_by: null,
        variance_reason: null,
        works: [],
      },
    ],
    hold_reason: null,
    closed_at: null,
    recent_events: [],
    boxes: [],
    receipts: [],
    children: [],
  }
}

function toQueueListItems(items: QueueItem[]): UiQueueItem[] {
  return items.map((i) => ({
    code: i.wo.code,
    customerName: i.wo.customer_name,
    itemName: i.wo.item.name ?? '—',
    qty: i.qty_in,
    dueDate: i.due_date,
    isLate: i.delay_risk,
    stepStatus: i.step_status,
  }))
}

let bannerSeq = 0
function newBannerId(): string {
  bannerSeq += 1
  return `banner-${Date.now()}-${bannerSeq}`
}

export function KioskSession({ station, processName, bootOffline }: { station: Station; processName: string; bootOffline?: boolean }) {
  useWakeLock()

  // 공정 코드는 단말 고정(§0.2) — P30 은 DONE 흐름(KSK-20~61), P50 은 PACK 흐름(KSK-80/81). 같은
  // 코드베이스, 이 플래그 하나로 goToScanned·doSubmit 계열·승인 후 이동을 분기한다.
  const isP50 = station.process_code === 'P50'

  const [worker, setWorker] = useState<UserSummary | null>(null)
  const [, setLoginVia] = useState<LoginVia | null>(null)
  const [pendingLoginScan, setPendingLoginScan] = useState<ScannedCode | null>(null)

  const [phase, setPhase] = useState<Phase>('IDLE')
  const [scanned, setScanned] = useState<ScannedCode | null>(null)
  const [wo, setWo] = useState<WorkOrderDetail | null>(null)
  const [woLoading, setWoLoading] = useState(false)
  const [woError, setWoError] = useState<string | null>(null)
  const [woOfflineNoDetail, setWoOfflineNoDetail] = useState(false)

  const [equipmentOptions, setEquipmentOptions] = useState<EquipmentOption[]>([])
  const [equipmentCode, setEquipmentCode] = useState<string | null>(null)
  const lastEquipmentCacheRef = useRef<Equipment[]>([])

  const [qtyGood, setQtyGood] = useState('')
  const [qtyBad, setQtyBad] = useState('')
  const [reason, setReason] = useState<{ code: VarianceReasonCode | null; text: string }>({ code: null, text: '' })

  // P50 전용 — KSK-80 박스당 입수
  const [qtyBox, setQtyBox] = useState('')

  const [resultData, setResultData] = useState<ResultData | null>(null)
  const [approvalCtx, setApprovalCtx] = useState<ApprovalCtx | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)

  const [queueData, setQueueData] = useState<QueueResponse | null>(null)
  const [queueFetchedAt, setQueueFetchedAt] = useState<string | undefined>(undefined)

  const [banners, setBanners] = useState<WarnBannerEntry[]>([])
  const pushBanner = useCallback((entry: Omit<WarnBannerEntry, 'id'>) => setBanners((prev) => [...prev, { ...entry, id: newBannerId() }]), [])
  const dismissBanner = useCallback((id: string) => setBanners((prev) => prev.filter((b) => b.id !== id)), [])

  const bootOfflineNoticeShown = useRef(false)
  useEffect(() => {
    if (bootOffline && !bootOfflineNoticeShown.current) {
      bootOfflineNoticeShown.current = true
      pushBanner({ kind: 'offline', message: '오프라인 상태로 시작했습니다 — 마지막 캐시로 동작합니다' })
    }
  }, [bootOffline, pushBanner])

  // P50 전용 — 오프라인 포장 flush 로 커밋된 박스의 라벨 부착 확인 목록(§13.7 ⑬, DEF-QA2-S3-005)
  const packConfirm = usePackLabelConfirmations()
  const packConfirmRefreshRef = useRef<() => void>(() => {})
  packConfirmRefreshRef.current = packConfirm.refresh

  // refreshQueue 는 아래에서 선언되지만, handleFlushed 는 flush 가 실제로 끝난 뒤(다음 렌더 이후)에만
  // 호출되므로 선언 순서는 안전하다 — 상호 참조를 피하려고 ref 로 최신 함수만 담아 둔다.
  const refreshQueueRef = useRef<() => void>(() => {})
  const handleFlushed = useCallback(
    (entries: FlushedEntry[]) => {
      for (const { response, at } of entries) {
        if (response.duplicate) continue // §0.6 — 멱등 재전송 흡수는 표시하지 않는다
        if (response.result === 'WARN' && !response.requires_approval) {
          pushBanner({ kind: 'warning', message: response.message, at, woCode: response.wo?.code })
        } else if (response.result === 'REJECT') {
          pushBanner({ kind: 'error', message: response.message, at, woCode: response.wo?.code })
        }
      }
      if (entries.some((e) => e.response.requires_approval)) refreshQueueRef.current()

      // PACK 으로 실제 박스가 커밋된 건은(WARN 이라도, 예: 라벨 실패) 위 배너와 별개로 라벨 부착 확인
      // 목록에 쌓는다 — IndexedDB 에 저장해 [부착 완료] 전까지 새로고침에도 남는다(§13.7 ⑬)
      const packRows = packConfirmationsFromFlush(entries.map((e) => ({ event_uuid: e.event_uuid, client_seq: e.client_seq, response: e.response, at: e.at })))
      if (packRows.length > 0) {
        void recordPackConfirmations(packRows).then(() => packConfirmRefreshRef.current())
      }
    },
    [pushBanner],
  )
  const offlineQueue = useOfflineQueue(handleFlushed)

  const refreshQueue = useCallback(async () => {
    try {
      const res = await stationApi.queue(station.id, 8)
      setQueueData(res)
      setQueueFetchedAt(new Date().toISOString())
    } catch {
      // 오프라인 등 — 마지막 캐시 유지 (§0.6 조회 API 오프라인)
    }
  }, [station.id])
  refreshQueueRef.current = () => void refreshQueue()

  useEffect(() => {
    if (!worker) return
    void refreshQueue()
    const t = window.setInterval(() => void refreshQueue(), 30_000) // api-contract §13.5 ㉗ 30초 폴링
    return () => window.clearInterval(t)
  }, [worker, refreshQueue])

  useEffect(() => {
    if (phase === 'IDLE') void refreshQueue()
  }, [phase, refreshQueue])

  const loadEquipment = useCallback(
    async (printMethod: string) => {
      try {
        const list = await stationApi.equipment(station.id, printMethod)
        lastEquipmentCacheRef.current = list
        setEquipmentOptions(equipmentOptionsOf(list))
      } catch {
        setEquipmentOptions(equipmentOptionsOf(lastEquipmentCacheRef.current))
      }
    },
    [station.id],
  )

  const goToScanned = useCallback(
    async (code: string, check: string | null, inputVia: InputVia) => {
      setScanned({ code, check, inputVia })
      setPhase(isP50 ? 'PACK_SCANNED' : 'SCANNED')
      setWo(null)
      setWoError(null)
      setWoOfflineNoDetail(false)
      setWoLoading(true)
      setEquipmentOptions([])
      setEquipmentCode(null)
      setQtyGood('')
      setQtyBad('')
      setQtyBox('')
      setReason({ code: null, text: '' })
      const applyDetail = (detail: WorkOrderDetail) => {
        if (isP50) {
          const remaining = packRemainingQty(detail)
          const def = computeDefaultQtyBox(readRememberedPackQtyBox(station.id), remaining)
          setQtyBox(def !== null ? String(def) : '')
        } else {
          void loadEquipment(detail.print_method)
        }
      }
      try {
        const detail = await stationApi.wo(code)
        setWo(detail)
        applyDetail(detail)
      } catch (e) {
        if (isApiError(e) && e.status === 404) {
          setWoError(e.message)
        } else {
          const cached = queueData?.items.find((i) => i.wo.code === code)
          if (cached) {
            const detail = woDetailFromQueueItem(cached, station.process_code ?? (isP50 ? 'P50' : 'P30'), processName)
            setWo(detail)
            setWoOfflineNoDetail(true)
            applyDetail(detail)
          }
          // 캐시도 없으면 wo=null 유지 → 화면이 코드만 보여준다
        }
      } finally {
        setWoLoading(false)
      }
    },
    [loadEquipment, queueData, isP50, station.id, station.process_code, processName],
  )

  const handleParsed = useCallback(
    (parsed: ParsedCode, inputVia: InputVia) => {
      if (parsed.type === 'WO') {
        void goToScanned(parsed.code, parsed.check, inputVia)
        return
      }
      if (parsed.type === 'US') {
        if (phase === 'IDLE') {
          // 작업자 교체 — 확인 없이(기본값). 재로그인 절차를 그대로 태운다
          setWorker(null)
          setPendingLoginScan(null)
        }
        return
      }
      if (isP50 && parsed.type === 'LT') {
        pushBanner({ kind: 'warning', message: '박스 QR 은 발송(P60)에서 스캔합니다' })
        return
      }
      pushBanner({ kind: 'warning', message: `이 단말에서는 처리할 수 없는 코드입니다 (${parsed.type})` })
    },
    [phase, goToScanned, pushBanner, isP50],
  )

  const scannerEnabled = Boolean(worker && worker.card_code)
  const scannerHold = phase === 'CONFIRM' || phase === 'APPROVAL'
  useScannerInput((parsed) => handleParsed(parsed, 'HID'), { enabled: scannerEnabled, hold: scannerHold })

  useIdleLogout(
    30 * 60 * 1000,
    () => {
      if (worker) {
        setWorker(null)
        setPhase('IDLE')
      }
    },
    { enabled: !!worker, onWarn: () => pushBanner({ kind: 'warning', message: '1분 후 자동 로그아웃 — 화면을 터치하면 연장됩니다' }) },
  )

  function onLoggedIn(w: UserSummary, via: LoginVia) {
    setWorker(w)
    setLoginVia(via)
    if (pendingLoginScan) {
      const p = pendingLoginScan
      setPendingLoginScan(null)
      void goToScanned(p.code, p.check, p.inputVia)
    } else {
      setPhase('IDLE')
    }
  }

  function logout() {
    setWorker(null)
    setPhase('IDLE')
  }

  async function doSubmit(good: number, bad: number, reasonCode: VarianceReasonCode | null, reasonText: string | null) {
    if (!wo || !equipmentCode || !worker || !scanned) return
    setPhase('CONFIRM')
    const req = buildDoneScanRequest({
      stationId: station.id,
      workerCard: worker.card_code ?? '',
      code: scanned.code,
      check: scanned.check,
      equipmentCode,
      qtyGood: good,
      qtyBad: bad,
      varianceReasonCode: reasonCode,
      varianceReasonText: reasonText,
      inputVia: scanned.inputVia,
      eventUuid: newEventUuid(),
      clientSeq: nextClientSeq(),
      scannedAt: nowKstIso(),
    })
    const outcome = await submitScan(req)
    if (outcome.status === 'ok') {
      const variant = scanResultVariant(outcome.response)
      if (variant === 'approval' && outcome.response.event_uuid) {
        setApprovalCtx({ eventUuid: outcome.response.event_uuid, approvalToken: outcome.response.approval_token, message: outcome.response.message })
        setPhase('APPROVAL')
        return
      }
      if (variant === 'warn') {
        pushBanner({ kind: 'warning', message: outcome.response.message, woCode: outcome.response.wo?.code, at: nowKstIso() })
      }
      setResultData({ kind: 'response', variant, response: outcome.response })
      setPhase('RESULT')
    } else if (outcome.status === 'invalid') {
      pushBanner({ kind: 'error', message: `요청 형식 오류: ${outcome.error.message}`, woCode: wo.code, at: nowKstIso() })
      setPhase('QTY')
    } else {
      setResultData({ kind: 'saved', pendingCount: offlineQueue.pendingCount + 1 })
      setPhase('RESULT')
    }
  }

  async function doPackSubmit(qtyBoxValue: number) {
    if (!wo || !worker || !scanned) return
    setPhase('CONFIRM')
    // 오프라인으로 저장되면 이 값이 그대로 §13.7 ⑬ "#n" — 작업자가 박스에 적을 임시 번호이자,
    // flush 시 서버가 라벨에 "임시 #n" 으로 인쇄하는 값(offline_seq)과 같다. 미리 뽑아 두는 이유는
    // buildPackScanRequest 가 소비해 버리기 전에 결과 화면에도 같은 값을 보여줘야 하기 때문
    const clientSeq = nextClientSeq()
    const req = buildPackScanRequest({
      stationId: station.id,
      workerCard: worker.card_code ?? '',
      code: scanned.code,
      check: scanned.check,
      qtyBox: qtyBoxValue,
      inputVia: scanned.inputVia,
      eventUuid: newEventUuid(),
      clientSeq,
      scannedAt: nowKstIso(),
    })
    const outcome = await submitScan(req)
    if (outcome.status === 'ok') {
      const variant = scanResultVariant(outcome.response)
      if (variant === 'approval' && outcome.response.event_uuid) {
        setApprovalCtx({ eventUuid: outcome.response.event_uuid, approvalToken: outcome.response.approval_token, message: outcome.response.message })
        setPhase('APPROVAL')
        return
      }
      if (variant === 'ok' || variant === 'warn') rememberPackQtyBox(station.id, qtyBoxValue)
      if (variant === 'warn') {
        pushBanner({ kind: 'warning', message: outcome.response.message, woCode: outcome.response.wo?.code, at: nowKstIso() })
      }
      setResultData({ kind: 'response', variant, response: outcome.response })
      setPhase('PACK_RESULT')
    } else if (outcome.status === 'invalid') {
      pushBanner({ kind: 'error', message: `요청 형식 오류: ${outcome.error.message}`, woCode: wo.code, at: nowKstIso() })
      setPhase('PACK_SCANNED')
    } else {
      setResultData({ kind: 'saved', pendingCount: offlineQueue.pendingCount + 1, clientSeq })
      setPhase('PACK_RESULT')
    }
  }

  function onPackConfirm() {
    const n = Number(qtyBox || 0)
    if (n <= 0) return
    void doPackSubmit(n)
  }

  /**
   * KSK-81 [다음 박스] — 같은 WO 로 KSK-80 복귀, 입수 기본값 유지(§1 KSK-81 "연속 포장"). `goToScanned` 를
   * 그대로 재사용해 방금 보낸 박스가 누계에 반영된 최신 WO(남은 수량·박스 목록)를 다시 받는다.
   */
  function onPackNextBox() {
    setResultData(null)
    if (!wo) {
      setPhase('IDLE')
      return
    }
    void goToScanned(wo.code, scanned?.check ?? null, scanned?.inputVia ?? 'HID')
  }

  function onPackResultDone() {
    setResultData(null)
    setPhase('IDLE')
  }

  function onQtyConfirm() {
    if (!wo) return
    const good = Number(qtyGood || 0)
    const bad = Number(qtyBad || 0)
    const step = wo.steps.find((s) => s.process_code === 'P30')
    const exceeded = isToleranceExceeded(step?.qty_in, step?.tolerance_pct ?? 0, good, bad)
    if (exceeded) setPhase('REASON')
    else void doSubmit(good, bad, null, null)
  }

  function onReasonConfirm() {
    void doSubmit(Number(qtyGood || 0), Number(qtyBad || 0), reason.code, reason.text || null)
  }

  function onResultDismiss() {
    setResultData(null)
    setApprovalCtx(null)
    setPhase('IDLE')
  }

  function onApproved(response: ScanResponse) {
    const variant = scanResultVariant(response)
    if (variant === 'warn') pushBanner({ kind: 'warning', message: response.message, woCode: response.wo?.code, at: nowKstIso() })
    setResultData({ kind: 'response', variant, response })
    setPhase(isP50 ? 'PACK_RESULT' : 'RESULT')
  }
  function onDenied(response: ScanResponse) {
    setResultData({ kind: 'response', variant: 'reject', response })
    setPhase(isP50 ? 'PACK_RESULT' : 'RESULT')
  }
  function onApprovalDefer() {
    setApprovalCtx(null)
    setPhase('IDLE')
  }

  function onPendingApprovalSelect(item: PendingScan) {
    setApprovalCtx({ eventUuid: item.event_uuid, approvalToken: item.approval_token, message: item.message })
    setPhase('APPROVAL')
  }

  if (!worker) {
    return (
      <LoginScreen
        processName={processName}
        stationId={station.id}
        pendingWoCode={pendingLoginScan?.code ?? null}
        onLoggedIn={onLoggedIn}
        onWoScannedWhileLoggedOut={(code, check) => setPendingLoginScan({ code, check, inputVia: 'HID' })}
      />
    )
  }

  if (phase === 'IDLE') {
    return (
      <>
        <IdleScreen
          processName={processName}
          workerName={worker.name}
          stationId={station.id}
          pendingCount={offlineQueue.pendingCount}
          banner={<WarnBannerList items={banners} onDismiss={dismissBanner} />}
          queue={<QueueList items={toQueueListItems(queueData?.items ?? [])} staleAt={offlineQueue.status === 'offline' ? queueFetchedAt : undefined} />}
          actions={
            <div className="flex flex-wrap items-center gap-3">
              {(queueData?.pending_approvals ?? 0) > 0 ? (
                <button
                  type="button"
                  onClick={() => setPhase('PENDING_APPROVALS')}
                  className="min-h-touch-min rounded-full border-2 border-status-warn-line bg-status-warn-bg px-4 text-sf-body font-bold text-status-warn-fg"
                >
                  승인 대기 {queueData?.pending_approvals}
                </button>
              ) : null}
              {isP50 && packConfirm.count > 0 ? (
                <button
                  type="button"
                  onClick={() => setPhase('PACK_LABEL_CONFIRM')}
                  className="inline-flex min-h-touch-min items-center gap-2 rounded-full border-2 border-status-warn-line bg-status-warn-bg px-4 text-sf-body font-bold text-status-warn-fg"
                >
                  <IconTag size={20} /> 라벨 부착 확인 {packConfirm.count}
                </button>
              ) : null}
              <button type="button" onClick={() => setCameraOpen(true)} className="min-h-touch-min rounded-sf border-2 border-line-strong bg-surface px-4 text-sf-body font-bold">
                카메라 스캔 / 직접 입력
              </button>
              <button
                type="button"
                onClick={() => setPhase('REPRINT')}
                className="inline-flex min-h-touch-min items-center gap-2 rounded-sf border-2 border-line-strong bg-surface px-4 text-sf-body font-bold"
              >
                <IconTag size={20} /> 라벨 재발행
              </button>
              <button type="button" onClick={() => setPhase('PENDING_QUEUE')} className="min-h-touch-min rounded-sf border-2 border-line-strong bg-surface px-4 text-sf-body font-bold">
                미전송 목록
              </button>
              <button type="button" onClick={logout} className="min-h-touch-min rounded-sf border-2 border-line-strong bg-surface px-4 text-sf-body font-bold">
                로그아웃
              </button>
            </div>
          }
        />
        <CameraScanDialog
          open={cameraOpen}
          onClose={() => setCameraOpen(false)}
          onCameraScan={(raw) => {
            setCameraOpen(false)
            handleParsed(parseScanCode(raw), 'CAMERA')
          }}
          onManualSubmit={(code) => {
            setCameraOpen(false)
            handleParsed(parseScanCode(code), 'MANUAL')
          }}
        />
      </>
    )
  }

  return (
    <DeviceChrome
      processName={processName}
      stationId={station.id}
      workerName={worker.name}
      onLogout={logout}
      connectionStatus={offlineQueue.status}
      pendingCount={offlineQueue.pendingCount}
      staleCount={offlineQueue.staleCount}
      pendingApprovals={queueData?.pending_approvals ?? 0}
      onOpenPendingApprovals={() => setPhase('PENDING_APPROVALS')}
      packLabelConfirmCount={isP50 ? packConfirm.count : 0}
      onOpenPackLabelConfirm={() => setPhase('PACK_LABEL_CONFIRM')}
      banners={banners}
      onDismissBanner={dismissBanner}
    >
      {phase === 'SCANNED' && scanned ? (
        <ScannedScreen
          code={scanned.code}
          wo={wo}
          loading={woLoading}
          errorMessage={woError}
          offlineNoDetail={woOfflineNoDetail}
          equipmentOptions={equipmentOptions}
          equipmentValue={equipmentCode}
          onEquipmentChange={setEquipmentCode}
          onConfirm={() => setPhase('QTY')}
          onCancel={() => setPhase('IDLE')}
        />
      ) : null}

      {phase === 'PACK_SCANNED' && scanned ? (
        <PackScannedScreen
          code={scanned.code}
          wo={wo}
          loading={woLoading}
          errorMessage={woError}
          offlineNoDetail={woOfflineNoDetail}
          offline={offlineQueue.status === 'offline'}
          qtyBox={qtyBox}
          onQtyBoxChange={setQtyBox}
          onConfirm={onPackConfirm}
          onCancel={() => setPhase('IDLE')}
        />
      ) : null}

      {phase === 'QTY' && wo ? (
        <QtyScreen
          wo={wo}
          equipmentName={equipmentOptions.find((e) => e.code === equipmentCode)?.name ?? equipmentCode ?? '—'}
          qtyGood={qtyGood}
          qtyBad={qtyBad}
          onQtyGoodChange={setQtyGood}
          onQtyBadChange={setQtyBad}
          defaultGoodQty={defaultGoodQty(wo, 'P30')}
          onConfirm={onQtyConfirm}
          onBack={() => setPhase('SCANNED')}
        />
      ) : null}

      {phase === 'REASON' && wo ? (
        <ReasonScreen
          diff={Number(qtyGood || 0) + Number(qtyBad || 0) - (wo.steps.find((s) => s.process_code === 'P30')?.qty_in ?? 0)}
          tolerancePct={wo.steps.find((s) => s.process_code === 'P30')?.tolerance_pct ?? 0}
          shortfall={Number(qtyGood || 0) + Number(qtyBad || 0) < (wo.steps.find((s) => s.process_code === 'P30')?.qty_in ?? 0)}
          value={reason}
          onChange={setReason}
          onConfirm={onReasonConfirm}
          onBack={() => setPhase('QTY')}
        />
      ) : null}

      {phase === 'CONFIRM' && wo && !isP50 ? (
        <ConfirmScreen
          kind="done"
          woCode={wo.code}
          equipmentName={equipmentOptions.find((e) => e.code === equipmentCode)?.name ?? equipmentCode ?? '—'}
          qtyGood={Number(qtyGood || 0)}
          qtyBad={Number(qtyBad || 0)}
          varianceReasonLabel={reason.code ? `${reason.code}${reason.text ? ` — ${reason.text}` : ''}` : null}
        />
      ) : null}

      {phase === 'CONFIRM' && wo && isP50 ? <ConfirmScreen kind="pack" woCode={wo.code} qtyBox={Number(qtyBox || 0)} /> : null}

      {phase === 'RESULT' && resultData ? (
        resultData.kind === 'saved' ? (
          <ResultScreen kind="saved" code={scanned?.code ?? wo?.code ?? '—'} pendingCount={resultData.pendingCount} onDismiss={onResultDismiss} />
        ) : (
          <ResultScreen kind="response" code={scanned?.code ?? wo?.code ?? '—'} variant={resultData.variant} response={resultData.response} onDismiss={onResultDismiss} />
        )
      ) : null}

      {phase === 'PACK_RESULT' && resultData ? (
        resultData.kind === 'saved' ? (
          <PackResultScreen
            kind="saved"
            code={scanned?.code ?? wo?.code ?? '—'}
            pendingCount={resultData.pendingCount}
            clientSeq={resultData.clientSeq}
            onDismiss={onPackNextBox}
          />
        ) : (
          <PackResultScreen
            kind="response"
            code={scanned?.code ?? wo?.code ?? '—'}
            variant={resultData.variant}
            response={resultData.response}
            printerId={station.printer_id}
            onNextBox={onPackNextBox}
            onDone={onPackResultDone}
          />
        )
      ) : null}

      {phase === 'APPROVAL' && approvalCtx ? (
        <ApprovalScreen
          message={approvalCtx.message}
          online={offlineQueue.status !== 'offline'}
          eventUuid={approvalCtx.eventUuid}
          approvalToken={approvalCtx.approvalToken}
          onApproved={onApproved}
          onDenied={onDenied}
          onDefer={onApprovalDefer}
        />
      ) : null}

      {phase === 'PENDING_APPROVALS' ? <PendingApprovalsScreen stationId={station.id} onSelect={onPendingApprovalSelect} onClose={() => setPhase('IDLE')} /> : null}

      {phase === 'PENDING_QUEUE' ? (
        <PendingQueueScreen
          status={offlineQueue.status}
          pending={offlineQueue.pending}
          staleCount={offlineQueue.staleCount}
          lastFlushAt={offlineQueue.lastFlushAt}
          onFlushNow={offlineQueue.flushNow}
          onClose={() => setPhase('IDLE')}
        />
      ) : null}

      {phase === 'REPRINT' ? <ReprintScreen printerId={station.printer_id} offline={offlineQueue.status === 'offline'} onBack={() => setPhase('IDLE')} /> : null}

      {phase === 'PACK_LABEL_CONFIRM' ? (
        <PackLabelConfirmScreen
          items={packConfirm.items}
          printerId={station.printer_id}
          onLabelUpdated={(id, labelJob) => void packConfirm.updateLabel(id, labelJob)}
          onAckAll={() => {
            void packConfirm.ackAll()
            setPhase('IDLE')
          }}
          onClose={() => setPhase('IDLE')}
        />
      ) : null}
    </DeviceChrome>
  )
}

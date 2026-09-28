/**
 * 키오스크 세션 — 로그인 이후 상태 머신을 한 컴포넌트가 소유한다 (screens-shopfloor §1.0).
 * 화면 조각은 `screens/*` 로 나눴지만 "현재 화면 + 스캔한 WO + 수량" 상태는 전부 여기서 관리한다 —
 * 일반화된 FSM 라이브러리 없이, KSK-10~61 의 전이만 `phase` 로 표현한다.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { stationApi } from '@/shared/api'
import { isApiError } from '@/shared/api/client'
import { parseScanCode, useIdleLogout, useScannerInput, useWakeLock } from '@/shared/hooks'
import { nextClientSeq, submitScan, useOfflineQueue, type FlushedEntry } from '@/shared/offline'
import { IdleScreen, QueueList, WarnBannerList, type EquipmentOption, type QueueItem as UiQueueItem, type ScanResultVariant, type WarnBannerEntry } from '@/shared/ui/shopfloor'
import type { Equipment, InputVia, LoginVia, ParsedCode, PendingScan, QueueItem, QueueResponse, ScanResponse, Station, UserSummary, VarianceReasonCode, WorkOrderDetail } from '@/shared/types'
import { buildDoneScanRequest, defaultGoodQty, isToleranceExceeded, newEventUuid, nowKstIso, scanResultVariant } from './kioskLogic'
import { KioskChrome } from './KioskChrome'
import { CameraScanDialog } from './CameraScanDialog'
import { LoginScreen } from './screens/LoginScreen'
import { ScannedScreen } from './screens/ScannedScreen'
import { QtyScreen } from './screens/QtyScreen'
import { ReasonScreen } from './screens/ReasonScreen'
import { ConfirmScreen } from './screens/ConfirmScreen'
import { ResultScreen } from './screens/ResultScreen'
import { ApprovalScreen } from './screens/ApprovalScreen'
import { PendingApprovalsScreen } from './screens/PendingApprovalsScreen'
import { PendingQueueScreen } from './screens/PendingQueueScreen'

type Phase = 'IDLE' | 'SCANNED' | 'QTY' | 'REASON' | 'CONFIRM' | 'RESULT' | 'APPROVAL' | 'PENDING_APPROVALS' | 'PENDING_QUEUE'

type ScannedCode = { code: string; check: string | null; inputVia: InputVia }
type ResultData = { kind: 'response'; variant: ScanResultVariant; response: ScanResponse } | { kind: 'saved'; pendingCount: number }
type ApprovalCtx = { eventUuid: string; approvalToken: string | null; message: string }

function equipmentOptionsOf(list: Equipment[]): EquipmentOption[] {
  return list.filter((e) => e.active).map((e) => ({ code: e.code, name: e.name, equipType: e.equip_type }))
}

function woDetailFromQueueItem(item: QueueItem): WorkOrderDetail {
  // 오프라인 캐시 대체 카드 — 타임라인·오차 판정에 필요한 정보가 부족하므로 tolerance/qty_in 은 비워
  // 화면이 "판정 불가 → 바로 전송" 경로를 타게 한다 (screens-shopfloor §13 스캔 엔진 개발자 전제 3).
  return {
    ...item.wo,
    steps: [
      {
        id: 0,
        seq: item.wo.current_step_seq ?? 1,
        process_code: 'P30',
        process_name: '인쇄',
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
      setPhase('SCANNED')
      setWo(null)
      setWoError(null)
      setWoOfflineNoDetail(false)
      setWoLoading(true)
      setEquipmentOptions([])
      setEquipmentCode(null)
      setQtyGood('')
      setQtyBad('')
      setReason({ code: null, text: '' })
      try {
        const detail = await stationApi.wo(code)
        setWo(detail)
        void loadEquipment(detail.print_method)
      } catch (e) {
        if (isApiError(e) && e.status === 404) {
          setWoError(e.message)
        } else {
          const cached = queueData?.items.find((i) => i.wo.code === code)
          if (cached) {
            setWo(woDetailFromQueueItem(cached))
            setWoOfflineNoDetail(true)
            void loadEquipment(cached.wo.print_method)
          }
          // 캐시도 없으면 wo=null 유지 → ScannedScreen 이 코드만 보여준다
        }
      } finally {
        setWoLoading(false)
      }
    },
    [loadEquipment, queueData],
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
      pushBanner({ kind: 'warning', message: `이 단말에서는 처리할 수 없는 코드입니다 (${parsed.type})` })
    },
    [phase, goToScanned, pushBanner],
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
    setPhase('RESULT')
  }
  function onDenied(response: ScanResponse) {
    setResultData({ kind: 'response', variant: 'reject', response })
    setPhase('RESULT')
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
              <button type="button" onClick={() => setCameraOpen(true)} className="min-h-touch-min rounded-sf border-2 border-line-strong bg-surface px-4 text-sf-body font-bold">
                카메라 스캔 / 직접 입력
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
    <KioskChrome
      processName={processName}
      stationId={station.id}
      workerName={worker.name}
      onLogout={logout}
      connectionStatus={offlineQueue.status}
      pendingCount={offlineQueue.pendingCount}
      staleCount={offlineQueue.staleCount}
      pendingApprovals={queueData?.pending_approvals ?? 0}
      onOpenPendingApprovals={() => setPhase('PENDING_APPROVALS')}
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

      {phase === 'CONFIRM' && wo ? (
        <ConfirmScreen
          woCode={wo.code}
          equipmentName={equipmentOptions.find((e) => e.code === equipmentCode)?.name ?? equipmentCode ?? '—'}
          qtyGood={Number(qtyGood || 0)}
          qtyBad={Number(qtyBad || 0)}
          varianceReasonLabel={reason.code ? `${reason.code}${reason.text ? ` — ${reason.text}` : ''}` : null}
        />
      ) : null}

      {phase === 'RESULT' && resultData ? (
        resultData.kind === 'saved' ? (
          <ResultScreen kind="saved" code={scanned?.code ?? wo?.code ?? '—'} pendingCount={resultData.pendingCount} onDismiss={onResultDismiss} />
        ) : (
          <ResultScreen kind="response" code={scanned?.code ?? wo?.code ?? '—'} variant={resultData.variant} response={resultData.response} onDismiss={onResultDismiss} />
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
    </KioskChrome>
  )
}

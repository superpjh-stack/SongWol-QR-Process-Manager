/**
 * PDA 입고 세션(P20) — PDA-10(대기)·PDA-11(매핑)·PDA-12(입력)·PDA-13(결과) (screens-shopfloor §2).
 * `kiosk/KioskSession.tsx` 와 같은 원칙: 화면 조각은 `screens/*` 로 나눴지만 상태 머신은 여기서 한
 * 컴포넌트가 소유한다. 로그인·오프라인 큐·스캐너 보류·승인·미전송 목록은 `shared/device/*` 를 그대로
 * 재사용한다(중복 구현 금지).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { scanApi, stationApi } from '@/shared/api'
import { isApiError } from '@/shared/api/client'
import { parseScanCode, useIdleLogout, useScannerInput, useWakeLock } from '@/shared/hooks'
import { nextClientSeq, submitScan, useOfflineQueue, type FlushedEntry } from '@/shared/offline'
import { newEventUuid, scanResultVariant } from '@/shared/scanUtil'
import { DeviceChrome } from '@/shared/device/DeviceChrome'
import { CameraScanDialog } from '@/shared/device/CameraScanDialog'
import { LoginScreen } from '@/shared/device/LoginScreen'
import { ApprovalScreen } from '@/shared/device/ApprovalScreen'
import { PendingApprovalsScreen } from '@/shared/device/PendingApprovalsScreen'
import { PendingQueueScreen } from '@/shared/device/PendingQueueScreen'
import { SendingScreen } from '@/shared/device/SendingScreen'
import { IdleScreen, WarnBannerList, type ReasonValue, type WarnBannerEntry } from '@/shared/ui/shopfloor'
import { VarianceReasonLabel } from '@/shared/labels'
import type { InputVia, Inspection, LoginVia, ParsedCode, PendingScan, ScanResponse, Station, UserSummary, WorkOrderDetail } from '@/shared/types'
import { buildMapScanRequest, buildReceiveScanRequest } from './pdaLogic'
import { MappingScreen } from './screens/MappingScreen'
import { ReceiveEntryScreen } from './screens/ReceiveEntryScreen'
import { ReceiveResultScreen } from './screens/ReceiveResultScreen'

type Phase = 'IDLE' | 'MAPPING' | 'ENTRY' | 'CONFIRM' | 'RESULT' | 'APPROVAL' | 'PENDING_APPROVALS' | 'PENDING_QUEUE'

type ScannedCode = { code: string; check: string | null; inputVia: InputVia }
type ReceiveCode = { code: string; check: string | null }
type ResultData = { kind: 'response'; variant: ReturnType<typeof scanResultVariant>; response: ScanResponse } | { kind: 'saved'; pendingCount: number }
type ApprovalCtx = { eventUuid: string; approvalToken: string | null; message: string }

function reasonToText(value: ReasonValue): string | null {
  if (!value.code) return null
  const label = VarianceReasonLabel[value.code]
  return value.text ? `${label} — ${value.text}` : label
}

let bannerSeq = 0
function newBannerId(): string {
  bannerSeq += 1
  return `pda-r-banner-${Date.now()}-${bannerSeq}`
}

export function ReceivingSession({ station, processName, bootOffline }: { station: Station; processName: string; bootOffline?: boolean }) {
  useWakeLock()

  const [worker, setWorker] = useState<UserSummary | null>(null)
  const [, setLoginVia] = useState<LoginVia | null>(null)
  const [pendingLoginScan, setPendingLoginScan] = useState<ScannedCode | null>(null)

  const [phase, setPhase] = useState<Phase>('IDLE')

  // PDA-11 매핑
  const [vbPending, setVbPending] = useState<string | null>(null)
  const [mappingWo, setMappingWo] = useState<WorkOrderDetail | null>(null)
  const [mappingLoading, setMappingLoading] = useState(false)
  const [mappingSaving, setMappingSaving] = useState(false)
  const [mappingError, setMappingError] = useState<string | null>(null)
  const [mappingInputVia, setMappingInputVia] = useState<InputVia>('HID')

  // PDA-12 입력
  const [receiveCode, setReceiveCode] = useState<ReceiveCode | null>(null)
  const [entryInputVia, setEntryInputVia] = useState<InputVia>('HID')
  const [wo, setWo] = useState<WorkOrderDetail | null>(null)
  const [woLoading, setWoLoading] = useState(false)
  const [woError, setWoError] = useState<string | null>(null)
  const [woOfflineNoDetail, setWoOfflineNoDetail] = useState(false)
  const [qty, setQty] = useState('')
  const [boxCount, setBoxCount] = useState('')
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [vendor, setVendor] = useState('')
  const [varianceReason, setVarianceReason] = useState<ReasonValue>({ code: null, text: '' })
  const [quarantineMemo, setQuarantineMemo] = useState('')
  const [submittedInspection, setSubmittedInspection] = useState<Inspection>('PASS')

  const [resultData, setResultData] = useState<ResultData | null>(null)
  const [approvalCtx, setApprovalCtx] = useState<ApprovalCtx | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)

  const [banners, setBanners] = useState<WarnBannerEntry[]>([])
  const pushBanner = useCallback((entry: Omit<WarnBannerEntry, 'id'>) => setBanners((prev) => [...prev, { ...entry, id: newBannerId() }]), [])
  const dismissBanner = useCallback((id: string) => setBanners((prev) => prev.filter((b) => b.id !== id)), [])

  const bootOfflineNoticeShown = useRef(false)
  if (bootOffline && !bootOfflineNoticeShown.current) {
    bootOfflineNoticeShown.current = true
    pushBanner({ kind: 'offline', message: '오프라인 상태로 시작했습니다 — 마지막 캐시로 동작합니다' })
  }

  const handleFlushed = useCallback(
    (entries: FlushedEntry[]) => {
      for (const { response, at } of entries) {
        if (response.duplicate) continue
        if (response.result === 'WARN' && !response.requires_approval) {
          pushBanner({ kind: 'warning', message: response.message, at, woCode: response.wo?.code })
        } else if (response.result === 'REJECT') {
          pushBanner({ kind: 'error', message: response.message, at, woCode: response.wo?.code })
        }
      }
    },
    [pushBanner],
  )
  const offlineQueue = useOfflineQueue(handleFlushed)

  // §0.9 "전 단말" 공통 — 승인 대기 N 배지는 PDA 도 표시한다(kiosk 는 station queue 응답에 실려 오지만
  // PDA 에는 대응하는 대기열 화면이 없어 `GET /scan/pending` 건수만 따로 폴링한다)
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0)
  const refreshPendingApprovals = useCallback(async () => {
    try {
      const list = await scanApi.pending(station.id)
      setPendingApprovalsCount(list.length)
    } catch {
      // 오프라인 등 — 마지막 값 유지
    }
  }, [station.id])
  useEffect(() => {
    if (!worker) return
    void refreshPendingApprovals()
    const t = window.setInterval(() => void refreshPendingApprovals(), 30_000)
    return () => window.clearInterval(t)
  }, [worker, refreshPendingApprovals])

  const goToEntry = useCallback(async (woCode: string, inputVia: InputVia, code: ReceiveCode) => {
    setPhase('ENTRY')
    setReceiveCode(code)
    setEntryInputVia(inputVia)
    setWo(null)
    setWoError(null)
    setWoOfflineNoDetail(false)
    setWoLoading(true)
    setQty('')
    setBoxCount('')
    setInspection(null)
    setVendor('')
    setVarianceReason({ code: null, text: '' })
    setQuarantineMemo('')
    try {
      const detail = await stationApi.wo(woCode)
      setWo(detail)
    } catch (e) {
      if (isApiError(e) && e.status === 404) setWoError(e.message)
      else setWoOfflineNoDetail(true)
    } finally {
      setWoLoading(false)
    }
  }, [])

  /** MAP 이벤트 전송 — [매핑 저장] 버튼과 오프라인 자동 저장 경로가 함께 쓴다 */
  const submitMap = useCallback(
    async (barcode: string, woCode: string, inputVia: InputVia): Promise<'ok' | 'reject' | 'queued'> => {
      if (!worker) return 'reject'
      const req = buildMapScanRequest({
        stationId: station.id,
        workerCard: worker.card_code ?? '',
        barcode,
        woCode,
        inputVia,
        eventUuid: newEventUuid(),
        clientSeq: nextClientSeq(),
      })
      const outcome = await submitScan(req)
      if (outcome.status === 'ok') {
        if (outcome.response.result === 'REJECT') {
          pushBanner({ kind: 'error', message: outcome.response.message })
          return 'reject'
        }
        if (outcome.response.result === 'WARN') pushBanner({ kind: 'warning', message: outcome.response.message })
        return 'ok'
      }
      if (outcome.status === 'invalid') {
        pushBanner({ kind: 'error', message: `요청 형식 오류: ${outcome.error.message}` })
        return 'reject'
      }
      return 'queued'
    },
    [station.id, worker, pushBanner],
  )

  const onVbScanned = useCallback(
    async (barcode: string, inputVia: InputVia) => {
      setPhase('MAPPING')
      setVbPending(barcode)
      setMappingWo(null)
      setMappingError(null)
      try {
        const res = await stationApi.vendorBarcodeLookup(barcode)
        if (res.mapping && res.wo) {
          void goToEntry(res.wo.code, inputVia, { code: barcode, check: null })
        }
        // 매핑 없음 — MAPPING 화면에 남아 WO 스캔을 기다린다
      } catch {
        pushBanner({ kind: 'offline', message: '오프라인 — 매핑 확인 불가. 이어서 작업지시 QR 을 스캔하면 매핑+입고를 함께 저장합니다' })
      }
    },
    [goToEntry, pushBanner],
  )

  const onWoScannedForMapping = useCallback(
    async (woCode: string, check: string | null, inputVia: InputVia) => {
      setMappingInputVia(inputVia)
      setMappingLoading(true)
      setMappingError(null)
      try {
        const detail = await stationApi.wo(woCode)
        setMappingWo(detail)
      } catch (e) {
        if (isApiError(e) && e.status === 404) {
          setMappingError(e.message)
        } else {
          // 오프라인 — 매핑+입고를 함께 저장하고 바로 입력으로 진행 (§2 PDA-10 오프라인)
          const barcode = vbPending
          if (barcode) void submitMap(barcode, woCode, inputVia)
          void goToEntry(woCode, inputVia, barcode ? { code: barcode, check: null } : { code: woCode, check })
        }
      } finally {
        setMappingLoading(false)
      }
    },
    [vbPending, submitMap, goToEntry],
  )

  const handleParsed = useCallback(
    (parsed: ParsedCode, inputVia: InputVia) => {
      if (parsed.type === 'WO') {
        if (phase === 'MAPPING' && vbPending) void onWoScannedForMapping(parsed.code, parsed.check, inputVia)
        else void goToEntry(parsed.code, inputVia, { code: parsed.code, check: parsed.check })
        return
      }
      if (parsed.type === 'VB') {
        if (phase === 'MAPPING') {
          setVbPending(parsed.code)
          setMappingWo(null)
          setMappingError(null)
          pushBanner({ kind: 'warning', message: `업체 바코드가 바뀌었습니다: ${parsed.code}` })
          return
        }
        void onVbScanned(parsed.code, inputVia)
        return
      }
      if (parsed.type === 'US') {
        if (phase === 'IDLE') {
          setWorker(null)
          setPendingLoginScan(null)
        }
        return
      }
      pushBanner({ kind: 'warning', message: `이 단말에서는 처리할 수 없는 코드입니다 (${parsed.type})` })
    },
    [phase, vbPending, onWoScannedForMapping, goToEntry, onVbScanned, pushBanner],
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
      handleParsed({ type: 'WO', code: p.code, check: p.check, raw: p.code }, p.inputVia)
    } else {
      setPhase('IDLE')
    }
  }

  function logout() {
    setWorker(null)
    setPhase('IDLE')
  }

  async function onMapSave() {
    if (!vbPending || !mappingWo) return
    setMappingSaving(true)
    const result = await submitMap(vbPending, mappingWo.code, mappingInputVia)
    setMappingSaving(false)
    if (result === 'reject') {
      setPhase('IDLE')
      return
    }
    void goToEntry(mappingWo.code, mappingInputVia, { code: vbPending, check: null })
  }

  async function doReceiveSubmit() {
    if (!worker || !receiveCode || !inspection) return
    const qtyNum = Number(qty || 0)
    if (qtyNum <= 0) return
    setSubmittedInspection(inspection)
    setPhase('CONFIRM')
    const req = buildReceiveScanRequest({
      stationId: station.id,
      workerCard: worker.card_code ?? '',
      code: receiveCode.code,
      check: receiveCode.check,
      qty: qtyNum,
      boxCount: boxCount ? Number(boxCount) : null,
      inspection,
      vendor: vendor || null,
      varianceReason: reasonToText(varianceReason),
      quarantineMemo: quarantineMemo || null,
      inputVia: entryInputVia,
      eventUuid: newEventUuid(),
      clientSeq: nextClientSeq(),
    })
    const outcome = await submitScan(req)
    if (outcome.status === 'ok') {
      const variant = scanResultVariant(outcome.response)
      if (variant === 'approval' && outcome.response.event_uuid) {
        setApprovalCtx({ eventUuid: outcome.response.event_uuid, approvalToken: outcome.response.approval_token, message: outcome.response.message })
        setPhase('APPROVAL')
        return
      }
      if (variant === 'warn') pushBanner({ kind: 'warning', message: outcome.response.message, woCode: outcome.response.wo?.code })
      setResultData({ kind: 'response', variant, response: outcome.response })
      setPhase('RESULT')
    } else if (outcome.status === 'invalid') {
      pushBanner({ kind: 'error', message: `요청 형식 오류: ${outcome.error.message}` })
      setPhase('ENTRY')
    } else {
      setResultData({ kind: 'saved', pendingCount: offlineQueue.pendingCount + 1 })
      setPhase('RESULT')
    }
  }

  function onResultDismiss() {
    setResultData(null)
    setApprovalCtx(null)
    setPhase('IDLE')
  }

  function onApproved(response: ScanResponse) {
    const variant = scanResultVariant(response)
    if (variant === 'warn') pushBanner({ kind: 'warning', message: response.message, woCode: response.wo?.code })
    setResultData({ kind: 'response', variant, response })
    setPhase('RESULT')
    void refreshPendingApprovals()
  }
  function onDenied(response: ScanResponse) {
    setResultData({ kind: 'response', variant: 'reject', response })
    setPhase('RESULT')
    void refreshPendingApprovals()
  }
  function onApprovalDefer() {
    setApprovalCtx(null)
    setPhase('IDLE')
    void refreshPendingApprovals()
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
          promptExtra={<p className="text-sf-lg text-ink-muted">업체 바코드 또는 작업지시 QR 을 스캔하세요</p>}
          actions={
            <div className="flex flex-wrap items-center gap-3">
              {pendingApprovalsCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setPhase('PENDING_APPROVALS')}
                  className="min-h-touch-min rounded-full border-2 border-status-warn-line bg-status-warn-bg px-4 text-sf-body font-bold text-status-warn-fg"
                >
                  승인 대기 {pendingApprovalsCount}
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
    <DeviceChrome
      processName={processName}
      stationId={station.id}
      workerName={worker.name}
      onLogout={logout}
      connectionStatus={offlineQueue.status}
      pendingCount={offlineQueue.pendingCount}
      staleCount={offlineQueue.staleCount}
      pendingApprovals={pendingApprovalsCount}
      onOpenPendingApprovals={() => setPhase('PENDING_APPROVALS')}
      banners={banners}
      onDismissBanner={dismissBanner}
    >
      {phase === 'MAPPING' && vbPending ? (
        <MappingScreen barcode={vbPending} wo={mappingWo} loading={mappingLoading} errorMessage={mappingError} saving={mappingSaving} onSave={() => void onMapSave()} onCancel={() => setPhase('IDLE')} />
      ) : null}

      {phase === 'ENTRY' && receiveCode ? (
        <ReceiveEntryScreen
          code={wo?.code ?? receiveCode.code}
          wo={wo}
          loading={woLoading}
          errorMessage={woError}
          offlineNoDetail={woOfflineNoDetail}
          qty={qty}
          onQtyChange={setQty}
          boxCount={boxCount}
          onBoxCountChange={setBoxCount}
          inspection={inspection}
          onInspectionChange={setInspection}
          vendor={vendor}
          onVendorChange={setVendor}
          varianceReason={varianceReason}
          onVarianceReasonChange={setVarianceReason}
          quarantineMemo={quarantineMemo}
          onQuarantineMemoChange={setQuarantineMemo}
          onSubmit={() => void doReceiveSubmit()}
          onCancel={() => setPhase('IDLE')}
        />
      ) : null}

      {phase === 'CONFIRM' && receiveCode ? (
        <SendingScreen
          rows={[
            { label: '코드', value: <span className="font-mono font-bold">{receiveCode.code}</span> },
            { label: '수량', value: `${Number(qty || 0).toLocaleString('ko-KR')}장` },
            { label: '검수', value: submittedInspection },
          ]}
        />
      ) : null}

      {phase === 'RESULT' && resultData ? (
        resultData.kind === 'saved' ? (
          <ReceiveResultScreen kind="saved" code={receiveCode?.code ?? '—'} pendingCount={resultData.pendingCount} onDismiss={onResultDismiss} />
        ) : (
          <ReceiveResultScreen kind="response" code={receiveCode?.code ?? '—'} variant={resultData.variant} response={resultData.response} inspection={submittedInspection} onDismiss={onResultDismiss} />
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
    </DeviceChrome>
  )
}

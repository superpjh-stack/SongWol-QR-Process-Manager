/**
 * PDA 발송 세션(P60) — PDA-20(박스 스캔)·PDA-21(송장)·PDA-22(결과) (screens-shopfloor §2). 박스 목록은
 * 전송 전(빼기 가능) 상태라 `ScanList` 를 그대로 쓴다. 확정은 §2 PDA-21 설계 결정 그대로: 박스 1개당
 * SHIP 이벤트 1건을 만들어 `submitBatch`(offlineQueue 의 "저장 → 즉시 배치 전송") 로 한 번에 보낸다 —
 * `POST /shipments` 를 따로 쓰지 않는다(그 경로는 `event_uuid` 멱등·오프라인 큐가 없다, §5 ⑳).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { scanApi, stationApi } from '@/shared/api'
import { isApiError } from '@/shared/api/client'
import { parseScanCode, useIdleLogout, useScannerInput, useWakeLock } from '@/shared/hooks'
import { nextClientSeq, submitBatch, useOfflineQueue, type FlushedEntry } from '@/shared/offline'
import { newEventUuid } from '@/shared/scanUtil'
import { DeviceChrome } from '@/shared/device/DeviceChrome'
import { CameraScanDialog } from '@/shared/device/CameraScanDialog'
import { LoginScreen } from '@/shared/device/LoginScreen'
import { ApprovalScreen } from '@/shared/device/ApprovalScreen'
import { PendingApprovalsScreen } from '@/shared/device/PendingApprovalsScreen'
import { PendingQueueScreen } from '@/shared/device/PendingQueueScreen'
import { SendingScreen } from '@/shared/device/SendingScreen'
import { IdleScreen, WarnBannerList, hasScanListDuplicate, sumScanListQty, type ScanListRow, type WarnBannerEntry } from '@/shared/ui/shopfloor'
import type { InputVia, LoginVia, ParsedCode, PendingScan, ScanResponse, Station, UserSummary } from '@/shared/types'
import { buildBoxRow, buildOfflineBoxRow, buildShipScanRequest, isBoxAlreadyShipped, readRecentCarriers, rememberCarrier } from './pdaLogic'
import { BoxScanScreen } from './screens/BoxScanScreen'
import { TrackingScreen } from './screens/TrackingScreen'
import { ShipResultScreen } from './screens/ShipResultScreen'

type Phase = 'IDLE' | 'BOXES' | 'TRACKING' | 'CONFIRM' | 'RESULT' | 'APPROVAL' | 'PENDING_APPROVALS' | 'PENDING_QUEUE'
type ScannedCode = { code: string; check: string | null; inputVia: InputVia }
type ApprovalCtx = { eventUuid: string; approvalToken: string | null; message: string }
type ShipResults = Array<{ event_uuid: string; response: ScanResponse }>
type ResultData = { kind: 'saved'; pendingCount: number } | { kind: 'response'; results: ShipResults; unshippedRemaining: number }

let bannerSeq = 0
function newBannerId(): string {
  bannerSeq += 1
  return `pda-s-banner-${Date.now()}-${bannerSeq}`
}

export function ShippingSession({ station, processName, bootOffline }: { station: Station; processName: string; bootOffline?: boolean }) {
  useWakeLock()

  const [worker, setWorker] = useState<UserSummary | null>(null)
  const [, setLoginVia] = useState<LoginVia | null>(null)
  const [pendingLoginScan, setPendingLoginScan] = useState<ScannedCode | null>(null)

  const [phase, setPhase] = useState<Phase>('IDLE')

  const [boxRows, setBoxRows] = useState<ScanListRow[]>([])
  const [soCode, setSoCode] = useState<string | null>(null)

  const [trackingNo, setTrackingNo] = useState('')
  const [carrier, setCarrier] = useState('')
  const [recentCarriers, setRecentCarriers] = useState<string[]>([])

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

  useEffect(() => {
    setRecentCarriers(readRecentCarriers())
  }, [])

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

  const addBoxByCode = useCallback(
    async (code: string) => {
      if (hasScanListDuplicate(boxRows, code)) {
        pushBanner({ kind: 'warning', message: '이미 목록에 있음' })
        return
      }
      try {
        const detail = await stationApi.box(code)
        if (isBoxAlreadyShipped(detail)) {
          pushBanner({ kind: 'error', message: `이미 발송된 박스(${detail.shipment?.tracking_no ?? '—'})` })
          return
        }
        setBoxRows((prev) => (hasScanListDuplicate(prev, code) ? prev : [...prev, buildBoxRow(detail, soCode)]))
        setSoCode((prev) => prev ?? detail.wo.so_code)
        setPhase('BOXES')
      } catch {
        setBoxRows((prev) => (hasScanListDuplicate(prev, code) ? prev : [...prev, buildOfflineBoxRow(code)]))
        pushBanner({ kind: 'offline', message: '오프라인 — 박스 정보 확인 불가' })
        setPhase('BOXES')
      }
    },
    [boxRows, soCode, pushBanner],
  )

  /** 라벨 훼손 등으로 박스를 낱개로 못 찍을 때 — 이 WO 의 미발송 박스 전부를 담는다 (§2 PDA-20 대체 경로) */
  const addBoxesByWo = useCallback(
    async (woCode: string) => {
      try {
        const [woDetail, page] = await Promise.all([stationApi.wo(woCode), stationApi.unshippedBoxes(woCode)])
        const added: ScanListRow[] = []
        for (const b of page.items) {
          if (hasScanListDuplicate([...boxRows, ...added], b.code)) continue
          const warn = soCode !== null && woDetail.so_code !== soCode
          added.push({
            id: b.code,
            code: b.code,
            woCode: b.wo_code,
            boxNo: b.box_no,
            qty: b.qty,
            customerName: woDetail.customer_name,
            status: warn ? 'warn' : 'ok',
            note: warn ? `다른 수주(${woDetail.so_code})의 박스입니다 — 송장이 분리됩니다` : null,
          })
        }
        if (added.length === 0) {
          pushBanner({ kind: 'warning', message: '미발송 박스가 없습니다' })
          return
        }
        setBoxRows((prev) => [...prev, ...added])
        setSoCode((prev) => prev ?? woDetail.so_code)
        setPhase('BOXES')
      } catch (e) {
        pushBanner({ kind: 'error', message: isApiError(e) ? e.message : '조회에 실패했습니다' })
      }
    },
    [boxRows, soCode, pushBanner],
  )

  const handleParsed = useCallback(
    (parsed: ParsedCode, inputVia: InputVia) => {
      if (parsed.type === 'LT') {
        void addBoxByCode(parsed.code)
        return
      }
      if (parsed.type === 'WO') {
        void addBoxesByWo(parsed.code)
        return
      }
      if (parsed.type === 'US') {
        if (phase === 'IDLE') {
          setWorker(null)
          setPendingLoginScan(null)
        }
        return
      }
      if (parsed.type === 'VB') {
        // PDA-21 송장번호는 TextEntry 가 자체 구독으로 받는다 — TRACKING 화면에서는 안내를 띄우지 않는다
        if (phase === 'TRACKING') return
        pushBanner({ kind: 'warning', message: '이 단말에서는 처리할 수 없는 코드입니다 (VB)' })
        return
      }
      pushBanner({ kind: 'warning', message: `이 단말에서는 처리할 수 없는 코드입니다 (${parsed.type})` })
      void inputVia
    },
    [phase, addBoxByCode, addBoxesByWo, pushBanner],
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
      handleParsed({ type: 'LT', code: p.code, check: p.check, raw: p.code }, p.inputVia)
    } else {
      setPhase('IDLE')
    }
  }

  function logout() {
    setWorker(null)
    setPhase('IDLE')
  }

  function removeBox(id: string) {
    setBoxRows((prev) => {
      const next = prev.filter((r) => r.id !== id)
      if (next.length === 0) setSoCode(null)
      return next
    })
  }

  async function doShipSubmit() {
    if (!worker || boxRows.length === 0 || !trackingNo.trim()) return
    setPhase('CONFIRM')
    const events = boxRows.map((row) =>
      buildShipScanRequest({
        stationId: station.id,
        workerCard: worker.card_code ?? '',
        boxCode: row.code,
        check: null,
        trackingNo: trackingNo.trim(),
        carrier: carrier.trim() || null,
        inputVia: 'HID',
        eventUuid: newEventUuid(),
        clientSeq: nextClientSeq(),
      }),
    )
    const outcome = await submitBatch(events)
    if (outcome.status === 'ok') {
      if (carrier.trim()) {
        rememberCarrier(carrier.trim())
        setRecentCarriers(readRecentCarriers())
      }
      const okWoCodes = [...new Set(outcome.results.map((r) => r.response.wo?.code).filter((c): c is string => Boolean(c)))]
      let unshippedRemaining = 0
      if (offlineQueue.status !== 'offline') {
        for (const wc of okWoCodes) {
          try {
            const page = await stationApi.unshippedBoxes(wc)
            unshippedRemaining += page.total
          } catch {
            // 조회 실패는 조용히 넘긴다 — 경고 문구만 생략된다, 발송 결과 자체는 이미 반영됨
          }
        }
      }
      setResultData({ kind: 'response', results: outcome.results, unshippedRemaining })
    } else {
      setResultData({ kind: 'saved', pendingCount: offlineQueue.pendingCount })
    }
    setPhase('RESULT')
    setBoxRows([])
    setSoCode(null)
    setTrackingNo('')
    setCarrier('')
  }

  function onResultDismiss() {
    setResultData(null)
    setApprovalCtx(null)
    setPhase('IDLE')
  }

  function onApproved(response: ScanResponse) {
    pushBanner({ kind: response.result === 'REJECT' ? 'error' : 'warning', message: response.message, woCode: response.wo?.code })
    setPhase('IDLE')
    void refreshPendingApprovals()
  }
  function onDenied(response: ScanResponse) {
    pushBanner({ kind: 'error', message: response.message, woCode: response.wo?.code })
    setPhase('IDLE')
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
          promptExtra={<p className="text-sf-lg text-ink-muted">박스 QR 을 스캔하세요 (여러 개 가능)</p>}
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
              {boxRows.length > 0 ? (
                <button type="button" onClick={() => setPhase('BOXES')} className="min-h-touch-min rounded-sf border-2 border-brand-700 bg-brand-600 px-4 text-sf-body font-bold text-white">
                  박스 목록 {boxRows.length}
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
            setPhase('BOXES')
          }}
          onManualSubmit={(code) => {
            setCameraOpen(false)
            handleParsed(parseScanCode(code), 'MANUAL')
            setPhase('BOXES')
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
      {phase === 'BOXES' ? <BoxScanScreen rows={boxRows} onRemove={removeBox} onNext={() => setPhase('TRACKING')} /> : null}

      {phase === 'TRACKING' ? (
        <TrackingScreen
          boxCount={boxRows.length}
          totalQty={sumScanListQty(boxRows)}
          trackingNo={trackingNo}
          onTrackingNoChange={setTrackingNo}
          carrier={carrier}
          onCarrierChange={setCarrier}
          recentCarriers={recentCarriers}
          onConfirm={() => void doShipSubmit()}
          onBack={() => setPhase('BOXES')}
        />
      ) : null}

      {phase === 'CONFIRM' ? (
        <SendingScreen
          rows={[
            { label: '박스', value: `${boxRows.length}개` },
            { label: '합계', value: `${sumScanListQty(boxRows).toLocaleString('ko-KR')}장` },
            { label: '송장번호', value: <span className="font-mono font-bold">{trackingNo}</span> },
          ]}
        />
      ) : null}

      {phase === 'RESULT' && resultData ? (
        resultData.kind === 'saved' ? (
          <ShipResultScreen kind="saved" pendingCount={resultData.pendingCount} onDismiss={onResultDismiss} />
        ) : (
          <ShipResultScreen kind="response" results={resultData.results} unshippedRemaining={resultData.unshippedRemaining} onDismiss={onResultDismiss} />
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

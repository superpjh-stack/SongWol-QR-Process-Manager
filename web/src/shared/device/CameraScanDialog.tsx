/**
 * 카메라 스캔(B2-08) + 수기 입력(B2-09) — KSK-10 의 부가 진입점 (api-contract §16.2·§16.3).
 * 카메라는 `BarcodeDetector` 를 우선 쓰고(feature-detect), 없으면 비디오 프레임을 canvas 로 떠서 `jsQR` 로
 * 디코딩한다. 두 경로 모두 같은 `parseScanCode()` 로 들어가므로 이 컴포넌트는 **원문 문자열**만 올려 보내고
 * (HID 스캐너와 동일한 파싱 경로), `input_via` 태깅은 호출부(KioskSession)가 한다.
 * 수기 입력은 `check` 를 생략할 수 있으므로(§16.2) 화면은 대상 코드만 받고 확인 카드(고객·품목)는
 * 상위 SCANNED 화면이 보여준다 — 이 다이얼로그는 코드 접수까지만 한다.
 *
 * P30 전용 내용이 없어 `kiosk/CameraScanDialog.tsx` 에서 여기로 옮겨 PDA(P20·P60) 도 재사용한다
 * (과제 지시: "카메라/수기 스캔 입력은 PDA 에도 필요 — CameraScanDialog 재사용, 재구현 금지").
 */
import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { BigButton } from '@/shared/ui/shopfloor'
import { IconX } from '@/shared/ui/icons'

export type CameraScanDialogProps = {
  open: boolean
  onClose: () => void
  /** 카메라로 읽은 원문(HID 스캐너가 보내는 것과 같은 문자열) */
  onCameraScan: (raw: string) => void
  /** 수기 입력 코드 (체크코드 없음, §16.2) */
  onManualSubmit: (code: string) => void
}

type BarcodeDetectorLike = { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>> }
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike
declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorCtor
  }
}

export function CameraScanDialog({ open, onClose, onCameraScan, onManualSubmit }: CameraScanDialogProps) {
  const [mode, setMode] = useState<'camera' | 'manual'>('camera')
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [manualCode, setManualCode] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const stoppedRef = useRef(false)

  useEffect(() => {
    if (!open || mode !== 'camera') return
    stoppedRef.current = false
    setCameraError(null)

    let detector: BarcodeDetectorLike | null = null
    if (window.BarcodeDetector) {
      try {
        detector = new window.BarcodeDetector({ formats: ['qr_code'] })
      } catch {
        detector = null
      }
    }

    let detecting = false
    const tick = () => {
      if (stoppedRef.current) return
      const video = videoRef.current
      if (video && video.readyState >= video.HAVE_ENOUGH_DATA && !detecting) {
        detecting = true
        void decodeFrame(video, detector).then((raw) => {
          detecting = false
          if (raw && !stoppedRef.current) {
            stoppedRef.current = true
            stopStream()
            onCameraScan(raw)
          }
        })
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        if (stoppedRef.current) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          void videoRef.current.play().catch(() => {})
        }
        rafRef.current = requestAnimationFrame(tick)
      })
      .catch(() => setCameraError('카메라를 열 수 없습니다 — 권한을 확인하거나 직접 입력을 이용하세요'))

    return () => {
      stoppedRef.current = true
      stopStream()
    }
  }, [open, mode])

  function stopStream() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  async function decodeFrame(video: HTMLVideoElement, detector: BarcodeDetectorLike | null): Promise<string | null> {
    if (detector) {
      try {
        const results = await detector.detect(video)
        if (results[0]?.rawValue) return results[0].rawValue
        return null
      } catch {
        return null
      }
    }
    // jsQR 폴백 — canvas 에 프레임을 떠서 픽셀 디코딩
    const canvas = canvasRef.current
    if (!canvas) return null
    const w = video.videoWidth
    const h = video.videoHeight
    if (!w || !h) return null
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, w, h)
    const imageData = ctx.getImageData(0, 0, w, h)
    const result = jsQR(imageData.data, w, h)
    return result?.data ?? null
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/60 p-6" role="dialog" aria-modal="true" data-component="CameraScanDialog">
      <div className="flex w-full max-w-[520px] flex-col gap-4 rounded-sf bg-surface p-6 shadow-modal">
        <header className="flex items-center justify-between gap-4">
          <h2 className="text-sf-xl font-bold">{mode === 'camera' ? '카메라로 스캔' : '직접 입력'}</h2>
          <button type="button" onClick={onClose} aria-label="닫기" className="flex h-touch-min w-touch-min items-center justify-center rounded-sf border-2 border-line">
            <IconX size={28} />
          </button>
        </header>

        {mode === 'camera' ? (
          <div className="flex flex-col gap-3">
            <div className="aspect-video w-full overflow-hidden rounded-sf border-2 border-line bg-black">
              <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
            </div>
            <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
            {cameraError ? <p className="text-sf-body font-bold text-status-error-fg">{cameraError}</p> : <p className="text-sf-body text-ink-muted">QR 코드를 카메라에 비추세요</p>}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sf-body">
              <span className="font-bold text-ink-muted">작업지시 코드 (WO-…)</span>
              <input
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                autoFocus
                className="min-h-touch rounded-sf border-2 border-line-strong bg-surface px-4 text-sf-lg font-mono"
                placeholder="예: WO-261001-0012"
              />
            </label>
            <p className="text-sf-body text-ink-muted">라벨이 훼손되어 스캔할 수 없을 때만 사용하세요. 체크코드 없이 존재 여부만 서버가 확인합니다.</p>
            <BigButton fullWidth disabled={manualCode.trim().length === 0} onClick={() => onManualSubmit(manualCode.trim().toUpperCase())}>
              확인
            </BigButton>
          </div>
        )}

        <button type="button" className="text-center text-sf-body text-brand-700 underline" onClick={() => setMode(mode === 'camera' ? 'manual' : 'camera')}>
          {mode === 'camera' ? '직접 입력으로 전환' : '카메라로 전환'}
        </button>
      </div>
    </div>
  )
}

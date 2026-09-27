/**
 * `/setup` 단말 등록 착지 — 관리자 QR URL(`?s=&k=&p=&v=1`) → 확인 → localStorage `sw.station` 저장 → 주소창 정리(history.replaceState)
 * → 「단말 등록 완료, 키오스크는 S2」. 현장 밀도. 키는 마스킹해서만 보여 준다.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BigButton, MobileCard, MobilePage, WarnBanner } from '@/shared/ui/shopfloor'
import { formatDateTime } from '@/admin/format'
import { loadStationConfig, maskKey, parseSetupParams, saveStationConfig, type StationConfig } from './setupParams'

export function SetupPage() {
  // 최초 렌더 시점의 쿼리만 쓴다 — 저장 후 주소창에서 키를 지우므로 useSearchParams 대신 window.location
  const parsed = useMemo(() => parseSetupParams(window.location.search), [])
  const [saved, setSaved] = useState<StationConfig | null>(null)
  const existing = useMemo(loadStationConfig, [])

  const register = () => {
    if (!parsed.ok) return
    const cfg = saveStationConfig(parsed.params)
    window.history.replaceState(null, '', '/setup')
    setSaved(cfg)
  }

  if (saved) {
    return (
      <MobilePage code={saved.station_id} typeLabel="단말 등록 완료" banner={<WarnBanner kind="warning" message="키오스크 화면은 S2 에서 만든다. 이 단말은 등록만 된 상태다" />}>
        <MobileCard
          items={[
            { label: '단말 ID', value: <span className="font-mono">{saved.station_id}</span> },
            { label: 'API key', value: <span className="font-mono">{maskKey(saved.api_key)}</span> },
            { label: '프린터', value: saved.printer_id ?? '—' },
            { label: '저장 위치', value: <span className="font-mono">localStorage sw.station</span> },
            { label: '저장 시각', value: formatDateTime(saved.saved_at) },
          ]}
        />
        <p className="text-sf-body text-ink-muted">주소창의 키는 지웠습니다. 이 브라우저(태블릿)를 그대로 키오스크로 쓰면 S2 에서 `/kiosk` 가 이 키로 접속합니다.</p>
      </MobilePage>
    )
  }

  if (!parsed.ok) {
    return (
      <MobilePage code="/setup" typeLabel="단말 등록" banner={<WarnBanner kind="error" message={parsed.reason === 'VERSION' ? '지원하지 않는 등록 QR 버전입니다 (v=1 만)' : '등록 URL 에 단말 ID(s)·키(k) 가 없습니다'} />}>
        <MobileCard title="어떻게 여나요">
          <p>관리자 웹 › 기준정보 › 단말(ADM-07)에서 단말 등록 또는 키 회전 시 1회 표시되는 QR 을 이 기기의 스캐너·카메라로 열면 여기로 옵니다 (api-contract §13.2 admin #15).</p>
        </MobileCard>
        {existing ? (
          <MobileCard title="이 기기에 저장된 단말" items={[{ label: '단말 ID', value: <span className="font-mono">{existing.station_id}</span> }, { label: '저장 시각', value: formatDateTime(existing.saved_at) }]} />
        ) : null}
        <Link to="/" className="block text-center text-sf-body text-brand-700 underline">
          처음으로
        </Link>
      </MobilePage>
    )
  }

  const p = parsed.params
  return (
    <MobilePage
      code={p.station_id}
      typeLabel="단말 등록 확인"
      banner={existing && existing.station_id !== p.station_id ? <WarnBanner kind="warning" message={`이 기기에는 이미 ${existing.station_id} 가 등록되어 있습니다. 등록하면 덮어씁니다`} /> : null}
      actions={
        <BigButton fullWidth size="lg" onClick={register}>
          이 기기를 {p.station_id} 로 등록
        </BigButton>
      }
    >
      <MobileCard
        items={[
          { label: '단말 ID', value: <span className="font-mono">{p.station_id}</span> },
          { label: 'API key', value: <span className="font-mono">{maskKey(p.api_key)}</span> },
          { label: '프린터', value: p.printer_id ?? '— (없음)' },
          { label: '버전', value: `v${p.v}` },
        ]}
      />
      <p className="text-sf-body text-ink-muted">등록하면 키가 이 브라우저의 localStorage 에 저장되고 주소창에서 지워집니다. 키는 다시 볼 수 없으며, 분실 시 관리자가 키 회전으로 재발급합니다.</p>
    </MobilePage>
  )
}

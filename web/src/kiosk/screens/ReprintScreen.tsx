/**
 * KSK-70 라벨 재발행 — WO 검색 (screens-shopfloor §1 KSK-70, [S4]). 라벨 훼손·분실(E5) — 스캔할 수
 * 없으니 검색으로 찾는다. `GET /wo/search?q=` → 결과 탭 → 확인 카드 → `POST /labels/print`
 * (`label_type:"WO_LABEL"`) — `reprintLogic.ts` 참고. 오프라인·프린터 미설정은 [출력]을 막되 조용히
 * 숨기지 않는다(절대 규칙 3).
 */
import { useEffect, useState } from 'react'
import { stationApi } from '@/shared/api'
import { isApiError } from '@/shared/api/client'
import { useDebouncedValue } from '@/shared/hooks'
import { BigButton, StatusBadge, TextEntry, WarnBanner } from '@/shared/ui/shopfloor'
import { IconCheck, IconTag, IconX } from '@/shared/ui/icons'
import { PrintMethodCodeLabel } from '@/shared/labels'
import { buildWoLabelReprintRequest, shouldSearch } from '../reprintLogic'
import type { LabelJob, WorkOrderSummary } from '@/shared/types'

export type ReprintScreenProps = {
  printerId: string | null
  offline: boolean
  onBack: () => void
}

type Phase = 'search' | 'confirm' | 'done'

export function ReprintScreen({ printerId, offline, onBack }: ReprintScreenProps) {
  const [query, setQuery] = useState('')
  const debounced = useDebouncedValue(query, 300)
  const [results, setResults] = useState<WorkOrderSummary[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const [phase, setPhase] = useState<Phase>('search')
  const [selected, setSelected] = useState<WorkOrderSummary | null>(null)
  const [printing, setPrinting] = useState(false)
  const [printError, setPrintError] = useState<string | null>(null)
  const [labelJob, setLabelJob] = useState<LabelJob | null>(null)

  useEffect(() => {
    if (!shouldSearch(debounced)) {
      setResults([])
      setSearchError(null)
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    setSearchError(null)
    stationApi
      .searchWo(debounced)
      .then((rows) => {
        if (cancelled) return
        setResults(rows)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setResults([])
        setSearchError(isApiError(e) ? e.message : '검색에 실패했습니다')
      })
      .finally(() => {
        if (!cancelled) setSearching(false)
      })
    return () => {
      cancelled = true
    }
  }, [debounced])

  function selectWo(wo: WorkOrderSummary) {
    setSelected(wo)
    setPrintError(null)
    setLabelJob(null)
    setPhase('confirm')
  }

  async function doPrint() {
    if (!selected || !printerId) return
    setPrinting(true)
    setPrintError(null)
    try {
      const job = await stationApi.printLabel(buildWoLabelReprintRequest(selected, printerId))
      setLabelJob(job)
      setPhase('done')
    } catch (e) {
      setPrintError(isApiError(e) && e.status === 503 ? '프린터 연결 실패 — 다시 누르세요' : isApiError(e) ? e.message : '라벨 재발행에 실패했습니다')
    } finally {
      setPrinting(false)
    }
  }

  if (phase === 'confirm' && selected) {
    const canPrint = !offline && !!printerId
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <h2 className="text-sf-xl font-bold">라벨 재발행</h2>
        <div className="flex flex-col gap-2 rounded-sf border-2 border-line bg-surface p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-sf-xl font-bold">{selected.code}</span>
            <StatusBadge kind="wo" status={selected.status} density="shopfloor" />
          </div>
          <p className="text-sf-lg">{selected.customer_name}</p>
          <p className="text-sf-body text-ink-muted">
            {selected.item.name}
            {selected.item.spec ? ` · ${selected.item.spec}` : ''}
            {selected.item.color ? ` · ${selected.item.color}` : ''}
          </p>
          <p className="text-sf-body text-ink-muted">
            가공방식 {PrintMethodCodeLabel[selected.print_method]} · 수량 {selected.qty_ordered.toLocaleString('ko-KR')} · 납기 {selected.due_date}
          </p>
        </div>
        <p className="text-sf-body font-bold">WO 라벨을 다시 출력합니다 (차수 +1)</p>

        {offline ? <WarnBanner kind="offline" message="오프라인 — 재발행은 연결 후 가능합니다" /> : !printerId ? <WarnBanner kind="warning" message="프린터 미설정 — 관리자 문의" /> : null}
        {printError ? <WarnBanner kind="error" message={printError} /> : null}

        <div className="flex gap-touch-gap">
          <BigButton variant="secondary" onClick={() => setPhase('search')}>
            뒤로
          </BigButton>
          <BigButton size="lg" fullWidth icon={<IconTag size={24} />} disabled={!canPrint || printing} loading={printing} onClick={() => void doPrint()}>
            출력
          </BigButton>
        </div>
      </div>
    )
  }

  if (phase === 'done' && selected) {
    // QA2-S4 수정(DEF-QA2-S4-003): §13.7 계약상 프린터 실패는 예외가 아니라 200 + zpl_sent=false
    // 로 돌아온다(발행 차수는 이미 올라간다) — printLabel() 이 성공적으로 resolve 됐다고 해서
    // 실제로 라벨이 나왔다는 뜻이 아니다. 이 화면이 zpl_sent 를 보지 않고 무조건 성공 화면으로
    // 넘어가던 것을, 같은 원칙을 이미 쓰고 있는 PackResultScreen(라벨 미출력/재출력) 패턴 그대로
    // 맞춘다 — "조용한 실패 금지".
    const printed = labelJob?.zpl_sent === true
    return (
      <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 pt-8 text-center">
        {printed ? (
          <>
            <IconCheck size={64} className="text-status-done-fg" aria-hidden="true" />
            <p className="text-sf-xl font-bold">재발행 {labelJob?.issue_no ?? '—'}차 출력됨</p>
          </>
        ) : (
          <>
            <IconX size={64} className="text-status-error-fg" aria-hidden="true" />
            <p className="text-sf-xl font-bold text-status-error-fg" role="alert">
              라벨 미출력 — {labelJob?.error === 'PRINTER_UNREACHABLE' ? '프린터 연결 실패' : (labelJob?.error ?? '출력 실패')}
            </p>
            <p className="text-sf-body text-ink-muted">발행 이력은 {labelJob?.issue_no ?? '—'}차로 기록됐습니다 — 프린터 확인 후 다시 출력하세요.</p>
          </>
        )}
        <p className="font-mono text-sf-lg">{selected.code}</p>
        <div className="flex gap-touch-gap">
          <BigButton
            variant="secondary"
            onClick={() => {
              setPhase('search')
              setSelected(null)
            }}
          >
            다른 WO 검색
          </BigButton>
          {printed ? (
            <BigButton onClick={onBack}>완료</BigButton>
          ) : (
            <BigButton icon={<IconTag size={24} />} loading={printing} disabled={printing || !printerId || offline} onClick={() => void doPrint()}>
              다시 출력
            </BigButton>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h2 className="text-sf-xl font-bold">라벨 재발행 — 작업지시 검색</h2>
      <TextEntry value={query} onChange={setQuery} label="거래처명 · SO 번호 · 품목" placeholder="2자 이상 입력하세요" maxLength={60} autoFocus hint="2자 이상 입력하면 자동으로 검색합니다" />

      {searching ? <p className="text-sf-body text-ink-muted">검색 중…</p> : null}
      {searchError ? <WarnBanner kind="error" message={searchError} /> : null}
      {!searching && !searchError && shouldSearch(debounced) && results.length === 0 ? <p className="text-sf-body text-ink-muted">검색 결과 없음</p> : null}

      <ul className="flex flex-col gap-2">
        {results.map((wo) => {
          const dim = wo.status === 'CANCELLED' || wo.status === 'CLOSED'
          return (
            <li key={wo.id}>
              <button
                type="button"
                onClick={() => selectWo(wo)}
                className={`flex min-h-touch w-full flex-col gap-1 rounded-sf border-2 px-4 py-3 text-left active:bg-surface-3 ${dim ? 'border-line bg-surface-2 text-ink-muted' : 'border-line-strong bg-surface'}`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="font-mono text-sf-lg font-bold">{wo.code}</span>
                  <StatusBadge kind="wo" status={wo.status} density="shopfloor" />
                </span>
                <span className="text-sf-body">
                  {wo.customer_name} · {wo.so_code}
                </span>
                <span className="text-sf-body text-ink-muted">
                  {wo.item.name}
                  {wo.item.spec ? ` · ${wo.item.spec}` : ''}
                  {wo.item.color ? ` · ${wo.item.color}` : ''} · {wo.qty_ordered.toLocaleString('ko-KR')}장 · 납기 {wo.due_date}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <BigButton variant="secondary" icon={<IconX size={20} />} onClick={onBack}>
        취소
      </BigButton>
    </div>
  )
}

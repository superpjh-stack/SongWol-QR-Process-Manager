/**
 * 오프라인 큐 — screens-shopfloor §0.6 그대로 구현.
 *
 * 순서: 모든 스캔은 **먼저** IndexedDB `pending_scans` 에 쓰고, 그 다음 `POST /scan` 을 시도한다
 * (온라인이어도 항상 이 경로). HTTP 200 이 오면(OK/WARN/REJECT 어느 결과든) 큐에서 지운다. 401/403/503/
 * 네트워크 오류/타임아웃이면 큐에 남기고 `attempts+1`·`last_error` 를 기록한다. 422(형식 오류)는 서버가
 * 영원히 받아주지 않을 요청이므로 큐에서 제거하고 화면에 오류를 보여준다(§0.8 KSK-40).
 *
 * flush 는 `POST /scan/batch` 로 `client_seq` 오름차순, 최대 200건씩 보낸다(§5.3). 트리거는 온라인 복귀·
 * visibilitychange visible·30초 주기 — 이 모듈은 트리거를 걸지 않는다(부수효과는 `useOfflineQueue` 훅이
 * 등록한다), `flushQueue()` 자체는 순수하게 "지금 큐를 한 번 비운다"만 한다.
 */
import { ApiError, isApiError } from '../api/client'
import { scanApi } from '../api/scan'
import type { PendingScanRecord, ScanBatchResponse, ScanRequest, ScanResponse } from '../types'
import { getDb, STORE } from './db'

/** 8시간 보존 한도 초과 판정 기준 (§0.6) */
export const STALE_MS = 8 * 60 * 60 * 1000
/** flush 후에도 재시도를 멈추는 기준 — 화면에는 계속 보인다(삭제하지 않는다) */
export const MAX_ATTEMPTS = 5
/** POST /scan/batch 1회 최대 건수 (api-contract §5.3) */
export const BATCH_MAX = 200
/** KSK-40 개별 전송 타임아웃 — 넘으면 오프라인(큐 유지)으로 처리 (§0.6) */
export const SUBMIT_TIMEOUT_MS = 5000

const SEQ_KEY = 'sw.offline.client_seq'

/** 단말 로컬 단조 증가 정수 (재부팅 후에도 이어짐 — localStorage 로 보존) */
export function nextClientSeq(): number {
  try {
    const cur = Number(localStorage.getItem(SEQ_KEY) ?? '0')
    const next = (Number.isFinite(cur) ? cur : 0) + 1
    localStorage.setItem(SEQ_KEY, String(next))
    return next
  } catch {
    // 저장 실패해도 순번은 내야 한다 — 이 세션 안에서만 유효한 값으로 대체
    return Date.now()
  }
}

type Listener = () => void
const listeners = new Set<Listener>()
/** 큐 내용이 바뀔 때(추가·제거·attempts 갱신) 구독자에게 알린다. `useOfflineQueue` 가 재조회에 쓴다 */
export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function notify(): void {
  for (const fn of listeners) fn()
}

export async function enqueue(req: ScanRequest): Promise<PendingScanRecord> {
  const db = await getDb()
  const rec: PendingScanRecord = {
    event_uuid: req.event_uuid,
    payload: req,
    created_at: new Date().toISOString(),
    attempts: 0,
    last_error: null,
    client_seq: req.client_seq ?? nextClientSeq(),
  }
  await db.put(STORE, rec)
  notify()
  return rec
}

export async function remove(eventUuid: string): Promise<void> {
  const db = await getDb()
  await db.delete(STORE, eventUuid)
  notify()
}

async function markAttempt(eventUuid: string, error: string): Promise<void> {
  const db = await getDb()
  const rec = await db.get(STORE, eventUuid)
  if (!rec) return
  rec.attempts += 1
  rec.last_error = error
  await db.put(STORE, rec)
  notify()
}

/** client_seq 오름차순 전체 목록 */
export async function listAll(): Promise<PendingScanRecord[]> {
  const db = await getDb()
  return db.getAllFromIndex(STORE, 'client_seq')
}

export async function pendingCount(): Promise<number> {
  const db = await getDb()
  return db.count(STORE)
}

export function isStale(rec: PendingScanRecord, now = Date.now()): boolean {
  return now - new Date(rec.created_at).getTime() > STALE_MS
}

function errorMessageOf(e: unknown): string {
  if (isApiError(e)) return e.message
  if (e instanceof DOMException && e.name === 'AbortError') return '요청 시간 초과'
  if (e instanceof Error) return e.message
  return '네트워크 오류'
}

export type SubmitOutcome =
  | { status: 'ok'; response: ScanResponse }
  | { status: 'queued' }
  | { status: 'invalid'; error: ApiError }

/**
 * KSK-40 의 단일 스캔 전송. "저장 → 전송 → (200 이면) 삭제" 순서를 항상 지킨다 — 온라인이어도 먼저 큐에 쓴다.
 * - 200 (OK/WARN/REJECT 무관): 큐 삭제, `{status:'ok', response}`
 * - 422 (형식 오류, §0.8): 서버가 다시 받아줄 리 없으니 큐 삭제, `{status:'invalid', error}` — 화면은 "수량 다시 입력"으로 보낸다
 * - 401/403/503/네트워크/타임아웃: 큐 유지 + attempts 증가, `{status:'queued'}`
 */
export async function submitScan(req: ScanRequest, timeoutMs = SUBMIT_TIMEOUT_MS): Promise<SubmitOutcome> {
  await enqueue(req)

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await scanApi.submit(req, controller.signal)
    await remove(req.event_uuid)
    return { status: 'ok', response }
  } catch (e) {
    if (isApiError(e) && e.status === 422) {
      await remove(req.event_uuid)
      return { status: 'invalid', error: e }
    }
    await markAttempt(req.event_uuid, errorMessageOf(e))
    return { status: 'queued' }
  } finally {
    window.clearTimeout(timer)
  }
}

export type SubmitBatchOutcome =
  | { status: 'ok'; results: Array<{ event_uuid: string; response: ScanResponse }> }
  | { status: 'queued' }

/**
 * PDA-21 [발송 확정] — 박스 여러 개를 SHIP 이벤트 여러 건으로 묶어 "저장 → 즉시 배치 전송" 한다
 * (screens-shopfloor §2 PDA-21 "박스 1개당 SHIP 이벤트 1건을 만들어 큐에 넣고 즉시 POST /scan/batch 로
 * 한 번에 전송"). `submitScan` 의 다건판 — 같은 저장소(`pending_scans`)·같은 제거 규칙(200 이면 삭제)을
 * 쓴다, 새 큐를 만들지 않는다. 온라인이면 즉시 결과를 받아 화면(PDA-22)이 건별 성공/실패를 보여줄 수
 * 있고, 오프라인/실패면 큐에 남아 `useOfflineQueue` 의 통상 flush 트리거(온라인 복귀·30초·visibility)가
 * 나중에 처리한다.
 */
export async function submitBatch(events: ScanRequest[]): Promise<SubmitBatchOutcome> {
  for (const req of events) await enqueue(req)
  try {
    const batchRes = await scanApi.batch(events)
    for (const item of batchRes.results) {
      if (item.event_uuid) await remove(item.event_uuid)
    }
    return { status: 'ok', results: batchRes.results }
  } catch (e) {
    const msg = errorMessageOf(e)
    for (const req of events) await markAttempt(req.event_uuid, msg)
    return { status: 'queued' }
  }
}

export type FlushResult = { attempted: number; removed: number; responses: Array<{ event_uuid: string; response: ScanResponse }> }

let flushing = false

/**
 * 지금 큐를 한 번 비운다 (§5.3 `/scan/batch`, client_seq 오름차순, 최대 200건씩).
 * `attempts >= MAX_ATTEMPTS` 인 건은 이번 배치에서 제외한다(무한 재시도 방지) — 화면에는 계속 보인다.
 * 배치 요청 자체가 실패(네트워크·401·403·503)하면 그 청크 전원의 attempts 를 올리고 다음 청크는 계속 시도한다.
 */
export async function flushQueue(): Promise<FlushResult | null> {
  if (flushing) return null
  flushing = true
  try {
    const all = await listAll()
    const active = all.filter((r) => r.attempts < MAX_ATTEMPTS)
    const responses: Array<{ event_uuid: string; response: ScanResponse }> = []
    let removed = 0

    for (let i = 0; i < active.length; i += BATCH_MAX) {
      const chunk = active.slice(i, i + BATCH_MAX)
      let batchResponse: ScanBatchResponse
      try {
        batchResponse = await scanApi.batch(chunk.map((r) => r.payload))
      } catch (e) {
        const msg = errorMessageOf(e)
        for (const r of chunk) await markAttempt(r.event_uuid, msg)
        continue
      }
      for (const item of batchResponse.results) {
        if (item.event_uuid) {
          await remove(item.event_uuid)
          removed++
          responses.push({ event_uuid: item.event_uuid, response: item.response })
        }
        // event_uuid 없는 건(형식 오류 자체가 uuid 를 못 실은 극단 케이스, §13.5 ⑦) — 원본을 찾을 수 없어 그대로 둔다
      }
    }
    notify()
    return { attempted: active.length, removed, responses }
  } finally {
    flushing = false
  }
}

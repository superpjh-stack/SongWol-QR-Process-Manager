/**
 * 오프라인 포장(§13.7 ⑬) 라벨 부착 확인 목록 — flush 로 실제 커밋된 PACK 박스를 작업자가 [부착 완료] 로
 * 확인할 때까지 IndexedDB 에 보존한다. React 상태가 아니라 별도 스토어인 이유: KSK-80 은 온라인 복귀·
 * visibilitychange·30초 주기 중 **화면을 보고 있지 않을 때도** flush 될 수 있고(§0.6), 그 순간 React 상태에만
 * 담아두면 새로고침·재부팅으로 "라벨은 인쇄됐는데 어느 박스인지 모른다"는, 이 기능이 막으려는 바로 그
 * 사고가 재발한다(조용한 실패 금지 원칙).
 */
import type { LabelJob } from '../types'
import { getDb, CONFIRM_STORE } from './db'

export type PackLabelConfirmation = {
  /** React key / IDB keyPath — 원본 scan event_uuid */
  id: string
  /** #n — 오프라인 중 화면에 보여준 임시 순번과 같은 값(= client_seq). 라벨에도 "임시 #n" 으로 인쇄된다 */
  n: number
  woCode: string
  boxCode: string
  boxNo: number
  qty: number
  labelJob: LabelJob | null
  /** flush(또는 마지막 재출력) 시각 ISO */
  at: string
}

/** flush 로 새로 커밋된 확인 행을 저장한다(이미 있는 id 는 덮어쓴다 — 재시도로 두 번 올 일은 없지만 방어적) */
export async function recordPackConfirmations(rows: PackLabelConfirmation[]): Promise<void> {
  if (rows.length === 0) return
  const db = await getDb()
  const tx = db.transaction(CONFIRM_STORE, 'readwrite')
  await Promise.all([...rows.map((r) => tx.store.put(r)), tx.done])
}

/** #n 오름차순 전체 목록 (§13.7 "출력 순서 = #n 순") */
export async function listPackConfirmations(): Promise<PackLabelConfirmation[]> {
  const db = await getDb()
  return db.getAllFromIndex(CONFIRM_STORE, 'n')
}

/** [재출력] 성공 후 저장된 라벨 상태를 갱신한다(화면을 벗어나도 최신 출력 결과가 남는다) */
export async function updatePackConfirmationLabel(id: string, labelJob: LabelJob): Promise<void> {
  const db = await getDb()
  const rec = await db.get(CONFIRM_STORE, id)
  if (!rec) return
  await db.put(CONFIRM_STORE, { ...rec, labelJob, at: new Date().toISOString() })
}

/** [부착 완료] — 작업자가 확인한 행을 지운다. 삭제 버튼이 없는 오프라인 큐(§0.6)와 달리, 이건 "물리적으로
 * 다 붙였다"는 작업자의 명시적 확인이라 지우는 것이 맞다(유실이 아니라 완료 처리) */
export async function ackPackConfirmations(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const db = await getDb()
  const tx = db.transaction(CONFIRM_STORE, 'readwrite')
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done])
}

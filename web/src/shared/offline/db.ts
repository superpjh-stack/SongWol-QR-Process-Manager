/**
 * 오프라인 큐 IndexedDB 스토어 (screens-shopfloor §0.6, ts-types §6 `PendingScanRecord`).
 * 스토어 `pending_scans`, keyPath `event_uuid`, 인덱스 `client_seq`(배치 전송 순서 보장용).
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { PendingScanRecord } from '../types'
import type { PackLabelConfirmation } from './packConfirmations'

const DB_NAME = 'sw-offline-queue'
const DB_VERSION = 2
export const STORE = 'pending_scans'
/** 오프라인 포장 라벨 부착 확인 목록 (§13.7 ⑬) — [부착 완료] 전까지 보존한다(0007 새 스토어) */
export const CONFIRM_STORE = 'pack_confirmations'

interface OfflineDB extends DBSchema {
  pending_scans: {
    key: string
    value: PendingScanRecord
    indexes: { client_seq: number }
  }
  pack_confirmations: {
    key: string
    value: PackLabelConfirmation
    indexes: { n: number }
  }
}

let dbPromise: Promise<IDBPDatabase<OfflineDB>> | null = null

export function getDb(): Promise<IDBPDatabase<OfflineDB>> {
  if (!dbPromise) {
    dbPromise = openDB<OfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'event_uuid' })
          store.createIndex('client_seq', 'client_seq')
        }
        if (!db.objectStoreNames.contains(CONFIRM_STORE)) {
          const store = db.createObjectStore(CONFIRM_STORE, { keyPath: 'id' })
          store.createIndex('n', 'n')
        }
      },
    })
  }
  return dbPromise
}

/** 테스트 전용 — 모듈 캐시된 DB 핸들을 지워 다음 `getDb()` 가 새로 연다 */
export function _resetDbForTests(): void {
  dbPromise = null
}

/**
 * 오프라인 큐 IndexedDB 스토어 (screens-shopfloor §0.6, ts-types §6 `PendingScanRecord`).
 * 스토어 `pending_scans`, keyPath `event_uuid`, 인덱스 `client_seq`(배치 전송 순서 보장용).
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { PendingScanRecord } from '../types'

const DB_NAME = 'sw-offline-queue'
const DB_VERSION = 1
export const STORE = 'pending_scans'

interface OfflineDB extends DBSchema {
  pending_scans: {
    key: string
    value: PendingScanRecord
    indexes: { client_seq: number }
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
      },
    })
  }
  return dbPromise
}

/** 테스트 전용 — 모듈 캐시된 DB 핸들을 지워 다음 `getDb()` 가 새로 연다 */
export function _resetDbForTests(): void {
  dbPromise = null
}

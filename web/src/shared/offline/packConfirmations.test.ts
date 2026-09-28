/**
 * `pack_confirmations` 스토어(§13.7 ⑬ 라벨 부착 확인 목록) — 쓰기·조회·갱신·[부착 완료] 삭제가 IndexedDB
 * 스키마(0.6→0.7, `db.ts` DB_VERSION 2)와 실제로 맞물려 동작하는지 확인한다. `offlineQueue.test.ts` 와
 * 같은 fake-indexeddb 방식.
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { PackLabelConfirmation } from './packConfirmations'

function row(overrides: Partial<PackLabelConfirmation> = {}): PackLabelConfirmation {
  return {
    id: 'e1',
    n: 5,
    woCode: 'WO-261001-0012',
    boxCode: 'LT-261001-0007',
    boxNo: 3,
    qty: 60,
    labelJob: { issue_no: 1, label_type: 'BOX_LABEL', printer_id: 'LP-PACK-1', copies: 1, sent_at: 'x', pdf_url: null, zpl_sent: true, error: null },
    at: '2026-10-01T09:05:00+09:00',
    ...overrides,
  }
}

describe('packConfirmations (§13.7 ⑬ 오프라인 포장 라벨 부착 확인)', () => {
  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).indexedDB = new (await import('fake-indexeddb')).IDBFactory()
    const db = await import('./db')
    db._resetDbForTests()
  })

  it('저장한 행을 #n(n) 오름차순으로 돌려준다', async () => {
    const { recordPackConfirmations, listPackConfirmations } = await import('./packConfirmations')
    await recordPackConfirmations([row({ id: 'c', n: 9 }), row({ id: 'a', n: 3 }), row({ id: 'b', n: 6 })])
    const rows = await listPackConfirmations()
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('재출력 후 labelJob 을 갱신한다 — 화면을 벗어나도 최신 출력 결과가 남는다', async () => {
    const { recordPackConfirmations, listPackConfirmations, updatePackConfirmationLabel } = await import('./packConfirmations')
    await recordPackConfirmations([row({ id: 'e1', labelJob: { issue_no: 1, label_type: 'BOX_LABEL', printer_id: 'LP-PACK-1', copies: 1, sent_at: null, pdf_url: null, zpl_sent: false, error: 'PRINTER_UNREACHABLE' } })])
    await updatePackConfirmationLabel('e1', { issue_no: 2, label_type: 'BOX_LABEL', printer_id: 'LP-PACK-1', copies: 1, sent_at: 'y', pdf_url: null, zpl_sent: true, error: null })
    const rows = await listPackConfirmations()
    expect(rows[0]?.labelJob?.zpl_sent).toBe(true)
    expect(rows[0]?.labelJob?.issue_no).toBe(2)
  })

  it('[부착 완료](ackPackConfirmations) 로 확인한 행만 지운다 — 나머지는 남는다(유실 금지)', async () => {
    const { recordPackConfirmations, listPackConfirmations, ackPackConfirmations } = await import('./packConfirmations')
    await recordPackConfirmations([row({ id: 'a', n: 1 }), row({ id: 'b', n: 2 })])
    await ackPackConfirmations(['a'])
    const rows = await listPackConfirmations()
    expect(rows.map((r) => r.id)).toEqual(['b'])
  })

  it('IDB 연결이 새로 열려도(새로고침 흉내) 확인 전 행은 그대로 남아 있다 — 데이터는 연결이 아니라 디스크에 있다', async () => {
    const db = await import('./db')
    const { recordPackConfirmations, listPackConfirmations } = await import('./packConfirmations')
    await recordPackConfirmations([row({ id: 'e1' })])

    db._resetDbForTests() // 모듈 캐시된 연결만 버린다 — 같은 인메모리 IndexedDB(파일과 동격) 는 그대로
    const rows = await listPackConfirmations() // getDb() 가 다시 연결을 맺고 같은 스토어를 읽는다
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('e1')
  })
})

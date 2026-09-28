import { describe, expect, it } from 'vitest'
import { canCancelEvent, cancelledEventUuids } from './eventCancel'

describe('cancelledEventUuids', () => {
  it('CANCEL 이벤트의 compensates_uuid 를 모은다', () => {
    const events = [
      { action: 'START', compensates_uuid: null },
      { action: 'CANCEL', compensates_uuid: 'uuid-1' },
      { action: 'DONE', compensates_uuid: null },
      { action: 'CANCEL', compensates_uuid: 'uuid-2' },
    ] as const
    expect(cancelledEventUuids(events)).toEqual(new Set(['uuid-1', 'uuid-2']))
  })
  it('CANCEL 이벤트가 없으면 빈 집합', () => {
    expect(cancelledEventUuids([{ action: 'START', compensates_uuid: null }] as const)).toEqual(new Set())
  })
})

describe('canCancelEvent', () => {
  const cancelled = new Set(['uuid-1'])
  it('CANCEL 이벤트 자신은 다시 취소할 수 없다', () => {
    expect(canCancelEvent({ event_uuid: 'uuid-9', action: 'CANCEL' }, cancelled)).toBe(false)
  })
  it('이미 보상된 이벤트는 취소할 수 없다', () => {
    expect(canCancelEvent({ event_uuid: 'uuid-1', action: 'START' }, cancelled)).toBe(false)
  })
  it('취소되지 않은 일반 이벤트는 취소할 수 있다', () => {
    expect(canCancelEvent({ event_uuid: 'uuid-2', action: 'DONE' }, cancelled)).toBe(true)
  })
})

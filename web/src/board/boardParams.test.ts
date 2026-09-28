/** boardParams — `/board?key=` 주입·저장 (screens-shopfloor §5 ㉒) */
import { beforeEach, describe, expect, it } from 'vitest'
import { loadBoardKey, parseBoardKey, saveBoardKey } from './boardParams'
import { loadStationConfig } from '@/shared/hooks/useStationConfig'

describe('parseBoardKey', () => {
  it('?key= 값을 돌려준다', () => {
    expect(parseBoardKey('?key=abc123')).toBe('abc123')
  })
  it('key 가 없으면 null', () => {
    expect(parseBoardKey('?foo=bar')).toBeNull()
  })
  it('빈 문자열이면 null', () => {
    expect(parseBoardKey('?key=')).toBeNull()
  })
})

describe('saveBoardKey / loadBoardKey', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('저장 후 loadBoardKey 로 같은 키를 읽는다', () => {
    saveBoardKey('board-key-1')
    expect(loadBoardKey()).toBe('board-key-1')
  })

  it('stationHeaders() 가 읽는 sw.station 저장소를 그대로 쓴다', () => {
    saveBoardKey('board-key-2')
    const cfg = loadStationConfig()
    expect(cfg?.api_key).toBe('board-key-2')
  })

  it('저장 전에는 null', () => {
    expect(loadBoardKey()).toBeNull()
  })
})

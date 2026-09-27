/** /setup 단말 등록 URL 파싱·저장 (api-contract §13.2 admin #15: ?s=&k=&p=&v=1) */
import { beforeEach, describe, expect, it } from 'vitest'
import { STATION_KEY, loadStationConfig, maskKey, parseSetupParams, saveStationConfig } from './setupParams'

describe('setupParams', () => {
  beforeEach(() => localStorage.clear())

  it('s·k·v=1 → ok, 단말·프린터 ID 는 대문자 정규화(D28), p 없으면 null', () => {
    const r = parseSetupParams('?s=k-p30-1&k=abcdefgh12345678&v=1')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.params).toEqual({ station_id: 'K-P30-1', api_key: 'abcdefgh12345678', printer_id: null, v: '1' })
    const r2 = parseSetupParams(new URLSearchParams('s=K-P50-1&k=x1&p=lp-pack-1&v=1'))
    if (r2.ok) expect(r2.params.printer_id).toBe('LP-PACK-1')
  })
  it('s 또는 k 없음 → MISSING, v≠1 → VERSION', () => {
    expect(parseSetupParams('?s=K-P30-1&v=1')).toEqual({ ok: false, reason: 'MISSING' })
    expect(parseSetupParams('?k=abc&v=1')).toEqual({ ok: false, reason: 'MISSING' })
    expect(parseSetupParams('?s=K-P30-1&k=abc&v=2')).toEqual({ ok: false, reason: 'VERSION' })
    expect(parseSetupParams('?s=K-P30-1&k=abc')).toEqual({ ok: false, reason: 'VERSION' })
  })
  it('저장 → localStorage sw.station JSON, 다시 읽기 왕복', () => {
    const cfg = saveStationConfig({ station_id: 'K-P30-1', api_key: 'abcdefgh12345678', printer_id: null, v: '1' }, new Date('2026-10-02T00:00:00Z'))
    expect(JSON.parse(localStorage.getItem(STATION_KEY)!)).toEqual(cfg)
    expect(loadStationConfig()).toEqual(cfg)
    localStorage.setItem(STATION_KEY, '{broken')
    expect(loadStationConfig()).toBeNull()
  })
  it('maskKey 는 앞 4자만 남긴다', () => {
    expect(maskKey('abcdefgh12345678')).toBe('abcd************')
    expect(maskKey('ab')).toBe('****')
  })
})

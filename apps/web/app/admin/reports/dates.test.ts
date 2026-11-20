import { describe, expect, it } from 'vitest'
import { dayNav, manilaStamp, manilaTime, manilaToday, parseDay } from './dates'

describe('manilaToday', () => {
  it('rolls over at Manila midnight (UTC+8), not UTC midnight', () => {
    expect(manilaToday(Date.parse('2026-11-20T15:59:59Z'))).toBe('2026-11-20')
    expect(manilaToday(Date.parse('2026-11-20T16:00:00Z'))).toBe('2026-11-21')
  })
})

describe('dayNav', () => {
  it('links to the day before and after, and labels the day', () => {
    expect(dayNav('2026-11-20', '2026-11-21')).toEqual({ prev: '2026-11-19', next: '2026-11-21', label: 'Fri 20 Nov 2026' })
  })
  it('has no next on today', () => {
    expect(dayNav('2026-11-21', '2026-11-21')).toEqual({ prev: '2026-11-20', next: null, label: 'Sat 21 Nov 2026' })
  })
  it('crosses month and year ends', () => {
    expect(dayNav('2026-01-01', '2026-11-21').prev).toBe('2025-12-31')
    expect(dayNav('2026-02-28', '2026-11-21').next).toBe('2026-03-01')
  })
})

describe('parseDay', () => {
  const today = '2026-11-21'
  it('keeps a real past day', () => expect(parseDay('2026-11-01', today)).toBe('2026-11-01'))
  it('falls back to today on a bad month, a missing value or junk', () => {
    expect(parseDay('2026-13-01', today)).toBe(today)
    expect(parseDay('2026-02-30', today)).toBe(today)
    expect(parseDay(undefined, today)).toBe(today)
    expect(parseDay('yesterday', today)).toBe(today)
  })
  it('does not go past today', () => expect(parseDay('2026-12-01', today)).toBe(today))
})

describe('manilaTime and manilaStamp', () => {
  it('show Manila clock time, across the UTC date line', () => {
    expect(manilaTime('2026-11-20T16:05:00Z')).toBe('00:05')
    expect(manilaStamp('2026-11-20T16:05:00Z')).toBe('21 Nov, 00:05')
  })
})

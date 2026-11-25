import { describe, expect, it } from 'vitest'
import { formatClosingTime, isShopOpenNow, isValidClosingTime, nextOpeningText } from './shop-hours.ts'

// Helper: Manila wall clock UTC+8 -> epoch ms
const manila = (isoNoOffset: string) => Date.parse(`${isoNoOffset}+08:00`)

describe('shop-hours', () => {
  it('validates and formats HH:MM closing times', () => {
    expect(isValidClosingTime('23:00')).toBe(true)
    expect(isValidClosingTime('00:30')).toBe(true)
    expect(isValidClosingTime('24:00')).toBe(false)
    expect(isValidClosingTime('9:00')).toBe(false)
    expect(formatClosingTime('23:00')).toBe('11:00 PM')
    expect(formatClosingTime('00:30')).toBe('12:30 AM')
  })

  it('respects manual close regardless of schedule', () => {
    // Thursday 2:00 PM
    expect(isShopOpenNow({ isOpen: false, closingTime: '23:00', updatedAt: 0 }, manila('2026-11-26T14:00:00'))).toBe(false)
  })

  it('opens at 10am weekdays and 3pm weekends, closes at 11pm', () => {
    // 2026-11-26 is Thursday (weekday)
    const thu = { isOpen: true, closingTime: '23:00', updatedAt: manila('2026-11-25T10:00:00') }
    expect(isShopOpenNow(thu, manila('2026-11-26T09:59:00'))).toBe(false)
    expect(isShopOpenNow(thu, manila('2026-11-26T10:00:00'))).toBe(true)
    expect(isShopOpenNow(thu, manila('2026-11-26T22:59:00'))).toBe(true)
    expect(isShopOpenNow(thu, manila('2026-11-26T23:00:00'))).toBe(false)

    // 2026-11-28 is Saturday (weekend)
    const sat = { isOpen: true, closingTime: '23:00', updatedAt: manila('2026-11-27T10:00:00') }
    expect(isShopOpenNow(sat, manila('2026-11-28T14:59:00'))).toBe(false)
    expect(isShopOpenNow(sat, manila('2026-11-28T15:00:00'))).toBe(true)
    expect(isShopOpenNow(sat, manila('2026-11-28T23:00:00'))).toBe(false)
  })

  it('allows explicit Open override after closingTime or before openingTime', () => {
    const lateOpen = { isOpen: true, closingTime: '23:00', updatedAt: manila('2026-11-26T23:05:00') }
    expect(isShopOpenNow(lateOpen, manila('2026-11-26T23:30:00'))).toBe(true)

    const earlyOpen = { isOpen: true, closingTime: '23:00', updatedAt: manila('2026-11-26T09:30:00') }
    expect(isShopOpenNow(earlyOpen, manila('2026-11-26T09:45:00'))).toBe(true)
  })

  it('formats next opening text for weekdays and weekends', () => {
    // Thursday 01:44 AM -> Opens today at 10:00 AM
    expect(nextOpeningText(manila('2026-11-26T01:44:00'))).toBe('Opens today at 10:00 AM')
    // Friday 11:30 PM -> Opens tomorrow at 3:00 PM (Saturday)
    expect(nextOpeningText(manila('2026-11-27T23:30:00'))).toBe('Opens tomorrow at 3:00 PM')
  })
})

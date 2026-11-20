import { describe, expect, it } from 'vitest'
import { formatManilaDateTime, withManilaOffset } from './time'

describe('formatManilaDateTime', () => {
  it('shows an instant in Manila time, whatever the server zone', () => {
    // 04:00 UTC is noon in Manila.
    const shown = formatManilaDateTime('2026-11-21T04:00:00.000Z')
    expect(shown).toContain('Nov 21, 2026')
    expect(shown).toContain('12:00 PM')
  })

  it('crosses the date line into the next Manila day', () => {
    expect(formatManilaDateTime('2026-11-20T17:30:00Z')).toContain('Nov 21, 2026')
  })
})

describe('withManilaOffset', () => {
  it('appends +08:00 to an offset-less datetime-local value', () => {
    expect(withManilaOffset('2026-11-21T12:00')).toBe('2026-11-21T12:00+08:00')
  })

  it('leaves a value that already has an offset, Z, or nothing', () => {
    expect(withManilaOffset('2026-11-21T12:00:00+08:00')).toBe('2026-11-21T12:00:00+08:00')
    expect(withManilaOffset('2026-11-21T04:00:00Z')).toBe('2026-11-21T04:00:00Z')
    expect(withManilaOffset('')).toBe('')
  })
})

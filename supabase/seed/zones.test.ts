import { describe, expect, it } from 'vitest'
import { SEED_ZONES } from './zones'

describe('delivery zone seed', () => {
  it('has no duplicate barangays', () => {
    const names = SEED_ZONES.map((z) => z.barangay)
    expect(new Set(names).size).toBe(names.length)
  })

  it('stores every fee as whole centavos', () => {
    for (const zone of SEED_ZONES) {
      expect(Number.isInteger(zone.feeCentavos)).toBe(true)
      expect(zone.feeCentavos % 100).toBe(0)
      expect(zone.feeCentavos).toBeGreaterThan(0)
    }
  })

  it('includes the barangay the cafe is in', () => {
    expect(SEED_ZONES.some((z) => z.barangay === 'Villa Kananga')).toBe(true)
  })
})

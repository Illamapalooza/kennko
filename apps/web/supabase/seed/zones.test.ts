import { describe, expect, it } from 'vitest'
import { SEED_ZONES } from './zones'
import { CAFE_ORIGIN } from '@kennko/core'

describe('delivery zone seed', () => {
  it('has no duplicate barangays', () => {
    const names = SEED_ZONES.map((z) => z.barangay)
    expect(new Set(names).size).toBe(names.length)
  })

  it('places every barangay inside Butuan City', () => {
    // A transposed or mistyped coordinate would silently charge a wild fee, so
    // the seed is bounded to a box around the city.
    for (const zone of SEED_ZONES) {
      expect(zone.lat).toBeGreaterThan(8.85)
      expect(zone.lat).toBeLessThan(9.05)
      expect(zone.lng).toBeGreaterThan(125.4)
      expect(zone.lng).toBeLessThan(125.7)
    }
  })

  it("marks exactly one home barangay, and it is the cafe's own", () => {
    const home = SEED_ZONES.filter((z) => z.isHome)
    expect(home).toHaveLength(1)
    expect(home[0].barangay).toBe('Villa Kananga')
  })

  it('puts the home barangay at the cafe pin', () => {
    const home = SEED_ZONES.find((z) => z.isHome)!
    expect(home.lat).toBeCloseTo(CAFE_ORIGIN.lat, 4)
    expect(home.lng).toBeCloseTo(CAFE_ORIGIN.lng, 4)
  })

  it('includes the barangay the cafe is in', () => {
    expect(SEED_ZONES.some((z) => z.barangay === 'Villa Kananga')).toBe(true)
  })
})

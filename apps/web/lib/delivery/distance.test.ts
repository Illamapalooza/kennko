import { describe, expect, it } from 'vitest'
import {
  haversineKm, ridingDistanceKm, deliveryFeeCentavos, describeFee,
  CAFE_ORIGIN, ROAD_FACTOR,
} from './distance'

describe('haversineKm', () => {
  it('is zero at the origin', () => {
    expect(haversineKm(CAFE_ORIGIN, CAFE_ORIGIN)).toBe(0)
  })

  it('is symmetric', () => {
    const a = { lat: 8.95, lng: 125.54 }
    expect(haversineKm(CAFE_ORIGIN, a)).toBeCloseTo(haversineKm(a, CAFE_ORIGIN), 9)
  })

  it('matches a known separation', () => {
    // One degree of latitude is ~111km anywhere on Earth.
    const oneDegNorth = { lat: CAFE_ORIGIN.lat + 1, lng: CAFE_ORIGIN.lng }
    expect(haversineKm(CAFE_ORIGIN, oneDegNorth)).toBeCloseTo(111.19, 1)
  })

  it('measures a short local hop sensibly', () => {
    // Bancasi airport is roughly 7km from Villa Kananga.
    const bancasi = { lat: 8.9515, lng: 125.4779 }
    const km = haversineKm(CAFE_ORIGIN, bancasi)
    expect(km).toBeGreaterThan(5)
    expect(km).toBeLessThan(9)
  })
})

describe('ridingDistanceKm', () => {
  it('is longer than the straight line, because roads are', () => {
    const target = { lat: 8.95, lng: 125.55 }
    expect(ridingDistanceKm(target)).toBeCloseTo(haversineKm(CAFE_ORIGIN, target) * ROAD_FACTOR, 6)
    expect(ridingDistanceKm(target)).toBeGreaterThan(haversineKm(CAFE_ORIGIN, target))
  })
})

describe('deliveryFeeCentavos', () => {
  it('is free in the home barangay, whatever the distance', () => {
    expect(deliveryFeeCentavos(0, true)).toBe(0)
    expect(deliveryFeeCentavos(3.2, true)).toBe(0)
  })

  it('charges one band for anything just outside', () => {
    expect(deliveryFeeCentavos(0.4, false)).toBe(2000)
    expect(deliveryFeeCentavos(3.9, false)).toBe(2000)
  })

  it('charges by started band, not pro rata', () => {
    expect(deliveryFeeCentavos(4, false)).toBe(2000)
    expect(deliveryFeeCentavos(4.1, false)).toBe(4000)
    expect(deliveryFeeCentavos(8, false)).toBe(4000)
    expect(deliveryFeeCentavos(8.1, false)).toBe(6000)
    expect(deliveryFeeCentavos(12, false)).toBe(6000)
  })

  it('never returns a fraction of a centavo', () => {
    for (const km of [0.1, 1, 3.7, 4.4, 9.9, 15.2]) {
      const fee = deliveryFeeCentavos(km, false)
      expect(Number.isInteger(fee)).toBe(true)
      expect(fee % 100).toBe(0)
    }
  })

  it('rejects a nonsense distance rather than charging for it', () => {
    expect(() => deliveryFeeCentavos(-1, false)).toThrow('non-negative')
    expect(() => deliveryFeeCentavos(Number.NaN, false)).toThrow('non-negative')
  })
})

describe('describeFee', () => {
  it('explains a free delivery', () => {
    expect(describeFee(2, true)).toBe('Free — you are in our barangay')
  })
  it('shows the distance and the bands charged', () => {
    expect(describeFee(5.2, false)).toBe('5.2km · 2 × ₱20')
  })
})

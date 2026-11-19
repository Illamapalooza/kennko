import { describe, expect, it } from 'vitest'
import {
  haversineKm, ridingDistanceKm, deliveryFeeCentavos, describeFee,
  CAFE_ORIGIN, ROAD_FACTOR, verifyPin, MAX_PIN_DRIFT_KM, MAX_ACCURACY_M,
} from './delivery.ts'

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


const ampayon = { lat: 8.957, lng: 125.601 }

describe('verifyPin', () => {
  it('accepts a pin inside the chosen barangay', () => {
    const result = verifyPin({ lat: 8.958, lng: 125.6, accuracyM: 20 }, ampayon)
    expect(result.ok).toBe(true)
  })

  it('accepts a pin with no accuracy reported', () => {
    expect(verifyPin({ lat: 8.958, lng: 125.6 }, ampayon).ok).toBe(true)
  })

  it('refuses a pin next to the cafe while claiming a far barangay', () => {
    // The attack this exists to stop: pin at the shop, pay no delivery fee.
    const result = verifyPin({ lat: CAFE_ORIGIN.lat, lng: CAFE_ORIGIN.lng }, ampayon)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('inconsistent')
  })

  it('refuses a pin just beyond the drift allowance', () => {
    // ~0.05 degrees of longitude is roughly 5.5km at this latitude.
    const result = verifyPin({ lat: ampayon.lat, lng: ampayon.lng + 0.06 }, ampayon)
    expect(result.ok === false && result.reason).toBe('inconsistent')
  })

  it('allows an honest pin across a large barangay', () => {
    const result = verifyPin({ lat: ampayon.lat + 0.02, lng: ampayon.lng + 0.02 }, ampayon)
    expect(result.ok).toBe(true)
  })

  it('refuses a vague GPS fix rather than pricing from it', () => {
    const result = verifyPin(
      { lat: 8.958, lng: 125.6, accuracyM: MAX_ACCURACY_M + 1 },
      ampayon,
    )
    expect(result.ok === false && result.reason).toBe('inaccurate')
  })

  it('accepts a fix exactly at the accuracy limit', () => {
    expect(
      verifyPin({ lat: 8.958, lng: 125.6, accuracyM: MAX_ACCURACY_M }, ampayon).ok,
    ).toBe(true)
  })

  it('refuses nonsense coordinates', () => {
    expect(verifyPin({ lat: 999, lng: 125.6 }, ampayon).ok).toBe(false)
    expect(verifyPin({ lat: Number.NaN, lng: 125.6 }, ampayon).ok).toBe(false)
    expect(verifyPin(null, ampayon).ok).toBe(false)
  })

  it('keeps the drift allowance wide enough to cover a barangay', () => {
    expect(MAX_PIN_DRIFT_KM).toBeGreaterThanOrEqual(3)
  })
})

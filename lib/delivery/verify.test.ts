import { describe, expect, it } from 'vitest'
import { verifyPin, MAX_PIN_DRIFT_KM, MAX_ACCURACY_M } from './verify'
import { CAFE_ORIGIN } from './distance'

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

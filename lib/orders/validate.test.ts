import { describe, expect, it } from 'vitest'
import { validateCheckout, type CheckoutInput } from './validate'

const NOW = new Date('2026-08-24T10:00:00+08:00')
const LATER = '2026-08-24T11:00:00+08:00'

const pickup = (over: Partial<CheckoutInput> = {}): CheckoutInput => ({
  name: 'Ana Cruz',
  email: 'ana@example.com',
  phone: '09171234567',
  fulfilment: 'pickup',
  address: '',
  barangay: '',
  fulfilAt: LATER,
  gcashReference: 'ABC123456',
  ...over,
})

const delivery = (over: Partial<CheckoutInput> = {}): CheckoutInput =>
  pickup({
    fulfilment: 'delivery',
    address: '12 Montalban St.',
    barangay: 'Villa Kananga',
    ...over,
  })

describe('validateCheckout', () => {
  it('accepts a complete pickup order', () => {
    expect(validateCheckout(pickup(), NOW)).toEqual([])
  })

  it('accepts a complete delivery order', () => {
    expect(validateCheckout(delivery(), NOW)).toEqual([])
  })

  it('always requires name, email, and phone', () => {
    const errors = validateCheckout(pickup({ name: '', email: '', phone: '' }), NOW)
    expect(errors).toContain('Enter your name.')
    expect(errors).toContain('Enter your email address.')
    expect(errors).toContain('Enter your mobile number.')
  })

  it('reports every problem at once', () => {
    expect(validateCheckout(pickup({ name: '', email: '', phone: '' }), NOW).length).toBe(3)
  })

  it('rejects a malformed email', () => {
    expect(validateCheckout(pickup({ email: 'nope' }), NOW)).toContain(
      'Enter a valid email address.',
    )
  })

  it('accepts +63 and 09 mobile formats, and spacing', () => {
    expect(validateCheckout(pickup({ phone: '+639171234567' }), NOW)).toEqual([])
    expect(validateCheckout(pickup({ phone: '0917 123 4567' }), NOW)).toEqual([])
  })

  it('rejects a landline or short number', () => {
    expect(validateCheckout(pickup({ phone: '0851234' }), NOW).length).toBe(1)
  })

  it('requires address and barangay for delivery', () => {
    const errors = validateCheckout(delivery({ address: '', barangay: '' }), NOW)
    expect(errors).toContain('Enter the delivery address.')
    expect(errors).toContain('Choose the barangay for delivery.')
  })

  it('does not ask a pickup customer for an address', () => {
    expect(validateCheckout(pickup(), NOW)).toEqual([])
  })

  it('rejects a pickup order that carries an address', () => {
    expect(validateCheckout(pickup({ address: '12 Montalban St.' }), NOW)).toContain(
      'Pickup orders do not take a delivery address.',
    )
  })

  it('rejects a time in the past', () => {
    expect(
      validateCheckout(pickup({ fulfilAt: '2026-08-24T09:00:00+08:00' }), NOW),
    ).toContain('Choose a time in the future.')
  })

  it('requires a plausible GCash reference', () => {
    expect(validateCheckout(pickup({ gcashReference: '' }), NOW)).toContain(
      'Enter the GCash reference number.',
    )
    expect(validateCheckout(pickup({ gcashReference: 'abc' }), NOW)).toContain(
      'A GCash reference is 6 to 20 letters and numbers.',
    )
  })
})

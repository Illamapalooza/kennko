import { describe, expect, it } from 'vitest'
import { parseManilaDateTime, validateCheckout, type CheckoutInput } from './checkout.ts'

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

describe('parseManilaDateTime', () => {
  const NOON_MANILA = '2026-11-21T04:00:00.000Z'

  it('reads an offset-less datetime-local value as Manila time', () => {
    expect(parseManilaDateTime('2026-11-21T12:00')?.toISOString()).toBe(NOON_MANILA)
    expect(parseManilaDateTime('2026-11-21T12:00:00')?.toISOString()).toBe(NOON_MANILA)
  })

  it('keeps an explicit offset or Z as given', () => {
    expect(parseManilaDateTime('2026-11-21T12:00:00+08:00')?.toISOString()).toBe(NOON_MANILA)
    expect(parseManilaDateTime('2026-11-21T04:00:00Z')?.toISOString()).toBe(NOON_MANILA)
  })

  it('returns null for anything else', () => {
    expect(parseManilaDateTime('garbage')).toBeNull()
    expect(parseManilaDateTime('')).toBeNull()
    expect(parseManilaDateTime('2026-11-21')).toBeNull()
    expect(parseManilaDateTime('2026-13-45T99:99')).toBeNull()
  })
})

describe('validateCheckout fulfilment time', () => {
  it('reads a naive time as Manila when deciding whether it is in the future', () => {
    // 10:30 Manila is after NOW (10:00 Manila); read as UTC it would be 18:30 Manila and pass too,
    // so check the other side: 09:30 Manila is in the past.
    expect(validateCheckout(pickup({ fulfilAt: '2026-08-24T10:30' }), NOW)).toEqual([])
    expect(validateCheckout(pickup({ fulfilAt: '2026-08-24T09:30' }), NOW)).toContain(
      'Choose a time in the future.',
    )
  })

  it('rejects an unparseable time', () => {
    expect(validateCheckout(pickup({ fulfilAt: 'soon' }), NOW)).toContain('Choose a valid time.')
  })
})

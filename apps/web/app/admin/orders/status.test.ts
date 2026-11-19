import { describe, expect, it } from 'vitest'
import { nextStatus, duplicateReferences, statusLabel } from './status'

const paid = { paymentStatus: 'paid' as const }

describe('nextStatus', () => {
  it('walks a pickup order to the counter', () => {
    expect(nextStatus({ ...paid, prepStatus: 'placed', fulfilment: 'pickup' })).toBe('preparing')
    expect(nextStatus({ ...paid, prepStatus: 'preparing', fulfilment: 'pickup' })).toBe('ready')
    expect(nextStatus({ ...paid, prepStatus: 'ready', fulfilment: 'pickup' })).toBe('completed')
  })

  it('walks a delivery order out with a rider', () => {
    expect(nextStatus({ ...paid, prepStatus: 'placed', fulfilment: 'delivery' })).toBe('preparing')
    expect(nextStatus({ ...paid, prepStatus: 'preparing', fulfilment: 'delivery' })).toBe('out_for_delivery')
    expect(nextStatus({ ...paid, prepStatus: 'out_for_delivery', fulfilment: 'delivery' })).toBe('completed')
  })

  it('never sends a pickup order out for delivery', () => {
    expect(nextStatus({ ...paid, prepStatus: 'preparing', fulfilment: 'pickup' })).not.toBe('out_for_delivery')
  })

  it('never marks a delivery order ready for pickup', () => {
    expect(nextStatus({ ...paid, prepStatus: 'preparing', fulfilment: 'delivery' })).not.toBe('ready')
  })

  it('stops at completed', () => {
    expect(nextStatus({ ...paid, prepStatus: 'completed', fulfilment: 'pickup' })).toBeNull()
    expect(nextStatus({ ...paid, prepStatus: 'completed', fulfilment: 'delivery' })).toBeNull()
  })

  it('offers nothing while the payment is not paid', () => {
    for (const paymentStatus of ['unpaid', 'pending_verification', 'rejected', 'refunded'] as const) {
      expect(nextStatus({ prepStatus: 'placed', paymentStatus, fulfilment: 'pickup' })).toBeNull()
    }
  })

  it('offers nothing for a cancelled order', () => {
    expect(nextStatus({ ...paid, prepStatus: 'cancelled', fulfilment: 'delivery' })).toBeNull()
  })
})

describe('duplicateReferences', () => {
  it('flags a reference used by two live orders', () => {
    const dupes = duplicateReferences([
      { gcashReference: 'ABC123', paymentStatus: 'pending_verification' },
      { gcashReference: 'ABC123', paymentStatus: 'paid' },
      { gcashReference: 'XYZ789', paymentStatus: 'paid' },
    ])
    expect(dupes.has('ABC123')).toBe(true)
    expect(dupes.has('XYZ789')).toBe(false)
  })

  it('ignores case when comparing', () => {
    const dupes = duplicateReferences([
      { gcashReference: 'abc123', paymentStatus: 'paid' },
      { gcashReference: 'ABC123', paymentStatus: 'paid' },
    ])
    expect(dupes.has('ABC123')).toBe(true)
  })

  it('does not count rejected payments, so a corrected resubmit is not flagged', () => {
    const dupes = duplicateReferences([
      { gcashReference: 'ABC123', paymentStatus: 'rejected' },
      { gcashReference: 'ABC123', paymentStatus: 'pending_verification' },
    ])
    expect(dupes.size).toBe(0)
  })

  it('skips orders with no payment reference', () => {
    const dupes = duplicateReferences([
      { gcashReference: null, paymentStatus: 'paid' },
      { gcashReference: null, paymentStatus: 'paid' },
    ])
    expect(dupes.size).toBe(0)
  })
})

describe('statusLabel', () => {
  it('is plain enough for a barista mid-shift', () => {
    expect(statusLabel('awaiting_verification')).toBe('Awaiting payment check')
    expect(statusLabel('out_for_delivery')).toBe('Out for delivery')
  })
})

import { describe, expect, it } from 'vitest'
import { nextStatus, duplicateReferences, statusLabel } from './status'

describe('nextStatus', () => {
  it('walks a pickup order to the counter', () => {
    expect(nextStatus('confirmed', 'pickup')).toBe('preparing')
    expect(nextStatus('preparing', 'pickup')).toBe('ready')
    expect(nextStatus('ready', 'pickup')).toBe('completed')
  })

  it('walks a delivery order out with a rider', () => {
    expect(nextStatus('confirmed', 'delivery')).toBe('preparing')
    expect(nextStatus('preparing', 'delivery')).toBe('out_for_delivery')
    expect(nextStatus('out_for_delivery', 'delivery')).toBe('completed')
  })

  it('never sends a pickup order out for delivery', () => {
    expect(nextStatus('preparing', 'pickup')).not.toBe('out_for_delivery')
  })

  it('never marks a delivery order ready for pickup', () => {
    expect(nextStatus('preparing', 'delivery')).not.toBe('ready')
  })

  it('stops at completed', () => {
    expect(nextStatus('completed', 'pickup')).toBeNull()
    expect(nextStatus('completed', 'delivery')).toBeNull()
  })

  it('offers nothing for an unverified, rejected, or cancelled order', () => {
    expect(nextStatus('awaiting_verification', 'pickup')).toBeNull()
    expect(nextStatus('rejected', 'pickup')).toBeNull()
    expect(nextStatus('cancelled', 'delivery')).toBeNull()
  })
})

describe('duplicateReferences', () => {
  it('flags a reference used by two live orders', () => {
    const dupes = duplicateReferences([
      { gcashReference: 'ABC123', status: 'awaiting_verification' },
      { gcashReference: 'ABC123', status: 'confirmed' },
      { gcashReference: 'XYZ789', status: 'confirmed' },
    ])
    expect(dupes.has('ABC123')).toBe(true)
    expect(dupes.has('XYZ789')).toBe(false)
  })

  it('ignores case when comparing', () => {
    const dupes = duplicateReferences([
      { gcashReference: 'abc123', status: 'confirmed' },
      { gcashReference: 'ABC123', status: 'preparing' },
    ])
    expect(dupes.has('ABC123')).toBe(true)
  })

  it('does not count rejected orders, so a corrected resubmit is not flagged', () => {
    const dupes = duplicateReferences([
      { gcashReference: 'ABC123', status: 'rejected' },
      { gcashReference: 'ABC123', status: 'awaiting_verification' },
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

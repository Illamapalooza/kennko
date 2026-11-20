import { describe, expect, it } from 'vitest'
import { ORDER_SELECT, toAdminOrder, type OrderRow } from './rows'

const row = (over: Partial<OrderRow> = {}): OrderRow => ({
  id: 'o1', order_code: 'KNK-1', prep_status: 'cancelled', payment_status: 'rejected',
  ticket_series: 'W', ticket_number: 4, fulfilment: 'pickup',
  customer_name: 'Ana', customer_phone: '09171234567', customer_email: 'ana@example.com',
  delivery_address: null, delivery_barangay: null, delivery_lat: null, delivery_lng: null,
  delivery_distance_km: null, fulfil_at: '2026-11-21T04:00:00Z',
  subtotal_centavos: 100, delivery_fee_centavos: 0, total_centavos: 100,
  customer_note: null, created_at: '2026-11-21T01:00:00Z',
  cancelled_at: null, cancel_reason: null,
  payments: [{ id: 'p1', reference: 'REF1', proof_path: 'proofs/x.jpg', status: 'rejected', recorded_at: '2026-11-21T01:00:00Z' }],
  order_lines: [],
  ...over,
})

describe('admin order rows', () => {
  it('select reads cancelled_at and cancel_reason', () => {
    expect(ORDER_SELECT).toContain('cancelled_at')
    expect(ORDER_SELECT).toContain('cancel_reason')
  })

  it('an owner-cancelled unverified order is cancelled, with its reason', () => {
    const o = toAdminOrder(row({ cancelled_at: '2026-11-21T05:00:00Z', cancel_reason: 'Out of milk' }))
    expect(o.stage).toBe('cancelled')
    expect(o.cancelReason).toBe('Out of milk')
  })

  it('a rejected payment without cancelled_at stays rejected', () => {
    const o = toAdminOrder(row())
    expect(o.stage).toBe('rejected')
    expect(o.cancelReason).toBeNull()
  })
})

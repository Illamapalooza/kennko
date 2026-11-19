import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const row = {
  order_code: 'KNK-ABC123',
  prep_status: 'placed',
  payment_status: 'pending_verification',
  ticket_series: 'W',
  ticket_number: 3,
  fulfilment: 'pickup',
  fulfil_at: '2026-11-21T07:00:00Z',
  total_centavos: 29000,
  delivery_address: null,
  order_lines: [
    {
      item_name: 'Spanish Latte', variant_label: 'L', quantity: 2,
      ice_level: 'regular', ice_serve: null, note: null,
      order_line_options: [{ option_name: 'Oat milk' }],
    },
  ],
}
const select = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: () => ({
      select: (cols: string) => {
        select(cols)
        const q: Record<string, unknown> = {}
        q.eq = () => q
        q.or = () => q
        q.order = () => q
        q.limit = async () => ({ data: [{ ...row, id: 'o1', created_at: '2026-11-20T00:00:00Z',
          delivery_fee_centavos: 0, subtotal_centavos: 29000, customer_user_id: 'u1', customer_email: 'a@b.c' }], error: null })
        q.maybeSingle = async () => ({ data: row })
        return q
      },
    }),
  }),
}))

import { lookupOrder } from './lookup'
import { getOrderHistory } from './history'

describe('lookupOrder', () => {
  it('returns the stage and ticket instead of a status', async () => {
    const o = await lookupOrder('knk-abc123')
    expect(o?.stage).toBe('awaiting_verification')
    expect(o?.ticket).toBe('W3')
    expect(o?.items[0]).toMatchObject({ name: 'Spanish Latte', variantLabel: 'L', quantity: 2 })
    expect(select.mock.calls[0][0]).toContain('order_lines')
    expect(select.mock.calls[0][0]).not.toContain('order_items')
  })
})

describe('getOrderHistory', () => {
  it('returns stage, ticket and option names', async () => {
    const [o] = await getOrderHistory({ id: 'u1', email: 'a@b.c', emailConfirmed: true } as never)
    expect(o.stage).toBe('awaiting_verification')
    expect(o.ticket).toBe('W3')
    expect(o.items[0].modifiers).toEqual(['Oat milk'])
    expect(o.items[0].variantLabel).toBe('L')
  })
})

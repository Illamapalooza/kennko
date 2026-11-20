import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  cancelled_at: null as string | null,
  order_lines: [
    {
      item_name: 'Spanish Latte', variant_label: 'L', quantity: 2,
      ice_level: 'regular', ice_serve: null, note: null,
      order_line_options: [{ option_name: 'Oat milk' }],
    },
  ],
}
const select = vi.fn()
let overrides: Record<string, unknown> = {}
vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: () => ({
      select: (cols: string) => {
        select(cols)
        const q: Record<string, unknown> = {}
        q.eq = () => q
        q.or = () => q
        q.order = () => q
        q.limit = async () => ({ data: [{ ...row, ...overrides, id: 'o1', created_at: '2026-11-20T00:00:00Z',
          delivery_fee_centavos: 0, subtotal_centavos: 29000, customer_user_id: 'u1', customer_email: 'a@b.c' }], error: null })
        q.maybeSingle = async () => ({ data: { ...row, ...overrides } })
        return q
      },
    }),
  }),
}))

import { lookupOrder } from './lookup'
import { getOrderHistory } from './history'

beforeEach(() => {
  overrides = {}
  select.mockClear()
})

const ownerCancelled = { prep_status: 'cancelled', payment_status: 'rejected', cancelled_at: '2026-11-21T05:00:00Z' }
const paymentRejected = { prep_status: 'cancelled', payment_status: 'rejected', cancelled_at: null }

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

describe('cancelled orders', () => {
  it('lookup: an owner-cancelled unverified order shows as cancelled, not as a rejected payment', async () => {
    overrides = ownerCancelled
    expect((await lookupOrder('KNK-ABC123'))?.stage).toBe('cancelled')
    expect(select.mock.calls[0][0]).toContain('cancelled_at')
  })

  it('lookup: a rejected payment with no cancelled_at still shows as rejected', async () => {
    overrides = paymentRejected
    expect((await lookupOrder('KNK-ABC123'))?.stage).toBe('rejected')
  })

  it('history: the same rule', async () => {
    const who = { id: 'u1', email: 'a@b.c', emailConfirmed: true } as never
    overrides = ownerCancelled
    expect((await getOrderHistory(who))[0].stage).toBe('cancelled')
    expect(select.mock.calls[0][0]).toContain('cancelled_at')
    overrides = paymentRejected
    expect((await getOrderHistory(who))[0].stage).toBe('rejected')
  })
})

describe('history sizes', () => {
  it('carries the variant code so the page can show the cup volume', async () => {
    overrides = {
      order_lines: [{
        item_name: 'Spanish Latte', variant_code: 'L', variant_label: 'Large', quantity: 1,
        ice_level: null, ice_serve: null, note: null, order_line_options: [],
      }],
    }
    const [o] = await getOrderHistory({ id: 'u1', email: 'a@b.c', emailConfirmed: true } as never)
    expect(o.items[0]).toMatchObject({ variantCode: 'L', variantLabel: 'Large' })
    expect(select.mock.calls[0][0]).toContain('variant_code')
  })
})

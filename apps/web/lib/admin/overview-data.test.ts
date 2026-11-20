import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

let failing = new Set<string>()
let calls: unknown[][] = []
const counts: Record<string, number> = { orders: 3, menu_items: 1, menu_variants: 2, options: 0 }

let selected = ''
let recentRows: Record<string, unknown>[] = []

function query(table: string) {
  const result = failing.has(table)
    ? { count: null, error: { message: 'boom' } }
    : { count: counts[table], error: null }
  const q = {
    eq: (...a: unknown[]) => { calls.push(['eq', ...a]); return q },
    neq: (...a: unknown[]) => { calls.push(['neq', ...a]); return q },
    order: () => q,
    limit: async () => ({ data: recentRows, error: null }),
    then: (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  }
  return q
}

vi.mock('@/lib/supabase/server', () => ({
  getServerClient: async () => ({
    from: (table: string) => ({ select: (cols: string) => { selected = cols; return query(table) } }),
  }),
}))

import { countOrdersToCheck, countSoldOut, recentOrders } from './overview-data'

beforeEach(() => {
  failing = new Set()
  calls = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('overview counts', () => {
  it('returns the counts', async () => {
    expect(await countOrdersToCheck()).toBe(3)
    expect(await countSoldOut()).toBe(3)
  })

  it('counts orders awaiting a payment check by column, not the old status', async () => {
    await countOrdersToCheck()
    expect(calls).toContainEqual(['eq', 'payment_status', 'pending_verification'])
    expect(calls).toContainEqual(['neq', 'prep_status', 'cancelled'])
    expect(calls).toContainEqual(['eq', 'channel', 'online'])
    expect(calls.some((c) => c[1] === 'status')).toBe(false)
  })

  it('returns null, not 0, when the orders count fails', async () => {
    failing.add('orders')
    expect(await countOrdersToCheck()).toBeNull()
  })

  it('returns null when any sold-out count fails', async () => {
    failing.add('menu_variants')
    expect(await countSoldOut()).toBeNull()
  })
})

describe('recentOrders', () => {
  const base = {
    id: 'o1', order_code: 'KNK-1', customer_name: 'Ana', ticket_series: 'W', ticket_number: 2,
    total_centavos: 100, prep_status: 'cancelled', payment_status: 'rejected',
  }

  it('shows an owner-cancelled unverified order as cancelled', async () => {
    recentRows = [{ ...base, cancelled_at: '2026-11-21T05:00:00Z' }]
    const [o] = await recentOrders()
    expect(o.stage).toBe('cancelled')
    expect(selected).toContain('cancelled_at')
  })

  it('keeps a rejected payment as rejected', async () => {
    recentRows = [{ ...base, cancelled_at: null }]
    expect((await recentOrders())[0].stage).toBe('rejected')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

let failing = new Set<string>()
let calls: unknown[][] = []
const counts: Record<string, number> = { orders: 3, menu_items: 1, menu_variants: 2, options: 0 }

function query(table: string) {
  const result = failing.has(table)
    ? { count: null, error: { message: 'boom' } }
    : { count: counts[table], error: null }
  const q = {
    eq: (...a: unknown[]) => { calls.push(['eq', ...a]); return q },
    neq: (...a: unknown[]) => { calls.push(['neq', ...a]); return q },
    then: (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  }
  return q
}

vi.mock('@/lib/supabase/server', () => ({
  getServerClient: async () => ({ from: (table: string) => ({ select: () => query(table) }) }),
}))

import { countOrdersToCheck, countSoldOut } from './overview-data'

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

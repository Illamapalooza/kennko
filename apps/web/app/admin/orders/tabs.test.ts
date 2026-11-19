import { describe, expect, it } from 'vitest'
import { ordersForTab, tabCounts, type OrderTab } from './tabs'
import type { OrderStatus } from './status'

const now = new Date('2026-11-20T12:00:00Z')
const fresh = '2026-11-19T12:00:00Z'
const old = '2026-11-12T12:00:00Z'

const ALL: OrderStatus[] = [
  'awaiting_verification', 'confirmed', 'preparing', 'ready',
  'out_for_delivery', 'completed', 'rejected', 'cancelled',
]
const TABS: OrderTab[] = ['check', 'progress', 'done']

describe('ordersForTab', () => {
  it('puts each status in exactly one tab', () => {
    for (const status of ALL) {
      const orders = [{ status, createdAt: fresh }]
      const hits = TABS.filter((t) => ordersForTab(orders, t, now).length === 1)
      expect(hits).toHaveLength(1)
    }
  })

  it('maps statuses to the right tabs', () => {
    const at = (s: OrderStatus) => [{ status: s, createdAt: fresh }]
    expect(ordersForTab(at('awaiting_verification'), 'check', now)).toHaveLength(1)
    expect(ordersForTab(at('out_for_delivery'), 'progress', now)).toHaveLength(1)
    expect(ordersForTab(at('rejected'), 'done', now)).toHaveLength(1)
  })

  it('excludes done orders older than 7 days', () => {
    const orders = [
      { status: 'completed' as const, createdAt: old },
      { status: 'completed' as const, createdAt: fresh },
    ]
    expect(ordersForTab(orders, 'done', now)).toHaveLength(1)
  })

  it('keeps old orders that are still in progress', () => {
    expect(ordersForTab([{ status: 'preparing', createdAt: old }], 'progress', now)).toHaveLength(1)
  })
})

describe('tabCounts', () => {
  it('counts per tab', () => {
    const orders = [
      { status: 'awaiting_verification' as const, createdAt: fresh },
      { status: 'confirmed' as const, createdAt: fresh },
      { status: 'ready' as const, createdAt: fresh },
      { status: 'completed' as const, createdAt: old },
      { status: 'cancelled' as const, createdAt: fresh },
    ]
    expect(tabCounts(orders, now)).toEqual({ check: 1, progress: 2, done: 1 })
  })
})

import { describe, expect, it } from 'vitest'
import { ordersForTab, tabCounts, orderQueries, type OrderTab } from './tabs'
import type { PrepStatus, PaymentStatus } from '@kennko/core'

const now = new Date('2026-11-20T12:00:00Z')
const fresh = '2026-11-19T12:00:00Z'
const old = '2026-11-12T12:00:00Z'

type O = { prepStatus: PrepStatus; paymentStatus: PaymentStatus; createdAt: string }
const o = (prepStatus: PrepStatus, paymentStatus: PaymentStatus, createdAt = fresh): O => ({
  prepStatus, paymentStatus, createdAt,
})

// Every state an online order can really be in.
const REAL: O[] = [
  o('placed', 'pending_verification'),
  o('placed', 'paid'),
  o('preparing', 'paid'),
  o('ready', 'paid'),
  o('out_for_delivery', 'paid'),
  o('completed', 'paid'),
  o('cancelled', 'paid'),
  o('cancelled', 'rejected'),
  o('cancelled', 'pending_verification'),
]
const TABS: OrderTab[] = ['check', 'progress', 'done']

describe('ordersForTab', () => {
  it('puts each real order state in exactly one tab', () => {
    for (const order of REAL) {
      const hits = TABS.filter((t) => ordersForTab([order], t, now).length === 1)
      expect(hits).toHaveLength(1)
    }
  })

  it('maps states to the right tabs', () => {
    expect(ordersForTab([o('placed', 'pending_verification')], 'check', now)).toHaveLength(1)
    expect(ordersForTab([o('placed', 'paid')], 'progress', now)).toHaveLength(1)
    expect(ordersForTab([o('out_for_delivery', 'paid')], 'progress', now)).toHaveLength(1)
    expect(ordersForTab([o('cancelled', 'rejected')], 'done', now)).toHaveLength(1)
    expect(ordersForTab([o('completed', 'paid')], 'done', now)).toHaveLength(1)
  })

  it('keeps a cancelled order out of the check tab even if payment is still pending', () => {
    expect(ordersForTab([o('cancelled', 'pending_verification')], 'check', now)).toHaveLength(0)
  })

  it('excludes done orders older than 7 days', () => {
    const orders = [o('completed', 'paid', old), o('completed', 'paid', fresh)]
    expect(ordersForTab(orders, 'done', now)).toHaveLength(1)
  })

  it('keeps old orders that are still in progress', () => {
    expect(ordersForTab([o('preparing', 'paid', old)], 'progress', now)).toHaveLength(1)
  })
})

describe('tabCounts', () => {
  it('counts per tab', () => {
    const orders = [
      o('placed', 'pending_verification'),
      o('placed', 'paid'),
      o('ready', 'paid'),
      o('completed', 'paid', old),
      o('cancelled', 'rejected'),
    ]
    expect(tabCounts(orders, now)).toEqual({ check: 1, progress: 2, done: 1 })
  })
})

describe('7-day boundary', () => {
  it('includes exactly 7 days old and excludes one ms older', () => {
    const edge = new Date(now.getTime() - 7 * 86400000).toISOString()
    const past = new Date(now.getTime() - 7 * 86400000 - 1).toISOString()
    expect(ordersForTab([o('completed', 'paid', edge)], 'done', now)).toHaveLength(1)
    expect(ordersForTab([o('completed', 'paid', past)], 'done', now)).toHaveLength(0)
  })
})

describe('orderQueries', () => {
  it('describes the column filters for each tab with a 7-day cutoff', () => {
    const q = orderQueries(now)
    expect(q.check).toEqual({ paymentStatus: 'pending_verification', excludePrep: ['cancelled'] })
    expect(q.progress).toEqual({
      paymentStatus: 'paid',
      prepStatuses: ['placed', 'preparing', 'ready', 'out_for_delivery'],
    })
    expect(q.done).toEqual({
      prepStatuses: ['completed', 'cancelled'],
      since: '2026-11-13T12:00:00.000Z',
    })
  })
})

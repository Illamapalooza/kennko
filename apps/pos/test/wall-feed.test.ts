import { describe, expect, it } from 'vitest'
import type { Menu, OnlineQueueOrder, PrepStatus } from '@kennko/core'
import { makePublicCode } from '@kennko/core'
import { builtInMenu } from '../server/menu.ts'
import { createStore } from '../server/store.ts'
import { ONLINE_TO_WALL, wallMenu, wallOnlineOrders, wallSnapshot } from '../server/wall-feed.ts'

const order: OnlineQueueOrder = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  businessDay: '2026-11-21',
  ticketNumber: 3,
  customerName: 'Ana Dela Cruz',
  fulfilment: 'delivery',
  fulfilAt: '2026-11-21T02:30:00.000Z',
  customerNote: 'Gate is blue',
  prepStatus: 'placed',
  createdAt: '2026-11-21T01:50:00.000Z',
  updatedAt: '2026-11-21T01:52:00.000Z',
  lines: [
    { name: 'Latte', size: 'M', quantity: 1, options: [], iceLevel: 'regular', iceServe: 'mixed', note: '' },
    { name: 'Latte', size: 'L', quantity: 2, options: ['Oat milk'], iceLevel: 'less', iceServe: 'side', note: 'extra hot' },
    { name: 'Ensaymada', size: 'R', quantity: 1, options: [], iceLevel: null, iceServe: null, note: '' },
  ],
  delivery: { address: '12 Montilla Blvd', barangay: 'Libertad', phone: '09171234567' },
}

describe('online orders on the wall', () => {
  it('maps each prep status per Ruling 11', () => {
    expect(ONLINE_TO_WALL).toEqual({
      placed: 'queued',
      preparing: 'preparing',
      ready: 'serving',
      out_for_delivery: 'done',
      completed: 'done',
      cancelled: 'voided',
    })
    const statuses: PrepStatus[] = ['placed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled']
    expect(wallOnlineOrders(statuses.map((prepStatus) => ({ ...order, prepStatus }))).map((w) => w.status))
      .toEqual(['queued', 'preparing', 'serving', 'done', 'done', 'voided'])
  })

  it('shows the W number, the first name only and drinks summed by name, with the times as numbers', () => {
    expect(wallOnlineOrders([order])).toEqual([{
      id: 3,
      number: 3,
      series: 'W',
      name: 'Ana',
      items: [{ name: 'Latte', qty: 3 }, { name: 'Ensaymada', qty: 1 }],
      status: 'queued',
      createdAt: Date.parse('2026-11-21T01:50:00.000Z'),
      updatedAt: Date.parse('2026-11-21T01:52:00.000Z'),
    }])
  })

  it('never carries the delivery details, phone, note or lines to the projector', () => {
    const [w] = wallOnlineOrders([order])
    for (const key of ['delivery', 'phone', 'customerNote', 'lines']) expect(w).not.toHaveProperty(key)
    expect(JSON.stringify(w)).not.toMatch(/Montilla|Libertad|0917|Gate|Dela Cruz|extra hot|Oat/)
  })

  it('copes with a name of spaces only', () => {
    expect(wallOnlineOrders([{ ...order, customerName: '   ' }])[0]!.name).toBe('')
  })
})

describe('the wall menu', () => {
  const price = [{ size: 'M' as const, priceCentavos: 12000 }]
  const menu: Menu = {
    source: 'website', updatedAt: 1, version: 3,
    modifierGroups: [],
    categories: [
      { id: 'c1', name: 'Classics', items: [
        { id: 'i1', name: 'Latte', isBestseller: false, isAvailable: true, prices: price },
        { id: 'i2', name: 'Spanish Latte', isBestseller: true, isAvailable: false, prices: price },
      ] },
      { id: 'c2', name: 'Empty', items: [] },
    ],
  }

  it('keeps a sold-out bestseller with star true and drops empty categories', () => {
    expect(wallMenu(menu)).toEqual([
      { category: 'Classics', items: [{ name: 'Latte', star: false }, { name: 'Spanish Latte', star: true }] },
    ])
  })

  it('carries only category, items, name and star: no price, id or availability', () => {
    const keys = new Set<string>()
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x) }
    }
    walk(wallMenu(menu))
    expect([...keys].sort()).toEqual(['category', 'items', 'name', 'star'])
  })
})

describe('loyalty never reaches the wall (Review Focus 3)', () => {
  it('a linked, stamped order and a stamped online order carry no code, customerCode or stamp key', () => {
    const store = createStore(':memory:')
    const menu = builtInMenu(0)
    const latte = menu.categories[0]!.items[0]!
    const T = Date.UTC(2026, 10, 21, 2, 0)
    store.startShift(0, T, null)
    const code = makePublicCode(() => 5)
    const sold = store.createOrder(menu, {
      lines: [{ menuItemId: latte.id, size: latte.prices[0]!.size, modifierIds: [], quantity: 1, iceLevel: 'regular', iceServe: 'mixed', note: '' }],
      type: 'takeout', customerName: 'Ana', customerCode: code, payment: { method: 'gcash' },
    }, T, null)
    store.stampOrder(sold.id, T, null)
    store.replaceOnlineOrders([{ ...order, fulfilment: 'pickup', delivery: null, card: 'stamp' }])
    store.stampOnline(order.id, T, null)
    const text = JSON.stringify(wallSnapshot(store, menu, T))
    expect(text).toContain('"number":1')
    expect(text).not.toMatch(/KC-/)
    expect(text).not.toContain(code)
    expect(text).not.toMatch(/customerCode|"stamp|"card"|stamped|freeDrink|reward/i)
  })
})

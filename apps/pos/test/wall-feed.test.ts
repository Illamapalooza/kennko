import { describe, expect, it } from 'vitest'
import type { Menu, OnlineQueueOrder, PrepStatus } from '@kennko/core'
import { makePublicCode } from '@kennko/core'
import { builtInMenu } from '../till/menu.ts'
import { createStore } from '../till/store.ts'
import { openNodeSqlite } from '../server/node-sqlite.ts'
import { ONLINE_TO_WALL, wallMenu, wallOnlineOrders, wallSnapshot } from '../till/wall-feed.ts'
import { currentCheckin } from '../till/checkin.ts'
import { tabletSnapshot } from '../till/tablet-feed.ts'

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
      fulfilment: 'delivery',
      prepStatus: 'placed',
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

  it('carries the food too, so the wall knows Cookies, Empanada and Fries by name', () => {
    const food = wallMenu(builtInMenu(0)).find((c) => c.category === 'Food')
    expect(food).toEqual({ category: 'Food', items: [
      { name: 'Cookies', star: false }, { name: 'Empanada', star: false }, { name: 'Fries', star: false },
    ] })
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
    const store = createStore(':memory:', openNodeSqlite)
    const menu = builtInMenu(0)
    const latte = menu.categories[0]!.items[0]!
    const T = Date.UTC(2026, 10, 21, 8, 0)
    store.startShift(0, T, null)
    const code = makePublicCode(() => 5)
    const sold = store.createOrder(menu, {
      lines: [{ menuItemId: latte.id, size: latte.prices[0]!.size, modifierIds: [], quantity: 1, iceLevel: 'regular', iceServe: 'mixed', note: '' }],
      type: 'takeout', customerName: 'Ana', customerCode: code, payment: { method: 'gcash' },
    }, T, null)
    store.stampOrder(sold.id, T, null)
    store.replaceOnlineOrders([{ ...order, fulfilment: 'pickup', delivery: null, card: 'stamp' }])
    store.stampOnline(order.id, T, null)
    const text = JSON.stringify(wallSnapshot(store, menu, T, null))
    expect(text).toContain('"number":1')
    expect(text).not.toMatch(/KC-/)
    expect(text).not.toContain(code)
    expect(text).not.toMatch(/customerCode|"stamp|"card"|stamped|freeDrink|reward/i)
  })
})

describe('nothing beyond the allowed fields sent to the wall (Plan 8 must-have)', () => {
  const SECRET = 'S3cr3t_'.repeat(6) + 'x'
  const T = Date.UTC(2026, 10, 21, 8, 0, 30)
  const SKEW = 90_000

  async function scene() {
    const store = createStore(':memory:', openNodeSqlite)
    const menu = builtInMenu(0)
    const latte = menu.categories[0]!.items[0]!
    store.setCheckin({ secret: SECRET, url: 'https://kennko.vercel.app/here' })
    store.kvSet('checkin_skew', String(SKEW))
    // Times in the pull are the server's: one cat still visiting, one whose visit has just ended (server time).
    store.replaceVisitors([
      { key: 'v-live', name: 'Mochi', look: { coat: 'ginger', hat: 'beanie' }, endsAt: new Date(T + SKEW + 600_000).toISOString() },
      { key: 'v-gone', name: 'Kape', look: { coat: 'tabby' }, endsAt: new Date(T + SKEW - 1_000).toISOString() },
    ])
    store.startShift(0, T, null)
    const code = makePublicCode(() => 5)
    const sold = store.createOrder(menu, {
      lines: [{ menuItemId: latte.id, size: latte.prices[0]!.size, modifierIds: [], quantity: 1, iceLevel: 'regular', iceServe: 'mixed', note: '' }],
      type: 'takeout', customerName: 'Ana', customerCode: code, payment: { method: 'gcash' },
    }, T, null)
    store.stampOrder(sold.id, T, null)
    return { store, menu, code }
  }

  it('carries the QR as url and modules only, and one visitor with exactly key, name, look and endsAt', async () => {
    const { store, menu, code } = await scene()
    const feed = wallSnapshot(store, menu, T, await currentCheckin(store, T))
    const text = JSON.stringify(feed)
    expect(text).not.toContain(SECRET)
    expect(Object.keys(feed.checkin!).sort()).toEqual(['modules', 'url'])
    expect(feed.checkin!.url).toMatch(/\?c=[a-z2-7]{8}$/)
    expect(feed.visitors).toHaveLength(1)
    expect(Object.keys(feed.visitors[0]!).sort()).toEqual(['endsAt', 'key', 'look', 'name'])
    expect(feed.visitors[0]).toEqual({ key: 'v-live', name: 'Mochi', look: { coat: 'ginger', hat: 'beanie' }, endsAt: T + 600_000 })
    expect(text).not.toMatch(/KC-|customerCode/)
    expect(text).not.toContain(code)
    expect(text).not.toContain('Kape')
  })

  it('endsAt is on the till\'s clock: the cat leaves the feed when the server says its visit ends', async () => {
    const { store, menu } = await scene()
    expect(wallSnapshot(store, menu, T + 599_000, null).visitors).toHaveLength(1)
    expect(wallSnapshot(store, menu, T + 600_000, null).visitors).toEqual([])
  })

  it('no secret yet: checkin is null and the wall still runs', async () => {
    const store = createStore(':memory:', openNodeSqlite)
    const menu = builtInMenu(0)
    const feed = wallSnapshot(store, menu, T, await currentCheckin(store, T))
    expect(feed.checkin).toBeNull()
    expect(feed.visitors).toEqual([])
    expect(feed.menu.length).toBeGreaterThan(0)
  })

  it("the tablets' /api/events snapshot has no checkin, secret or visitors", async () => {
    const { store } = await scene()
    const text = JSON.stringify(tabletSnapshot(store, { version: 1, now: T, menuKey: '0:0:', sync: { paired: true, revoked: false, offline: false, pendingSales: 0, pendingEvents: 0, lastSyncAt: T, clockSkewMs: SKEW, problem: null, menuVersion: null, importing: 0 } }))
    expect(text).not.toContain(SECRET)
    expect(text).not.toMatch(/checkin|secret|visitor|Mochi/i)
  })
})

import { describe, expect, it } from 'vitest'
import { makePublicCode, type CatLook, type TillCustomer, type WallVisitor } from '@kennko/core'
import { builtInMenu } from '../till/menu.ts'
import { createStore, type NewOrder } from '../till/store.ts'
import { openNodeSqlite } from '../server/node-sqlite.ts'
import { wallSnapshot } from '../till/wall-feed.ts'

const T = Date.UTC(2026, 10, 22, 8, 0)
const menu = builtInMenu(0)
const latte = menu.categories[0]!.items.find((i) => i.name === 'Café Latte')!
const MOCHI: CatLook = { coat: 'ginger', hat: 'beanie' }
const KAPE: CatLook = { coat: 'black' }
let seed = 0
const newCode = () => makePublicCode(() => (seed++ * 7 + 3) % 31)
const pretty = (bare: string) => `KC-${bare.slice(0, 3)}-${bare.slice(3, 6)}-${bare.slice(6, 9)}`

const visit = (key: string, name: string, look: CatLook, minutes = 30): WallVisitor =>
  ({ key, name, look, endsAt: new Date(T + minutes * 60_000).toISOString() })
const card = (bare: string, catName: string | null, catLook?: CatLook): TillCustomer =>
  ({ code: pretty(bare), catName, ...(catLook ? { catLook } : {}), stampMode: 'digital', stamps: 0, fullCards: 0 })
const sale = (over: Partial<NewOrder> = {}): NewOrder => ({
  lines: [{ menuItemId: latte.id, size: 'M', modifierIds: [], quantity: 1, iceLevel: 'regular', iceServe: 'mixed', note: '' }],
  type: 'dine_in',
  payment: { method: 'cash', tenderedCentavos: 20000 },
  ...over,
})

function till(visitors: WallVisitor[] = [visit('v-mochi', 'Mochi', MOCHI), visit('v-kape', 'Kape', KAPE)]) {
  const store = createStore(':memory:', openNodeSqlite)
  store.startShift(0, T, null)
  store.replaceVisitors(visitors)
  return store
}
const wallOrder = (store: ReturnType<typeof till>, id: number, at = T) =>
  wallSnapshot(store, menu, at, null).orders.find((o) => o.id === id && o.series === 'C')!

describe('an order uses the customer\'s cat that is already on the wall', () => {
  it('a card added to a new sale ties the order to its walking cat at once', () => {
    const store = till()
    const code = newCode()
    store.cacheCustomer(card(code, 'Mochi', MOCHI), T)
    const order = store.createOrder(menu, sale({ customerCode: code }), T, null)
    expect(order.visitorKey).toBe('v-mochi')
    expect(order.catLook).toEqual(MOCHI)
    expect(order.customerName).toBe('Mochi')
    expect(wallOrder(store, order.id)).toMatchObject({ visitor: 'v-mochi', look: MOCHI })
  })

  it('a card whose look the till was never told still finds its cat by name', () => {
    const store = till()
    const code = newCode()
    store.cacheCustomer(card(code, 'Kape'), T)
    const order = store.createOrder(menu, sale({ customerCode: code }), T, null)
    expect(order.visitorKey).toBe('v-kape')
    expect(order.catLook).toEqual(KAPE)
  })

  it('a card whose cat is not visiting gets a cat of its own look and no visitor', () => {
    const store = till([visit('v-kape', 'Kape', KAPE)])
    const code = newCode()
    store.cacheCustomer(card(code, 'Mochi', MOCHI), T)
    const order = store.createOrder(menu, sale({ customerCode: code }), T, null)
    expect(order.visitorKey ?? null).toBeNull()
    expect(order.catLook).toEqual(MOCHI)
    expect(wallOrder(store, order.id).visitor).toBeUndefined()
  })

  it('a walking cat picked on the Sell screen is kept by its key, and its look comes from the visit', () => {
    const store = till()
    const order = store.createOrder(menu, sale({ visitorKey: 'v-kape', catLook: { coat: 'cream' } }), T, null)
    expect(order.visitorKey).toBe('v-kape')
    expect(order.catLook).toEqual(KAPE)
    expect(order.customerName).toBe('Kape')
  })

  it('a picked cat whose visit has ended is dropped, not turned into a look-alike with a dead key', () => {
    const store = till([visit('v-gone', 'Mochi', MOCHI, -1)])
    const order = store.createOrder(menu, sale({ visitorKey: 'v-gone', catLook: MOCHI }), T, null)
    expect(order.visitorKey ?? null).toBeNull()
    expect(order.catLook).toEqual(MOCHI)
  })

  it('assigning a walking cat to an order already in the queue uses that cat', () => {
    const store = till()
    const order = store.createOrder(menu, sale({ customerName: 'Ana' }), T, null)
    expect(wallOrder(store, order.id).visitor).toBeUndefined()
    const assigned = store.setOrderCat(order.id, null, undefined, 'v-mochi', T + 1000)
    expect(assigned.visitorKey).toBe('v-mochi')
    expect(assigned.catLook).toEqual(MOCHI)
    expect(assigned.customerName).toBe('Ana')
    expect(wallOrder(store, order.id, T + 1000)).toMatchObject({ visitor: 'v-mochi', look: MOCHI })
  })

  it('taking the cat away clears both the look and the key', () => {
    const store = till()
    const order = store.createOrder(menu, sale({ visitorKey: 'v-mochi' }), T, null)
    const cleared = store.setOrderCat(order.id, null, undefined, null, T + 1000)
    expect(cleared.visitorKey ?? null).toBeNull()
    expect(cleared.catLook ?? null).toBeNull()
    expect(wallOrder(store, order.id, T + 1000).visitor).toBeUndefined()
  })

  it('refuses a cat that is no longer visiting', () => {
    const store = till()
    const order = store.createOrder(menu, sale(), T, null)
    expect(() => store.setOrderCat(order.id, MOCHI, 'Mochi', 'v-nobody', T)).toThrow('That cat is no longer visiting. Pick again.')
  })

  it('linking a card to a queued order ties it to the card\'s walking cat', () => {
    const store = till()
    const code = newCode()
    store.cacheCustomer(card(code, 'Mochi', MOCHI), T)
    const order = store.createOrder(menu, sale(), T, null)
    const linked = store.linkCustomer(order.id, code, T + 1000, null)
    expect(linked.visitorKey).toBe('v-mochi')
    expect(linked.catLook).toEqual(MOCHI)
  })

  it('a cat assigned by hand is not replaced when a card is linked afterwards', () => {
    const store = till()
    const code = newCode()
    store.cacheCustomer(card(code, 'Mochi', MOCHI), T)
    const order = store.createOrder(menu, sale({ visitorKey: 'v-kape' }), T, null)
    const linked = store.linkCustomer(order.id, code, T + 1000, null)
    expect(linked.visitorKey).toBe('v-kape')
    expect(linked.catLook).toEqual(KAPE)
  })

  it('a customer who checks in after ordering is matched on the wall without touching the order', () => {
    const store = till([])
    const code = newCode()
    store.cacheCustomer(card(code, 'Mochi', MOCHI), T)
    const order = store.createOrder(menu, sale({ customerCode: code }), T, null)
    expect(wallOrder(store, order.id).visitor).toBeUndefined()
    store.replaceVisitors([visit('v-late', 'Mochi', MOCHI)])
    expect(wallOrder(store, order.id, T + 60_000)).toMatchObject({ visitor: 'v-late', look: MOCHI })
  })

  it('a key whose visit ended drops out of the feed, and the look stays', () => {
    const store = till([visit('v-mochi', 'Mochi', MOCHI, 5)])
    const order = store.createOrder(menu, sale({ visitorKey: 'v-mochi' }), T, null)
    const later = wallOrder(store, order.id, T + 6 * 60_000)
    expect(later.visitor).toBeUndefined()
    expect(later.look).toEqual(MOCHI)
  })

  it('the feed still never carries a card code', () => {
    const store = till()
    const code = newCode()
    store.cacheCustomer(card(code, 'Mochi', MOCHI), T)
    store.createOrder(menu, sale({ customerCode: code }), T, null)
    const text = JSON.stringify(wallSnapshot(store, menu, T, null))
    expect(text).not.toContain(code)
    expect(text).not.toMatch(/KC-|customerCode|visitorKey/)
  })
})

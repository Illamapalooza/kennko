import { describe, expect, it } from 'vitest'
import { OrderError } from '@kennko/core'
import { createStore, type NewOrder } from '../server/store.ts'
import { builtInMenu, mapWebsiteMenu } from '../server/menu.ts'
import { reportCsv } from '../server/report.ts'

const menu = builtInMenu(0)
const latte = menu.categories[0].items.find((i) => i.name === 'Café Latte')!
const oat = menu.modifierGroups.find((g) => g.name === 'Milk of Choice')!.modifiers[0]
const T = Date.UTC(2026, 10, 17, 2, 0) // 10:00 in Manila

const order = (over: Partial<NewOrder> = {}): NewOrder => ({
  lines: [{ menuItemId: latte.id, size: 'M', modifierIds: [oat.id], quantity: 2, iceLevel: 'less', iceServe: 'mixed', note: 'less sweet' }],
  type: 'dine_in',
  payment: { method: 'cash', tenderedCentavos: 50000 },
  ...over,
})

describe('built-in menu', () => {
  it('carries the whole printed menu with prices', () => {
    expect(menu.categories.map((c) => c.name)).toEqual(['Premium Classics', "Barista's Choice", 'Sweet Sips', 'Matcha Series'])
    expect(menu.categories.flatMap((c) => c.items)).toHaveLength(22)
    expect(latte.prices).toEqual([{ size: 'M', priceCentavos: 10000 }, { size: 'L', priceCentavos: 11500 }, { size: 'XL', priceCentavos: 13000 }, { size: 'HOT', priceCentavos: 12500 }])
    const hojicha = menu.categories[3].items.find((i) => i.name === 'Hojicha')!
    expect(hojicha.prices.map((p) => p.size)).toEqual(['M', 'L', 'HOT'])
    const ids = menu.categories.flatMap((c) => c.items.map((i) => i.id))
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('maps website rows', () => {
    const mapped = mapWebsiteMenu({
      categories: [{ id: 'c1', name: 'Classics', sort_order: 0, menu_items: [
        { id: 'i2', name: 'B', is_bestseller: true, is_available: false, sort_order: 1, menu_item_prices: [{ size: 'HOT', price_centavos: 9500 }, { size: 'M', price_centavos: 8000 }] },
        { id: 'i1', name: 'A', is_bestseller: false, is_available: true, sort_order: 0, menu_item_prices: [{ size: 'M', price_centavos: 8000 }] },
        { id: 'i3', name: 'No price', is_bestseller: false, is_available: true, sort_order: 2, menu_item_prices: [] },
      ] }],
      groups: [{ id: 'g1', name: 'Add-ons', is_multi_select: true, sort_order: 0, modifiers: [{ id: 'm1', name: 'Milk', price_centavos: 2000, is_available: true, sort_order: 0 }] }],
    }, 5)
    expect(mapped.source).toBe('website')
    expect(mapped.categories[0].items.map((i) => i.name)).toEqual(['A', 'B'])
    expect(mapped.categories[0].items[1].prices.map((p) => p.size)).toEqual(['M', 'HOT'])
    expect(mapped.categories[0].items[1].isAvailable).toBe(false)
    expect(mapped.modifierGroups[0].modifiers[0].priceCentavos).toBe(2000)
  })
})

describe('till', () => {
  it('refuses orders until the till is open', () => {
    const store = createStore(':memory:')
    expect(() => store.createOrder(menu, order(), T)).toThrow(/Open the till/)
  })

  it('takes an order, numbers it, and works out change', () => {
    const store = createStore(':memory:')
    store.startShift(100000, T)
    const first = store.createOrder(menu, order(), T)
    expect(first.number).toBe(1)
    expect(first.totalCentavos).toBe((10000 + 4000) * 2)
    expect(first.changeCentavos).toBe(50000 - 28000)
    expect(first.status).toBe('queued')
    expect(first.lines[0]).toMatchObject({ name: 'Café Latte', iceLevel: 'less', note: 'less sweet' })
    const second = store.createOrder(menu, order({ payment: { method: 'gcash', ref: ' 1234 5678 ' }, discount: { label: 'Senior / PWD 20%', kind: 'percent', value: 20 } }), T)
    expect(second.number).toBe(2)
    expect(second.discountCentavos).toBe(5600)
    expect(second.totalCentavos).toBe(22400)
    expect(second.paymentRef).toBe('1234 5678')
    expect(second.tenderedCentavos).toBeNull()
    // numbering restarts on a new Manila day
    expect(store.createOrder(menu, order(), T + 24 * 3600 * 1000).number).toBe(1)
  })

  it('refuses short cash and unknown payment', () => {
    const store = createStore(':memory:')
    store.startShift(0, T)
    expect(() => store.createOrder(menu, order({ payment: { method: 'cash', tenderedCentavos: 100 } }), T)).toThrow(/less than the total/)
    expect(() => store.createOrder(menu, order({ payment: { method: 'card' as any } }), T)).toThrow(OrderError)
    expect(store.ordersForDay('2026-11-17')).toHaveLength(0)
  })

  it('moves orders through the flow and back', () => {
    const store = createStore(':memory:')
    store.startShift(0, T)
    const { id } = store.createOrder(menu, order(), T)
    expect(store.advance(id, T).status).toBe('preparing')
    expect(store.advance(id, T).status).toBe('serving')
    expect(store.undo(id, T).status).toBe('preparing')
    store.advance(id, T)
    expect(store.advance(id, T).status).toBe('done')
    expect(() => store.advance(id, T)).toThrow(/finished/)
    expect(store.activeOrders()).toHaveLength(0)
  })

  it('voids, tracks cash, and closes with a count', () => {
    const store = createStore(':memory:')
    store.startShift(100000, T)
    const a = store.createOrder(menu, order(), T)
    const b = store.createOrder(menu, order(), T)
    expect(() => store.voidOrder(a.id, '  ', T)).toThrow(/why/)
    expect(store.voidOrder(a.id, 'wrong drink', T).status).toBe('voided')
    expect(() => store.voidOrder(a.id, 'again', T)).toThrow(/already voided/)
    store.cashMove('out', 5000, 'ice', T)
    expect(() => store.cashMove('out', 0, 'x', T)).toThrow(OrderError)
    expect(() => store.endShift(0, '', T)).toThrow(/still in progress/)
    store.advance(b.id, T); store.advance(b.id, T); store.advance(b.id, T)
    const shift = store.openShift()!
    expect(store.shiftSummary(shift).expectedCashCentavos).toBe(100000 + 28000 - 5000)
    const closed = store.endShift(123000, 'all good', T + 1000)
    expect(closed.shift.closedAt).toBe(T + 1000)
    expect(closed.summary.voidCount).toBe(1)
    expect(store.openShift()).toBeNull()
    expect(() => store.voidOrder(b.id, 'late', T)).toThrow(/already closed/)
    expect(store.recentShifts()).toHaveLength(1)
  })

  it('honours sold-out marks', () => {
    const store = createStore(':memory:')
    store.setAvailable(latte.id, false)
    expect(store.soldOut()).toEqual([latte.id])
    store.setAvailable(latte.id, true)
    expect(store.soldOut()).toEqual([])
  })

  it('exports a spreadsheet-safe CSV', () => {
    const store = createStore(':memory:')
    store.startShift(0, T)
    store.createOrder(menu, order({ customerName: '=SUM(A1)' }), T)
    const csv = reportCsv(store.ordersForDay('2026-11-17'))
    const rows = csv.trim().split('\r\n')
    expect(rows).toHaveLength(2)
    expect(rows[1]).toContain("'=SUM(A1)")
    expect(rows[1]).toContain('Café Latte,M,Oat Milk,Less ice; less sweet,2,280.00')
  })
})

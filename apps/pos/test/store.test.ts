import { describe, expect, it } from 'vitest'
import { OrderError } from '@kennko/core'
import { createStore, type NewOrder } from '../till/store.ts'
import { openNodeSqlite } from '../server/node-sqlite.ts'
import { builtInMenu } from '../till/menu.ts'
import { reportCsv } from '../till/report.ts'
import { wallOrders } from '../till/wall-feed.ts'

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
    expect(menu.categories.map((c) => c.name)).toEqual(['Premium Classics', "Barista's Choice", 'Sweet Sips', 'Matcha Series', 'Food'])
    expect(menu.categories.filter((c) => c.kind !== 'food').flatMap((c) => c.items)).toHaveLength(22)
    expect(menu.categories[4].items.map((i) => [i.name, i.prices])).toEqual([
      ['Cookies', [{ size: 'REG', priceCentavos: 6000 }]],
      ['Empanada', [{ size: 'REG', priceCentavos: 4500 }]],
      ['Fries', [{ size: 'REG', priceCentavos: 8500 }]],
    ])
    expect(latte.prices).toEqual([{ size: 'M', priceCentavos: 10000 }, { size: 'L', priceCentavos: 11500 }, { size: 'XL', priceCentavos: 13000 }, { size: 'HOT', priceCentavos: 12500 }])
    const hojicha = menu.categories[3].items.find((i) => i.name === 'Hojicha')!
    expect(hojicha.prices.map((p) => p.size)).toEqual(['M', 'L', 'HOT'])
    const ids = menu.categories.flatMap((c) => c.items.map((i) => i.id))
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('till', () => {
  it('refuses orders until the till is open', () => {
    const store = createStore(':memory:', openNodeSqlite)
    expect(() => store.createOrder(menu, order(), T, null)).toThrow(/Open the till/)
  })

  it('takes an order, numbers it, and works out change', () => {
    const store = createStore(':memory:', openNodeSqlite)
    store.startShift(100000, T, null)
    const first = store.createOrder(menu, order(), T, null)
    expect(first.number).toBe(1)
    expect(first.totalCentavos).toBe((10000 + 4000) * 2)
    expect(first.changeCentavos).toBe(50000 - 28000)
    expect(first.status).toBe('queued')
    expect(first.lines[0]).toMatchObject({ name: 'Café Latte', iceLevel: 'less', note: 'less sweet' })
    const second = store.createOrder(menu, order({ payment: { method: 'gcash', ref: ' 1234 5678 ' }, discount: { label: 'Senior / PWD 20%', kind: 'percent', value: 20 } }), T, null)
    expect(second.number).toBe(2)
    expect(second.discountCentavos).toBe(5600)
    expect(second.totalCentavos).toBe(22400)
    expect(second.paymentRef).toBe('1234 5678')
    expect(second.tenderedCentavos).toBeNull()
    // numbering restarts on a new Manila day
    expect(store.createOrder(menu, order(), T + 24 * 3600 * 1000, null).number).toBe(1)
  })

  it('refuses short cash and unknown payment', () => {
    const store = createStore(':memory:', openNodeSqlite)
    store.startShift(0, T, null)
    expect(() => store.createOrder(menu, order({ payment: { method: 'cash', tenderedCentavos: 100 } }), T, null)).toThrow(/less than the total/)
    expect(() => store.createOrder(menu, order({ payment: { method: 'card' as any } }), T, null)).toThrow(OrderError)
    expect(store.ordersForDay('2026-11-17')).toHaveLength(0)
  })

  it('moves orders through the flow and back', () => {
    const store = createStore(':memory:', openNodeSqlite)
    store.startShift(0, T, null)
    const { id } = store.createOrder(menu, order(), T, null)
    expect(store.advance(id, T, null).status).toBe('preparing')
    expect(store.advance(id, T, null).status).toBe('serving')
    expect(store.undo(id, T, null).status).toBe('preparing')
    store.advance(id, T, null)
    expect(store.advance(id, T, null).status).toBe('done')
    expect(() => store.advance(id, T, null)).toThrow(/finished/)
    expect(store.activeOrders()).toHaveLength(0)
  })

  it('voids, tracks cash, and closes with a count', () => {
    const store = createStore(':memory:', openNodeSqlite)
    store.startShift(100000, T, null)
    const a = store.createOrder(menu, order(), T, null)
    const b = store.createOrder(menu, order(), T, null)
    expect(() => store.voidOrder(a.id, '  ', T, null)).toThrow(/why/)
    expect(store.voidOrder(a.id, 'wrong drink', T, null).status).toBe('voided')
    expect(() => store.voidOrder(a.id, 'again', T, null)).toThrow(/already voided/)
    store.cashMove('out', 5000, 'ice', T, null)
    expect(() => store.cashMove('out', 0, 'x', T, null)).toThrow(OrderError)
    expect(() => store.endShift(0, '', T, null)).toThrow(/still in progress/)
    store.advance(b.id, T, null); store.advance(b.id, T, null); store.advance(b.id, T, null)
    const shift = store.openShift()!
    expect(store.shiftSummary(shift).expectedCashCentavos).toBe(100000 + 28000 - 5000)
    const closed = store.endShift(123000, 'all good', T + 1000, null)
    expect(closed.shift.closedAt).toBe(T + 1000)
    expect(closed.summary.voidCount).toBe(1)
    expect(store.openShift()).toBeNull()
    expect(() => store.voidOrder(b.id, 'late', T, null)).toThrow(/already closed/)
    expect(store.recentShifts()).toHaveLength(1)
  })

  it('gives the wall drinks and steps, never money', () => {
    const store = createStore(':memory:', openNodeSqlite)
    store.startShift(0, T, null)
    const a = store.createOrder(menu, order({
      customerName: 'Ana',
      lines: [
        { menuItemId: latte.id, size: 'M', modifierIds: [], quantity: 1, iceLevel: null, iceServe: null, note: '' },
        { menuItemId: latte.id, size: 'L', modifierIds: [oat.id], quantity: 2, iceLevel: null, iceServe: null, note: '' },
      ],
    }), T, null)
    const b = store.createOrder(menu, order(), T, null)
    store.voidOrder(b.id, 'mistake', T + 5000, null)
    const feed = wallOrders([...store.activeOrders(), ...store.recentlyFinished(T)])
    expect(feed).toEqual([
      { id: a.id, number: 1, series: 'C', name: 'Ana', items: [{ name: 'Café Latte', qty: 3 }], status: 'queued', createdAt: T, updatedAt: T },
      { id: b.id, number: 2, series: 'C', name: '', items: [{ name: 'Café Latte', qty: 2 }], status: 'voided', createdAt: T, updatedAt: T + 5000 },
    ])
    expect(JSON.stringify(feed)).not.toMatch(/centavos|payment|tendered/i)
    expect(store.recentlyFinished(T + 6000)).toEqual([])
  })

  it('names the person a void or cash move is credited to, while the till knows them', () => {
    const store = createStore(':memory:', openNodeSqlite)
    const MIA = '55555555-5555-4555-8555-555555555555'
    store.replaceStaffCache([{ id: MIA, fullName: 'Mia Santos', role: 'manager', pinHash: 'x' }])
    store.startShift(0, T, MIA)
    const a = store.createOrder(menu, order(), T, MIA)
    const b = store.createOrder(menu, order(), T, null)
    expect(a.voidedByName).toBeNull()
    expect(store.voidOrder(a.id, 'wrong drink', T, MIA).voidedByName).toBe('Mia Santos')
    expect(store.voidOrder(b.id, 'mistake', T, null).voidedByName).toBeNull()
    expect(store.ordersForDay('2026-11-17').find((o) => o.id === a.id)!.voidedByName).toBe('Mia Santos')
    expect(store.cashMove('out', 100, 'ice', T, MIA).staffName).toBe('Mia Santos')
    store.replaceStaffCache([])
    expect(store.getOrder(a.id).voidedByName).toBeNull()
    expect(store.cashMoves(store.openShift()!.id)[0].staffName).toBeNull()
  })

  it('honours sold-out marks', () => {
    const store = createStore(':memory:', openNodeSqlite)
    store.setAvailable(latte.id, false, T, null, { outbox: false })
    expect(store.soldOut()).toEqual([latte.id])
    store.setAvailable(latte.id, true, T, null, { outbox: false })
    expect(store.soldOut()).toEqual([])
  })

  it('exports a spreadsheet-safe CSV', () => {
    const store = createStore(':memory:', openNodeSqlite)
    store.startShift(0, T, null)
    store.createOrder(menu, order({ customerName: '=SUM(A1)' }), T, null)
    const csv = reportCsv(store.ordersForDay('2026-11-17'))
    const rows = csv.trim().split('\r\n')
    expect(rows).toHaveLength(2)
    expect(rows[1]).toContain("'=SUM(A1)")
    expect(rows[1]).toContain('Café Latte,M,Oat Milk,Less ice; less sweet,2,280.00')
  })

  it('snapshot drops file rows and checkin_secret', async () => {
    const os = await import('node:os')
    const fs = await import('node:fs')
    const path = await import('node:path')
    const { openNodeSqlite } = await import('../server/node-sqlite.ts')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kennko-snap-'))
    try {
      const store = createStore(path.join(dir, 'src.db'), openNodeSqlite)
      store.kvSet('file:device.json', '{"token":"t"}')
      store.kvSet('checkin_secret', 's3cr3t')
      const copyPath = path.join(dir, 'copy.db')
      store.snapshot(copyPath)
      const copy = createStore(copyPath, openNodeSqlite)
      expect(copy.kvGet('file:device.json')).toBeNull()
      expect(copy.kvGet('checkin_secret')).toBeNull()
      copy.close()
      store.close()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('food on the built-in menu', () => {
  const food = menu.categories.find((c) => c.kind === 'food')!
  const byName = (name: string) => food.items.find((i) => i.name === name)!
  const flavour = (group: string, name: string) => menu.modifierGroups.find((g) => g.name === group)!.modifiers.find((m) => m.name === name)!

  it('sells Cookies, Empanada and Fries at their REG prices, with no ice, and queues them for the outbox', () => {
    const store = createStore(':memory:', openNodeSqlite)
    store.startShift(0, T, null)
    const sale = store.createOrder(menu, order({
      lines: [
        { menuItemId: byName('Cookies').id, size: 'REG', modifierIds: [flavour('Cookie flavour', 'Red Velvet').id], quantity: 2, iceLevel: 'regular', iceServe: 'mixed', note: '' },
        { menuItemId: byName('Empanada').id, size: 'REG', modifierIds: [], quantity: 1, iceLevel: null, iceServe: null, note: '' },
        { menuItemId: byName('Fries').id, size: 'REG', modifierIds: [flavour('Fries flavour', 'Cheese').id], quantity: 1, iceLevel: null, iceServe: null, note: '' },
      ],
    }), T, null)
    expect(sale.lines.map((l) => [l.name, l.size, l.lineTotalCentavos, l.iceLevel, l.modifiers.map((m) => m.name)])).toEqual([
      ['Cookies', 'REG', 12000, null, ['Red Velvet']],
      ['Empanada', 'REG', 4500, null, []],
      ['Fries', 'REG', 8500, null, ['Cheese']],
    ])
    expect(sale.totalCentavos).toBe(25000)
  })

  it('refuses Cookies or Fries without a flavour', () => {
    const store = createStore(':memory:', openNodeSqlite)
    store.startShift(0, T, null)
    const plain = { menuItemId: byName('Fries').id, size: 'REG' as const, modifierIds: [], quantity: 1, iceLevel: null, iceServe: null, note: '' }
    expect(() => store.createOrder(menu, order({ lines: [plain] }), T, null)).toThrow('Pick a fries flavour for Fries.')
  })

  it('keeps the flavour groups off the drinks', () => {
    expect(latte.modifierGroupIds).toEqual(['add-ons', 'milk-of-choice', 'cream-supreme'])
  })
})

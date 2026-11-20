import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADDON_LIMIT_MESSAGE, liveDrinkMenu, type Menu, type MenuSnapshot } from '@kennko/core'
import { createStore, type NewOrder } from '../server/store.ts'
import { builtInMenu } from '../server/menu.ts'

const menu = builtInMenu(0)
const latte = menu.categories[0].items.find((i) => i.name === 'Café Latte')!
const T = Date.UTC(2026, 10, 17, 2, 0) // 10:00 in Manila
const ANA = '11111111-1111-4111-8111-111111111111'
const BEN = '22222222-2222-4222-8222-222222222222'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const sale = (over: Partial<NewOrder> = {}): NewOrder => ({
  lines: [{ menuItemId: latte.id, size: 'M', modifierIds: [], quantity: 1, iceLevel: 'regular', iceServe: 'mixed', note: '' }],
  type: 'takeout',
  payment: { method: 'cash', tenderedCentavos: 20000 },
  ...over,
})

const rows = (store: ReturnType<typeof createStore>) =>
  store.db.prepare('select kind, entity, entity_local_id, staff_id, occurred_at from outbox order by seq').all() as any[]

const dirs: string[] = []
const tempDir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kennko-outbox-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

describe('outbox', () => {
  it('adds exactly one row per write, with who and when', () => {
    const store = createStore(':memory:')
    const shift = store.startShift(100000, T, ANA)
    expect(rows(store)).toEqual([{ kind: 'shift.opened', entity: 'shift', entity_local_id: shift.id, staff_id: ANA, occurred_at: T }])

    const order = store.createOrder(menu, sale(), T + 1, ANA)
    store.advance(order.id, T + 2, BEN)
    store.undo(order.id, T + 3, BEN)
    const other = store.createOrder(menu, sale(), T + 4, null)
    store.voidOrder(other.id, 'wrong drink', T + 5, BEN)
    const move = store.cashMove('out', 5000, 'ice', T + 6, BEN)
    store.setAvailable(latte.id, false, T + 7, ANA, { outbox: true })
    store.advance(order.id, T + 8, ANA); store.advance(order.id, T + 8, ANA); store.advance(order.id, T + 8, ANA)
    store.endShift(120000, 'all good', T + 9, BEN)

    expect(rows(store)).toEqual([
      { kind: 'shift.opened', entity: 'shift', entity_local_id: shift.id, staff_id: ANA, occurred_at: T },
      { kind: 'order.created', entity: 'order', entity_local_id: order.id, staff_id: ANA, occurred_at: T + 1 },
      { kind: 'order.prep_status', entity: 'order', entity_local_id: order.id, staff_id: BEN, occurred_at: T + 2 },
      { kind: 'order.prep_status', entity: 'order', entity_local_id: order.id, staff_id: BEN, occurred_at: T + 3 },
      { kind: 'order.created', entity: 'order', entity_local_id: other.id, staff_id: null, occurred_at: T + 4 },
      { kind: 'order.cancelled', entity: 'order', entity_local_id: other.id, staff_id: BEN, occurred_at: T + 5 },
      { kind: 'cash.moved', entity: 'cash_move', entity_local_id: move.id, staff_id: BEN, occurred_at: T + 6 },
      { kind: 'menu.availability', entity: 'menu', entity_local_id: null, staff_id: ANA, occurred_at: T + 7 },
      { kind: 'order.prep_status', entity: 'order', entity_local_id: order.id, staff_id: ANA, occurred_at: T + 8 },
      { kind: 'order.prep_status', entity: 'order', entity_local_id: order.id, staff_id: ANA, occurred_at: T + 8 },
      { kind: 'order.prep_status', entity: 'order', entity_local_id: order.id, staff_id: ANA, occurred_at: T + 8 },
      { kind: 'shift.closed', entity: 'shift', entity_local_id: shift.id, staff_id: BEN, occurred_at: T + 9 },
    ])
  })

  it('stores attribution on the rows themselves', () => {
    const store = createStore(':memory:')
    const shift = store.startShift(0, T, ANA)
    const order = store.createOrder(menu, sale(), T, ANA)
    store.voidOrder(order.id, 'oops', T, BEN)
    const move = store.cashMove('in', 1000, 'change', T, ANA)
    store.endShift(1000, '', T, BEN)
    expect(store.db.prepare('select opened_by_staff, closed_by_staff, needs_import from shifts where id = ?').get(shift.id))
      .toEqual({ opened_by_staff: ANA, closed_by_staff: BEN, needs_import: 0 })
    expect(store.db.prepare('select cancelled_by_staff, needs_import from orders where id = ?').get(order.id))
      .toEqual({ cancelled_by_staff: BEN, needs_import: 0 })
    expect(store.db.prepare('select staff_id, needs_import from cash_moves where id = ?').get(move.id))
      .toEqual({ staff_id: ANA, needs_import: 0 })
  })

  it('sends events in order with the uuids filled in from the rows', () => {
    const store = createStore(':memory:')
    const shift = store.startShift(100000, T, ANA)
    const order = store.createOrder(menu, sale({ customerName: 'Ana', payment: { method: 'gcash', ref: '99' } }), T + 1, ANA)
    store.advance(order.id, T + 2, ANA)
    store.voidOrder(order.id, 'mistake', T + 3, BEN)
    const move = store.cashMove('in', 2500, 'coins', T + 4, null)
    store.setAvailable(latte.id, false, T + 5, ANA, { outbox: true })
    store.endShift(102500, 'fine', T + 6, BEN)

    const shiftUid = (store.db.prepare('select uid from shifts where id = ?').get(shift.id) as any).uid
    const o = store.db.prepare('select uid, payment_uid, menu_version from orders where id = ?').get(order.id) as any
    const moveUid = (store.db.prepare('select uid from cash_moves where id = ?').get(move.id) as any).uid
    expect(shiftUid).toMatch(UUID)
    expect(o.uid).toMatch(UUID)
    expect(o.payment_uid).toMatch(UUID)
    expect(o.payment_uid).not.toBe(o.uid)
    expect(o.menu_version).toBeNull()
    expect(moveUid).toMatch(UUID)

    const events = store.outboxEvents()
    expect(events.map((e) => e.kind)).toEqual([
      'shift.opened', 'order.created', 'order.prep_status', 'order.cancelled', 'cash.moved', 'menu.availability', 'shift.closed',
    ])
    expect(events.map((e) => e.seq)).toEqual([...events.map((e) => e.seq)].sort((a, b) => a - b))
    for (const e of events) expect(e.id).toMatch(UUID)
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length)
    expect(events[0]).toMatchObject({ occurredAt: new Date(T).toISOString(), staffId: ANA, payload: { shiftId: shiftUid, openingFloatCentavos: 100000 } })
    expect(events[1]).toMatchObject({ occurredAt: new Date(T + 1).toISOString(), staffId: ANA })
    expect(events[1].payload).toEqual({
      orderId: o.uid,
      shiftId: shiftUid,
      businessDay: '2026-11-17',
      ticketNumber: 1,
      fulfilment: 'takeout',
      customerName: 'Ana',
      menuVersion: null,
      lines: order.lines,
      discount: null,
      subtotalCentavos: 10000,
      discountCentavos: 0,
      totalCentavos: 10000,
      payment: { id: o.payment_uid, method: 'gcash', tenderedCentavos: null, changeCentavos: null, reference: '99' },
    })
    expect(events[2].payload).toEqual({ orderId: o.uid, to: 'preparing' })
    expect(events[3]).toMatchObject({ staffId: BEN, payload: { orderId: o.uid, reason: 'mistake' } })
    expect(events[4]).toMatchObject({ staffId: null, payload: { id: moveUid, shiftId: shiftUid, kind: 'in', amountCentavos: 2500, reason: 'coins' } })
    expect(events[5].payload).toEqual({ itemId: latte.id, available: false })
    expect(events[6].payload).toEqual({ shiftId: shiftUid, countedCentavos: 102500, expectedCentavos: 102500, note: 'fine' })

    expect(store.outboxEvents(3).map((e) => e.kind)).toEqual(['shift.opened', 'order.created', 'order.prep_status'])
  })

  it('maps every till step to the prep status', () => {
    const store = createStore(':memory:')
    store.startShift(0, T, null)
    const { id } = store.createOrder(menu, sale(), T, null)
    store.advance(id, T, null); store.advance(id, T, null); store.undo(id, T, null); store.undo(id, T, null)
    store.advance(id, T, null); store.advance(id, T, null); store.advance(id, T, null)
    const tos = store.outboxEvents().filter((e) => e.kind === 'order.prep_status').map((e) => (e.payload as any).to)
    expect(tos).toEqual(['preparing', 'ready', 'preparing', 'placed', 'preparing', 'ready', 'completed'])
  })

  it('carries the menu version a sale was rung on', () => {
    const snapshot: MenuSnapshot = {
      version: 3, publishedAt: '2026-11-01T00:00:00Z', discountPresets: [], optionGroups: [],
      categories: [{ id: 'c1', name: 'Coffee', kind: 'drink', items: [{
        id: 'i1', name: 'Latte', description: null, imagePath: null, isAvailable: true, isBestseller: false,
        variants: [{ id: 'v1', code: 'M', label: 'Medium', priceCentavos: 12000, temperature: 'iced', isAvailable: true }], optionGroupIds: [],
      }] }],
    }
    const website = liveDrinkMenu(snapshot, T)
    expect(website.version).toBe(3)
    const store = createStore(':memory:')
    store.startShift(0, T, null)
    const order = store.createOrder(website, sale({ lines: [{ menuItemId: 'i1', size: 'M', modifierIds: [], quantity: 1, iceLevel: null, iceServe: null, note: '' }] }), T, null)
    expect((store.db.prepare('select menu_version from orders where id = ?').get(order.id) as any).menu_version).toBe(3)
    expect((store.outboxEvents()[1].payload as any).menuVersion).toBe(3)
  })

  it('a write that fails leaves the outbox as it was (same transaction)', () => {
    const store = createStore(':memory:')
    expect(() => store.createOrder(menu, sale(), T, ANA)).toThrow(/Open the till/)
    expect(rows(store)).toHaveLength(0)
    store.startShift(0, T, ANA)
    const order = store.createOrder(menu, sale(), T, ANA)
    store.voidOrder(order.id, 'mistake', T, BEN)
    const before = rows(store)
    expect(() => store.voidOrder(order.id, 'again', T, BEN)).toThrow(/already voided/)
    expect(() => store.cashMove('out', 100, '   ', T, BEN)).toThrow(/what the cash is for/)
    expect(() => store.startShift(0, T, ANA)).toThrow(/already open/)
    expect(() => store.advance(order.id, T, ANA)).toThrow()
    expect(rows(store)).toEqual(before)
  })

  it('a sold-out change while unpaired changes the mark and adds nothing', () => {
    const store = createStore(':memory:')
    store.setAvailable(latte.id, false, T, ANA, { outbox: false })
    expect(store.soldOut()).toEqual([latte.id])
    store.setAvailable(latte.id, true, T, ANA, { outbox: false })
    expect(store.soldOut()).toEqual([])
    expect(rows(store)).toHaveLength(0)
  })

  it('acks only the given ids and counts what is pending', () => {
    const store = createStore(':memory:')
    expect(store.pending()).toEqual({ sales: 0, events: 0 })
    store.startShift(0, T, null)
    const a = store.createOrder(menu, sale(), T, null)
    store.createOrder(menu, sale(), T, null)
    store.advance(a.id, T, null)
    expect(store.pending()).toEqual({ sales: 2, events: 4 })
    const events = store.outboxEvents()
    store.ackOutbox([events[0].id, events[1].id])
    expect(store.outboxEvents().map((e) => e.id)).toEqual([events[2].id, events[3].id])
    expect(store.pending()).toEqual({ sales: 1, events: 2 })
    store.ackOutbox([])
    store.ackOutbox(['33333333-3333-4333-8333-333333333333'])
    expect(store.pending()).toEqual({ sales: 1, events: 2 })
  })

  it('keeps small values in kv', () => {
    const store = createStore(':memory:')
    expect(store.kvGet('schema')).toBe('4')
    expect(store.kvGet('missing')).toBeNull()
    store.kvSet('last_sync', '123')
    store.kvSet('last_sync', '456')
    expect(store.kvGet('last_sync')).toBe('456')
  })

  it('stops at the first row whose uuids are not known yet, so order is kept', () => {
    const store = createStore(':memory:')
    store.startShift(0, T, null)
    const legacy = store.createOrder(menu, sale(), T, null)
    const fresh = store.createOrder(menu, sale(), T, null)
    store.ackOutbox(store.outboxEvents().map((e) => e.id))
    expect(store.pending().events).toBe(0)
    // A legacy order (no uid until the device id is known) advanced after the upgrade.
    store.db.prepare('update orders set uid = null where id = ?').run(legacy.id)
    store.advance(fresh.id, T, null)
    store.advance(legacy.id, T, null)
    store.advance(fresh.id, T, null)
    expect(store.outboxEvents().map((e) => (e.payload as any).orderId))
      .toEqual([(store.db.prepare('select uid from orders where id = ?').get(fresh.id) as any).uid])
    store.db.prepare('update orders set uid = ? where id = ?').run('44444444-4444-4444-8444-444444444444', legacy.id)
    expect(store.outboxEvents()).toHaveLength(3)
  })

  it('a sale in a shift with no uid waits too', () => {
    const store = createStore(':memory:')
    const shift = store.startShift(0, T, null)
    store.ackOutbox(store.outboxEvents().map((e) => e.id))
    store.db.prepare('update shifts set uid = null where id = ?').run(shift.id)
    store.createOrder(menu, sale(), T, null)
    store.cashMove('in', 100, 'coins', T, null)
    expect(store.outboxEvents()).toEqual([])
    expect(store.pending()).toEqual({ sales: 1, events: 2 })
  })
})

describe('what the till normalises so the API never holds its events as invalid (P4-4)', () => {
  it('records a staff id that is not a uuid as nobody, with a warning, and never refuses', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const store = createStore(':memory:')
      const shift = store.startShift(0, T, 'ana')
      const order = store.createOrder(menu, sale(), T, 'not-a-uuid')
      store.voidOrder(order.id, 'oops', T, 'x')
      expect(rows(store).map((r) => r.staff_id)).toEqual([null, null, null])
      expect(store.db.prepare('select opened_by_staff from shifts where id = ?').get(shift.id)).toEqual({ opened_by_staff: null })
      expect(store.db.prepare('select cancelled_by_staff from orders where id = ?').get(order.id)).toEqual({ cancelled_by_staff: null })
      expect(warn).toHaveBeenCalledTimes(3)
    } finally {
      warn.mockRestore()
    }
  })

  it('a fractional percent is rounded to a whole one rather than refused', () => {
    const store = createStore(':memory:')
    store.startShift(0, T, null)
    const order = store.createOrder(menu, sale({ discount: { label: 'x', kind: 'percent', value: 12.5 } }), T, null)
    expect(order.discountCentavos).toBe(1300) // 13% of 100.00
    expect((store.outboxEvents()[1].payload as any).discount).toEqual({ label: 'x', kind: 'percent', value: 13 })
  })

  it('an amount discount bigger than the order is sent as the subtotal and still sells', () => {
    const store = createStore(':memory:')
    store.startShift(0, T, null)
    const order = store.createOrder(menu, sale({ discount: { label: 'Free', kind: 'amount', value: 3_000_000_000 } }), T, null)
    expect(order.totalCentavos).toBe(0)
    expect(order.discountCentavos).toBe(10000)
    expect((store.outboxEvents()[1].payload as any).discount).toEqual({ label: 'Free', kind: 'amount', value: 10000 })
  })

  it('sells drinks and add-ons with very long names, cut to what the API keeps', () => {
    const long: Menu = structuredClone(menu)
    const item = long.categories[0].items.find((i) => i.id === latte.id)!
    item.name = 'L'.repeat(200)
    const group = long.modifierGroups[0]
    group.modifiers[0].name = 'O'.repeat(200)
    const store = createStore(':memory:')
    store.startShift(0, T, null)
    const order = store.createOrder(long, sale({
      lines: [{ menuItemId: latte.id, size: 'M', modifierIds: [group.modifiers[0].id], quantity: 1, iceLevel: null, iceServe: null, note: '' }],
    }), T, null)
    expect(order.lines[0].name).toBe('L'.repeat(120))
    expect(order.lines[0].modifiers[0].name).toBe('O'.repeat(120))
    const line = (store.outboxEvents()[1].payload as any).lines[0]
    expect(line.name).toBe('L'.repeat(120))
    expect(line.modifiers[0].name).toBe('O'.repeat(120))
  })

  it('keeps a guard of 20 add-ons on one drink, in the same words as the till screen', () => {
    const many: Menu = structuredClone(menu)
    many.modifierGroups.push({
      id: 'extras', name: 'Extras', isMultiSelect: true,
      modifiers: Array.from({ length: 21 }, (_, i) => ({ id: `extra-${i}`, name: `Extra ${i}`, priceCentavos: 0, isAvailable: true })),
    })
    const store = createStore(':memory:')
    store.startShift(0, T, null)
    const line = (n: number) => ({ menuItemId: latte.id, size: 'M' as const, modifierIds: Array.from({ length: n }, (_, i) => `extra-${i}`), quantity: 1, iceLevel: null, iceServe: null, note: '' })
    expect(() => store.createOrder(many, sale({ lines: [line(21)] }), T, null)).toThrow(ADDON_LIMIT_MESSAGE)
    expect(store.createOrder(many, sale({ lines: [line(20)] }), T, null).lines[0].modifiers).toHaveLength(20)
  })

  it('cleans text so nothing sent holds a NUL or a broken character', () => {
    const store = createStore(':memory:')
    store.startShift(0, T, null)
    const order = store.createOrder(menu, sale({
      customerName: 'Ana\u0000' + 'x'.repeat(19) + '😀😀',
      discount: { label: 'Promo\u0000', kind: 'amount', value: 100 },
    }), T, null)
    const payload = store.outboxEvents()[1].payload as any
    expect(payload.customerName).not.toMatch(/\u0000/)
    expect(payload.customerName).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/)
    expect(payload.customerName.length).toBeLessThanOrEqual(24)
    expect(payload.discount.label).toBe('Promo')
    expect(order.customerName).toBe(payload.customerName)
  })

  it('refuses an empty item id for a sold-out mark', () => {
    const store = createStore(':memory:')
    expect(() => store.setAvailable('', false, T, null, { outbox: true })).toThrow()
    expect(rows(store)).toHaveLength(0)
  })

  it('keeps notes and reasons within what the API accepts', () => {
    const store = createStore(':memory:')
    store.startShift(0, T, null)
    const move = store.cashMove('in', 100, 'r'.repeat(300), T, null)
    expect(move.reason).toHaveLength(80)
    const order = store.createOrder(menu, sale(), T, null)
    store.voidOrder(order.id, 'v'.repeat(500), T, null)
    const other = store.createOrder(menu, sale(), T, null)
    store.advance(other.id, T, null); store.advance(other.id, T, null); store.advance(other.id, T, null)
    store.endShift(0, 'n'.repeat(500), T, null)
    const events = store.outboxEvents()
    const cancelled = events.find((e) => e.kind === 'order.cancelled')!.payload as any
    const closed = events.find((e) => e.kind === 'shift.closed')!.payload as any
    expect(cancelled.reason.length).toBeLessThanOrEqual(200)
    expect(closed.note.length).toBeLessThanOrEqual(200)
  })
})

/** The till's schema before Plan 4, copied as it was, so the upgrade is tested against a real old file. */
const OLD_SCHEMA = `
  create table if not exists shifts (
    id integer primary key autoincrement,
    opened_at integer not null,
    opening_float integer not null,
    closed_at integer,
    counted integer,
    note text not null default ''
  );
  create table if not exists orders (
    id integer primary key autoincrement,
    day text not null,
    number integer not null,
    type text not null,
    customer_name text not null default '',
    status text not null,
    lines text not null,
    subtotal integer not null,
    discount integer not null,
    discount_label text,
    total integer not null,
    payment_method text not null,
    tendered integer,
    change integer,
    payment_ref text,
    shift_id integer not null references shifts(id),
    created_at integer not null,
    updated_at integer not null,
    voided_at integer,
    void_reason text,
    prev_status text,
    unique (day, number)
  );
  create index if not exists orders_shift_idx on orders (shift_id);
  create table if not exists cash_moves (
    id integer primary key autoincrement,
    shift_id integer not null references shifts(id),
    kind text not null,
    amount integer not null,
    reason text not null,
    at integer not null
  );
  create table if not exists sold_out (item_id text primary key);
  create table if not exists sessions (
    token_hash text primary key,
    staff_id text,
    staff_name text,
    role text not null check (role in ('staff', 'manager')),
    created_at integer not null
  );
  create table if not exists staff_cache (
    id text primary key,
    full_name text not null,
    role text not null check (role in ('owner', 'manager', 'barista')),
    pin_hash text not null
  );
`

describe('upgrade from the till before Plan 4', () => {
  const oldFile = () => {
    const file = path.join(tempDir(), 'pos.db')
    const db = new DatabaseSync(file)
    db.exec(OLD_SCHEMA)
    db.prepare('insert into shifts (opened_at, opening_float, closed_at, counted, note) values (?, ?, ?, ?, ?)').run(T, 50000, T + 1000, 60000, '')
    const add = db.prepare(`insert into orders (day, number, type, status, lines, subtotal, discount, total, payment_method, tendered, change,
      shift_id, created_at, updated_at) values ('2026-11-17', ?, 'takeout', 'done', '[]', 10000, 0, 10000, 'cash', 10000, 0, 1, ?, ?)`)
    add.run(1, T, T)
    add.run(2, T, T)
    db.prepare("insert into cash_moves (shift_id, kind, amount, reason, at) values (1, 'in', 500, 'coins', ?)").run(T)
    db.close()
    return file
  }

  it('marks every row already there for import, once', () => {
    const file = oldFile()
    const store = createStore(file)
    expect(store.kvGet('schema')).toBe('4')
    expect(store.db.prepare('select uid, needs_import from shifts').all()).toEqual([{ uid: null, needs_import: 1 }])
    expect(store.db.prepare('select uid, payment_uid, needs_import from orders').all())
      .toEqual([{ uid: null, payment_uid: null, needs_import: 1 }, { uid: null, payment_uid: null, needs_import: 1 }])
    expect(store.db.prepare('select uid, needs_import from cash_moves').all()).toEqual([{ uid: null, needs_import: 1 }])
    expect(store.outboxEvents()).toEqual([])

    const shift = store.startShift(0, T + 2000, null)
    const order = store.createOrder(menu, sale(), T + 2000, null)
    store.close()

    const again = createStore(file)
    expect(again.db.prepare('select needs_import from shifts where id = ?').get(shift.id)).toEqual({ needs_import: 0 })
    expect(again.db.prepare('select needs_import from orders where id = ?').get(order.id)).toEqual({ needs_import: 0 })
    expect(again.db.prepare('select count(*) as n from orders where needs_import = 1').get()).toEqual({ n: 2 })
    expect(again.outboxEvents()).toHaveLength(2)
    again.close()
  })

  it('finishes a half-done upgrade: some columns already there, no marker yet', () => {
    const file = oldFile()
    const db = new DatabaseSync(file)
    db.exec('alter table shifts add column uid text; alter table orders add column uid text; alter table orders add column needs_import integer not null default 0')
    db.close()
    const store = createStore(file)
    expect(store.kvGet('schema')).toBe('4')
    expect(store.db.prepare('select uid, needs_import, opened_by_staff from shifts').all()).toEqual([{ uid: null, needs_import: 1, opened_by_staff: null }])
    expect(store.db.prepare('select needs_import, payment_uid from orders').all())
      .toEqual([{ needs_import: 1, payment_uid: null }, { needs_import: 1, payment_uid: null }])
    expect(store.db.prepare('select needs_import, staff_id from cash_moves').all()).toEqual([{ needs_import: 1, staff_id: null }])
    store.startShift(0, T + 2000, null)
    store.close()
    const again = createStore(file)
    expect(again.db.prepare('select needs_import from shifts order by id').all()).toEqual([{ needs_import: 1 }, { needs_import: 0 }])
    again.close()
  })

  it('a fresh till just sets the marker', () => {
    const store = createStore(path.join(tempDir(), 'pos.db'))
    expect(store.kvGet('schema')).toBe('4')
    store.close()
  })
})

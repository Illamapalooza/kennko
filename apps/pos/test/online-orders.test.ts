import { describe, expect, it } from 'vitest'
import { isOnlineQueueOrder, manilaDay, OrderError, type OnlineQueueOrder } from '@kennko/core'
import { createStore, type NewOrder } from '../server/store.ts'
import { builtInMenu } from '../server/menu.ts'

const menu = builtInMenu(0)
const latte = menu.categories[0].items.find((i) => i.name === 'Café Latte')!
const T = Date.UTC(2026, 10, 17, 2, 0) // 10:00 in Manila
const ANA = '11111111-1111-4111-8111-111111111111'
const BEN = '22222222-2222-4222-8222-222222222222'
const PICKUP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const DELIVERY_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const pickup: OnlineQueueOrder = {
  id: PICKUP_ID,
  businessDay: '2026-11-17',
  ticketNumber: 1,
  customerName: 'Maria Santos',
  fulfilment: 'pickup',
  fulfilAt: '2026-11-17T02:30:00.000Z',
  customerNote: null,
  prepStatus: 'placed',
  createdAt: '2026-11-17T01:50:00.000Z',
  updatedAt: '2026-11-17T01:51:00.000Z',
  lines: [{ name: 'Café Latte', size: 'M', quantity: 1, options: [], iceLevel: 'regular', iceServe: 'mixed', note: '' }],
  delivery: null,
}
const delivery: OnlineQueueOrder = {
  ...pickup,
  id: DELIVERY_ID,
  ticketNumber: 2,
  customerName: 'Jose Reyes',
  fulfilment: 'delivery',
  prepStatus: 'preparing',
  createdAt: '2026-11-17T01:55:00.000Z',
  updatedAt: '2026-11-17T01:56:00.000Z',
  delivery: { address: '12 Montilla Blvd', barangay: 'Libertad', phone: '09171234567' },
}

const sale = (over: Partial<NewOrder> = {}): NewOrder => ({
  lines: [{ menuItemId: latte.id, size: 'M', modifierIds: [], quantity: 1, iceLevel: 'regular', iceServe: 'mixed', note: '' }],
  type: 'takeout',
  payment: { method: 'cash', tenderedCentavos: 20000 },
  ...over,
})

const outboxRows = (store: ReturnType<typeof createStore>) =>
  store.db.prepare('select kind, entity, entity_local_id, staff_id, occurred_at from outbox order by seq').all() as any[]

describe('online orders on the till', () => {
  it('uses fixtures the core shape check accepts', () => {
    expect(isOnlineQueueOrder(pickup)).toBe(true)
    expect(isOnlineQueueOrder(delivery)).toBe(true)
  })

  it('keeps the pulled orders by createdAt and replaces them on the next pull', () => {
    const store = createStore(':memory:')
    store.replaceOnlineOrders([delivery, pickup])
    expect(store.onlineOrders()).toEqual([pickup, delivery])
    const row = store.db.prepare('select prep_status, updated_at from online_orders where id = ?').get(PICKUP_ID) as any
    expect(row).toEqual({ prep_status: 'placed', updated_at: Date.parse(pickup.updatedAt) })
    store.replaceOnlineOrders([delivery])
    expect(store.onlineOrders()).toEqual([delivery])
    store.replaceOnlineOrders([])
    expect(store.onlineOrders()).toEqual([])
  })

  it('stores a completed delivery without its address and phone, whichever shape the pull sent', () => {
    const store = createStore(':memory:')
    const done = { ...delivery, prepStatus: 'completed' as const }
    store.replaceOnlineOrders([done])
    expect(store.onlineOrders()[0].delivery).toBeNull()
    expect((store.db.prepare('select data from online_orders').get() as any).data).not.toContain('09171234567')
    store.replaceOnlineOrders([{ ...done, delivery: null }])
    expect(store.onlineOrders()).toEqual([{ ...done, delivery: null }])
    // An unfinished delivery keeps them.
    store.replaceOnlineOrders([delivery])
    expect(store.onlineOrders()[0].delivery).toEqual(delivery.delivery)
  })

  it('leaves the table as it was when the list is malformed', () => {
    const store = createStore(':memory:')
    store.replaceOnlineOrders([pickup])
    expect(() => store.replaceOnlineOrders([delivery, { ...pickup, id: 'not-a-uuid' } as any])).toThrow()
    expect(() => store.replaceOnlineOrders([pickup, pickup])).toThrow()
    expect(store.onlineOrders()).toEqual([pickup])
  })

  it('steps a pickup order placed → preparing → ready → completed, then refuses', () => {
    const store = createStore(':memory:')
    store.replaceOnlineOrders([pickup])
    expect(store.advanceOnline(PICKUP_ID, T + 1, ANA)).toEqual({ ...pickup, prepStatus: 'preparing' })
    expect(store.advanceOnline(PICKUP_ID, T + 2, ANA).prepStatus).toBe('ready')
    expect(store.advanceOnline(PICKUP_ID, T + 3, BEN).prepStatus).toBe('completed')
    expect(() => store.advanceOnline(PICKUP_ID, T + 4, ANA)).toThrow(new OrderError('That order is already finished.'))
    expect(store.onlineOrders()[0].prepStatus).toBe('completed')
    expect((store.db.prepare('select updated_at from online_orders').get() as any).updated_at).toBe(T + 3)
  })

  it('a double tap moves the order one step: the second tap names a step that is gone (final fix 1)', () => {
    const store = createStore(':memory:')
    store.replaceOnlineOrders([pickup])
    // Two tablets both see "placed" and tap Start.
    expect(store.advanceOnline(PICKUP_ID, T + 1, ANA, 'placed').prepStatus).toBe('preparing')
    expect(() => store.advanceOnline(PICKUP_ID, T + 2, BEN, 'placed')).toThrow(new OrderError('Someone already moved this order.'))
    expect(store.onlineOrders()[0].prepStatus).toBe('preparing')
    expect((store.db.prepare('select updated_at from online_orders').get() as any).updated_at).toBe(T + 1)
    expect(outboxRows(store)).toHaveLength(1)
    // The step the barista sees now still works.
    expect(store.advanceOnline(PICKUP_ID, T + 3, BEN, 'preparing').prepStatus).toBe('ready')
    expect(outboxRows(store)).toHaveLength(2)
  })

  it('steps a delivery order preparing → out_for_delivery → completed', () => {
    const store = createStore(':memory:')
    store.replaceOnlineOrders([delivery])
    expect(store.advanceOnline(DELIVERY_ID, T, ANA).prepStatus).toBe('out_for_delivery')
    expect(store.advanceOnline(DELIVERY_ID, T, ANA).prepStatus).toBe('completed')
    expect(() => store.advanceOnline(DELIVERY_ID, T, ANA)).toThrow('That order is already finished.')
  })

  it('writes one outbox row per step with the server id, and nothing for a failed step', () => {
    const store = createStore(':memory:')
    store.replaceOnlineOrders([pickup, delivery])
    store.advanceOnline(PICKUP_ID, T + 1, ANA)
    store.advanceOnline(DELIVERY_ID, T + 2, BEN)
    store.advanceOnline(PICKUP_ID, T + 3, null)
    expect(outboxRows(store)).toEqual([
      { kind: 'order.prep_status', entity: 'order', entity_local_id: null, staff_id: ANA, occurred_at: T + 1 },
      { kind: 'order.prep_status', entity: 'order', entity_local_id: null, staff_id: BEN, occurred_at: T + 2 },
      { kind: 'order.prep_status', entity: 'order', entity_local_id: null, staff_id: null, occurred_at: T + 3 },
    ])
    expect(store.outboxEvents().map((e) => ({ kind: e.kind, payload: e.payload, staffId: e.staffId }))).toEqual([
      { kind: 'order.prep_status', payload: { orderId: PICKUP_ID, to: 'preparing' }, staffId: ANA },
      { kind: 'order.prep_status', payload: { orderId: DELIVERY_ID, to: 'out_for_delivery' }, staffId: BEN },
      { kind: 'order.prep_status', payload: { orderId: PICKUP_ID, to: 'ready' }, staffId: null },
    ])

    const before = outboxRows(store)
    expect(() => store.advanceOnline('cccccccc-cccc-4ccc-8ccc-cccccccccccc', T, ANA))
      .toThrow(new OrderError('That online order is no longer on the till.'))
    store.advanceOnline(DELIVERY_ID, T + 4, ANA)
    const after = outboxRows(store)
    expect(() => store.advanceOnline(DELIVERY_ID, T + 5, ANA)).toThrow('That order is already finished.')
    expect(after).toHaveLength(before.length + 1)
    expect(outboxRows(store)).toEqual(after)
  })

  it('records a staff id that is not a uuid as nobody (P4-4)', () => {
    const store = createStore(':memory:')
    store.replaceOnlineOrders([pickup])
    const warn = console.warn
    console.warn = () => {}
    try { store.advanceOnline(PICKUP_ID, T, 'not-a-uuid') } finally { console.warn = warn }
    expect(outboxRows(store)[0].staff_id).toBeNull()
  })

  it('online steps never wait on a local row without a uid, and are not counted as sales', () => {
    const store = createStore(':memory:')
    store.startShift(0, T, null)
    store.createOrder(menu, sale(), T, null)
    store.ackOutbox(store.outboxEvents().map((e) => e.id))
    store.replaceOnlineOrders([pickup])
    store.advanceOnline(PICKUP_ID, T, ANA)
    expect(store.outboxEvents()).toHaveLength(1)
    expect(store.pending()).toEqual({ sales: 0, events: 1 })
  })

  it('keeps counter prep steps mapped through the order uid', () => {
    const store = createStore(':memory:')
    store.startShift(0, T, null)
    const order = store.createOrder(menu, sale(), T, null)
    store.advance(order.id, T, null)
    const uid = (store.db.prepare('select uid from orders where id = ?').get(order.id) as any).uid
    expect(store.outboxEvents().at(-1)!.payload).toEqual({ orderId: uid, to: 'preparing' })
  })

  describe('a pull replays the unsent steps (Review Focus 4)', () => {
    it('an unsent step survives a pull that has not seen it yet', () => {
      const store = createStore(':memory:')
      store.replaceOnlineOrders([pickup])
      store.advanceOnline(PICKUP_ID, T + 7, ANA)
      store.replaceOnlineOrders([pickup])
      expect(store.onlineOrders()[0].prepStatus).toBe('preparing')
      expect((store.db.prepare('select updated_at from online_orders').get() as any).updated_at).toBe(T + 7)

      store.ackOutbox(store.outboxEvents().map((e) => e.id))
      store.replaceOnlineOrders([pickup])
      expect(store.onlineOrders()[0].prepStatus).toBe('placed')
    })

    it('replays several unsent steps in order', () => {
      const store = createStore(':memory:')
      store.replaceOnlineOrders([pickup])
      store.advanceOnline(PICKUP_ID, T, ANA)
      store.advanceOnline(PICKUP_ID, T, ANA)
      store.replaceOnlineOrders([pickup])
      expect(store.onlineOrders()[0].prepStatus).toBe('ready')
    })

    it('a step that is not the next one any more is not replayed', () => {
      const store = createStore(':memory:')
      store.replaceOnlineOrders([pickup])
      store.advanceOnline(PICKUP_ID, T, ANA)
      store.replaceOnlineOrders([{ ...pickup, prepStatus: 'ready' }])
      expect(store.onlineOrders()[0].prepStatus).toBe('ready')
    })

    it('a step for an order no longer pulled inserts nothing', () => {
      const store = createStore(':memory:')
      store.replaceOnlineOrders([pickup, delivery])
      store.advanceOnline(PICKUP_ID, T, ANA)
      store.replaceOnlineOrders([delivery])
      expect(store.onlineOrders()).toEqual([delivery])
    })

    it('a broken outbox row never stops the pull, and counter steps are not replayed', () => {
      const store = createStore(':memory:')
      store.startShift(0, T, null)
      const order = store.createOrder(menu, sale(), T, null)
      store.advance(order.id, T, null)
      store.db.prepare("insert into outbox (id, kind, entity, entity_local_id, staff_id, occurred_at, payload) values ('x', 'order.prep_status', 'order', null, null, 0, '{nope')").run()
      store.replaceOnlineOrders([pickup])
      expect(store.onlineOrders()).toEqual([pickup])
    })
  })

  it('lists active and recently finished online orders', () => {
    const store = createStore(':memory:')
    const now = T
    store.replaceOnlineOrders([pickup, { ...delivery, prepStatus: 'out_for_delivery' }])
    store.advanceOnline(PICKUP_ID, now - 2, ANA)
    store.advanceOnline(PICKUP_ID, now - 1, ANA)
    store.advanceOnline(PICKUP_ID, now, ANA)
    expect(store.activeOnlineOrders().map((o) => o.id)).toEqual([DELIVERY_ID])
    expect(store.recentlyFinishedOnline(now - 90_000).map((o) => o.id)).toEqual([PICKUP_ID])
    expect(store.recentlyFinishedOnline(now + 1)).toEqual([])
  })

  it('never touches the counter day, shift, history, queue or C numbers (Review Focus 5)', () => {
    const build = (withOnline: boolean) => {
      const store = createStore(':memory:')
      store.startShift(100000, T, ANA)
      store.createOrder(menu, sale(), T + 1, ANA)
      if (withOnline) {
        store.replaceOnlineOrders([pickup])
        for (let i = 0; i < 3; i++) store.advanceOnline(PICKUP_ID, T + 2, ANA)
      }
      return store
    }
    const plain = build(false)
    const mixed = build(true)
    const today = manilaDay(T)
    expect(mixed.onlineOrders()[0].prepStatus).toBe('completed')
    expect(mixed.daySummary(today)).toEqual(plain.daySummary(today))
    expect(mixed.shiftSummary(mixed.openShift()!)).toEqual(plain.shiftSummary(plain.openShift()!))
    expect(mixed.ordersForDay(today)).toEqual(plain.ordersForDay(today))
    expect(mixed.activeOrders()).toEqual(plain.activeOrders())
    expect(mixed.createOrder(menu, sale(), T + 3, ANA).number).toBe(2)
  })

  it('clearOnlineOrders empties the table and leaves the outbox alone', () => {
    const store = createStore(':memory:')
    store.replaceOnlineOrders([pickup])
    store.advanceOnline(PICKUP_ID, T, ANA)
    store.clearOnlineOrders()
    expect(store.onlineOrders()).toEqual([])
    expect(store.pending().events).toBe(1)
    expect(store.outboxEvents()[0].payload).toEqual({ orderId: PICKUP_ID, to: 'preparing' })
  })
})

import { expect, test } from 'vitest'
import type { PricedLine } from './cart.ts'
import type { MenuSnapshot, SnapshotBody } from './snapshot.ts'
import { TILL_TO_PREP, repriceCounterOrder, MAX_PUSH_EVENTS, BACKOFF_MS, isOnlineQueueOrder, onlinePrepDecision, ONLINE_PULL_MAX, ONLINE_RECENT_MS, type OnlineQueueOrder } from './sync.ts'

const variant = (id: string, code: string, priceCentavos: number, isAvailable = true) => ({
  id, code, label: code, priceCentavos, temperature: 'none' as const, isAvailable,
})
const oatOption = (isAvailable = true) => ({ id: 'o-oat', name: 'Oat milk', priceCentavos: 2000, isAvailable })

const body = (mPrice: number, available = true): SnapshotBody => ({
  categories: [
    {
      id: 'c-coffee', name: 'Coffee', kind: 'drink',
      items: [
        { id: 'i-latte', name: 'Latte', description: null, imagePath: null, isBestseller: false, isAvailable: available, variants: [variant('v-latte-m', 'M', mPrice, available)], optionGroupIds: ['g-milk'] },
        { id: 'i-plain', name: 'Plain', description: null, imagePath: null, isBestseller: false, isAvailable: true, variants: [variant('v-plain-m', 'M', 5000)], optionGroupIds: ['g-other'] },
      ],
    },
  ],
  optionGroups: [
    { id: 'g-milk', name: 'Milk', minSelect: 0, maxSelect: 1, options: [oatOption(available)] },
    { id: 'g-other', name: 'Other', minSelect: 0, maxSelect: 1, options: [{ id: 'o-shot', name: 'Shot', priceCentavos: 1500, isAvailable: true }] },
  ],
  discountPresets: [],
})
const v1: MenuSnapshot = { version: 1, publishedAt: '2026-11-01T00:00:00.000Z', ...body(12000) }
const v2: MenuSnapshot = { version: 2, publishedAt: '2026-11-10T00:00:00.000Z', ...body(13000) }
const soldOut: MenuSnapshot = { version: 1, publishedAt: v1.publishedAt, ...body(12000, false) }

const line = (over: Partial<PricedLine> = {}): PricedLine => ({
  menuItemId: 'i-latte', name: 'Latte', size: 'M', basePriceCentavos: 12000,
  modifiers: [{ id: 'o-oat', name: 'Oat milk', priceCentavos: 2000 }], quantity: 2,
  iceLevel: null, iceServe: null, note: '', lineTotalCentavos: 28000, ...over,
})
const order = (lines: PricedLine[] = [line()]) => {
  const subtotalCentavos = lines.reduce((s, l) => s + l.lineTotalCentavos, 0)
  return { lines, discount: null, subtotalCentavos, discountCentavos: 0, totalCentavos: subtotalCentavos }
}

test('an order priced on v1 matches v1, not v2', () => {
  expect(repriceCounterOrder(v1, order()).matches).toBe(true)
  const r = repriceCounterOrder(v2, order())
  expect(r.matches).toBe(false)
  expect(r.mismatchedLines).toEqual([0])
  expect(r.expected.subtotalCentavos).toBe(30000)
})

test('sold-out marks do not matter', () => {
  expect(repriceCounterOrder(soldOut, order()).matches).toBe(true)
})

test('missing item, size or option is a mismatch', () => {
  expect(repriceCounterOrder(v1, order([line({ menuItemId: 'nope' })])).mismatchedLines).toEqual([0])
  expect(repriceCounterOrder(v1, order([line({ size: 'XL' })])).mismatchedLines).toEqual([0])
  // o-shot belongs to another item's group
  const other = line({ modifiers: [{ id: 'o-shot', name: 'Shot', priceCentavos: 1500 }], lineTotalCentavos: 27000 })
  expect(repriceCounterOrder(v1, order([other])).matches).toBe(false)
  const unknown = line({ modifiers: [{ id: 'o-x', name: 'X', priceCentavos: 2000 }] })
  expect(repriceCounterOrder(v1, order([unknown])).matches).toBe(false)
})

test('a wrong option price or line total is a mismatch, and only the bad line is reported', () => {
  const badOption = line({ modifiers: [{ id: 'o-oat', name: 'Oat milk', priceCentavos: 2500 }], lineTotalCentavos: 29000 })
  const badTotal = line({ lineTotalCentavos: 27000 })
  const r = repriceCounterOrder(v1, order([line(), badOption, badTotal]))
  expect(r.mismatchedLines).toEqual([1, 2])
  expect(r.matches).toBe(false)
})

test('discount is recomputed from kind and value', () => {
  const o = order()
  const senior = { label: 'Senior', kind: 'percent' as const, value: 20 }
  expect(repriceCounterOrder(v1, { ...o, discount: senior, discountCentavos: 5600, totalCentavos: 22400 }).matches).toBe(true)
  expect(repriceCounterOrder(v1, { ...o, discount: senior, discountCentavos: 5000, totalCentavos: 23000 }).matches).toBe(false)
})

test('an invalid quantity or discount never throws', () => {
  expect(repriceCounterOrder(v1, order([line({ quantity: 0, lineTotalCentavos: 0 })])).matches).toBe(false)
  const bad = { label: 'x', kind: 'percent' as const, value: 500 }
  expect(repriceCounterOrder(v1, { ...order(), discount: bad }).matches).toBe(false)
})

test('till statuses map to prep statuses', () => {
  expect(TILL_TO_PREP.serving).toBe('ready')
  expect(TILL_TO_PREP).toEqual({ queued: 'placed', preparing: 'preparing', serving: 'ready', done: 'completed', voided: 'cancelled' })
})

test('constants', () => {
  expect(MAX_PUSH_EVENTS).toBe(50)
  expect(BACKOFF_MS).toEqual([15_000, 30_000, 60_000, 120_000, 300_000])
})

const pickupFixture: OnlineQueueOrder = {
  id: '2f6f1c1e-5b0a-4c53-9a53-0d8f3d6b7a11',
  businessDay: '2026-11-20',
  ticketNumber: 3,
  customerName: 'Ana Reyes',
  fulfilment: 'pickup',
  fulfilAt: '2026-11-20T03:30:00.000Z',
  customerNote: null,
  prepStatus: 'placed',
  createdAt: '2026-11-20T02:00:00.000Z',
  updatedAt: '2026-11-20T02:00:00.000Z',
  lines: [{ name: 'Latte', size: 'M', quantity: 1, options: ['Oat milk'], iceLevel: 'less', iceServe: 'mixed', note: '' }],
  delivery: null,
}
const deliveryFixture: OnlineQueueOrder = {
  ...pickupFixture,
  id: '8a1f0c52-79c0-4a7e-b1a5-4f2f7c3f9d22',
  ticketNumber: 4,
  fulfilment: 'delivery',
  delivery: { address: '12 Rizal St', barangay: 'Libertad', phone: '09171234567' },
}

test('online queue constants', () => {
  expect(ONLINE_PULL_MAX).toBe(200)
  expect(ONLINE_RECENT_MS).toBe(86_400_000)
})
test('online steps follow the same transitions as admin', () => {
  expect(onlinePrepDecision('placed', 'preparing', 'pickup', 'paid')).toBe('move')
  expect(onlinePrepDecision('preparing', 'ready', 'pickup', 'paid')).toBe('move')
  expect(onlinePrepDecision('preparing', 'out_for_delivery', 'delivery', 'paid')).toBe('move')
  expect(onlinePrepDecision('preparing', 'ready', 'delivery', 'paid')).toBe('conflict')
  expect(onlinePrepDecision('placed', 'ready', 'pickup', 'paid')).toBe('conflict')
  expect(onlinePrepDecision('ready', 'preparing', 'pickup', 'paid')).toBe('conflict')
})
test('already there, cancelled, unpaid and cancel requests', () => {
  expect(onlinePrepDecision('ready', 'ready', 'pickup', 'paid')).toBe('same')
  expect(onlinePrepDecision('cancelled', 'preparing', 'pickup', 'refunded')).toBe('cancelled')
  expect(onlinePrepDecision('placed', 'preparing', 'pickup', 'pending_verification')).toBe('not_paid')
  expect(onlinePrepDecision('placed', 'cancelled', 'pickup', 'paid')).toBe('refused')
})
test('isOnlineQueueOrder', () => {
  expect(isOnlineQueueOrder(pickupFixture)).toBe(true)
  expect(isOnlineQueueOrder(deliveryFixture)).toBe(true)
  expect(isOnlineQueueOrder({ ...pickupFixture, delivery: { address: 'x', barangay: 'y', phone: 'z' } })).toBe(false)
  expect(isOnlineQueueOrder({ ...deliveryFixture, delivery: null })).toBe(false)
  // A finished delivery has been handed over: the pull drops its address and phone (final fix 6).
  expect(isOnlineQueueOrder({ ...deliveryFixture, prepStatus: 'completed', delivery: null })).toBe(true)
  expect(isOnlineQueueOrder({ ...deliveryFixture, prepStatus: 'completed' })).toBe(true) // an older API still sends them
  expect(isOnlineQueueOrder({ ...pickupFixture, prepStatus: 'completed', delivery: { address: 'x', barangay: 'y', phone: 'z' } })).toBe(false)
  expect(isOnlineQueueOrder({ ...pickupFixture, prepStatus: 'completed' })).toBe(true)
  expect(isOnlineQueueOrder({ ...pickupFixture, prepStatus: 'eaten' })).toBe(false)
  expect(isOnlineQueueOrder({ ...pickupFixture, id: 'W3' })).toBe(false)
  expect(isOnlineQueueOrder({ ...pickupFixture, ticketNumber: 0 })).toBe(false)
  expect(isOnlineQueueOrder({ ...pickupFixture, lines: [{ ...pickupFixture.lines[0], options: [1] }] })).toBe(false)
  expect(isOnlineQueueOrder({ ...pickupFixture, lines: [{ ...pickupFixture.lines[0], iceLevel: 'lots' }] })).toBe(false)
  expect(isOnlineQueueOrder(null)).toBe(false)
  expect(isOnlineQueueOrder('x')).toBe(false)
})

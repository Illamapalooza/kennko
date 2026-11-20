import { describe, expect, test } from 'vitest'
import { summariseDay, type DayLineRow, type DayOrderRow, type DayRows, type DayShiftRow, type HeldSaleRow, type ShiftSaleRow } from './report.ts'

const DAY = '2026-11-21'
const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0)
let n = 0

/** A counted cash counter sale on till A unless overridden. */
function order(over: Partial<DayOrderRow> = {}): DayOrderRow {
  n += 1
  const total = over.totalCentavos ?? 10000
  return {
    id: `o${n}`,
    channel: 'counter',
    fulfilment: 'dine_in',
    ticketSeries: 'C',
    ticketNumber: n,
    deviceName: 'Till A',
    shiftId: 's1',
    prepStatus: 'completed',
    paymentStatus: 'paid',
    subtotalCentavos: total,
    discountCentavos: 0,
    deliveryFeeCentavos: 0,
    totalCentavos: total,
    flags: [],
    payments: [{ method: 'cash', amountCentavos: total, status: 'recorded' }],
    ...over,
  }
}

function online(over: Partial<DayOrderRow> = {}): DayOrderRow {
  const total = over.totalCentavos ?? 10000
  return order({
    channel: 'online',
    fulfilment: 'pickup',
    ticketSeries: 'W',
    deviceName: null,
    shiftId: null,
    payments: [{ method: 'gcash', amountCentavos: total, status: 'verified' }],
    ...over,
  })
}

const line = (orderId: string, itemName: string, variantLabel: string, quantity: number, lineTotalCentavos: number): DayLineRow => ({
  orderId,
  itemName,
  variantLabel,
  quantity,
  lineTotalCentavos,
})

function shift(over: Partial<DayShiftRow> = {}): DayShiftRow {
  return {
    id: 's1',
    deviceName: 'Till A',
    openedAt: '2026-11-21T00:00:00.000Z',
    closedAt: '2026-11-21T10:00:00.000Z',
    closeReceivedAt: '2026-11-21T10:00:05.000Z',
    openedByName: 'Bea',
    closedByName: 'Bea',
    openingFloatCentavos: 100000,
    countedCentavos: 148000,
    expectedCentavos: 149500,
    closedInAdmin: false,
    cashInCentavos: 20000,
    cashOutCentavos: 10000,
    ...over,
  }
}

const rows = (over: Partial<DayRows> = {}): DayRows => ({ date: DAY, orders: [], lines: [], shifts: [], shiftSales: [], heldSales: [], ...over })

/** The four sales from the brief: ₱150 + ₱245 cash at till A, ₱300 pickup and ₱200 + ₱50 delivery in GCash. */
function fourSales() {
  const c1 = order({ ticketNumber: 1, totalCentavos: 15000 })
  const c2 = order({ ticketNumber: 2, totalCentavos: 24500 })
  const pickup = online({ ticketNumber: 1, totalCentavos: 30000 })
  const delivery = online({
    ticketNumber: 2,
    fulfilment: 'delivery',
    subtotalCentavos: 20000,
    deliveryFeeCentavos: 5000,
    totalCentavos: 25000,
  })
  return [c1, c2, pickup, delivery]
}

describe('summariseDay', () => {
  test('sales across both channels, with payments and tills', () => {
    const r = summariseDay(rows({ orders: fourSales() }))
    expect(r.date).toBe(DAY)
    expect(r.sales).toEqual({
      orders: 4,
      totalCentavos: 94500,
      discountCentavos: 0,
      deliveryFeeCentavos: 5000,
      counter: {
        orders: 2,
        totalCentavos: 39500,
        byTill: [{ deviceName: 'Till A', orders: 2, totalCentavos: 39500, firstTicket: 'C1', lastTicket: 'C2' }],
      },
      online: { orders: 2, totalCentavos: 55000, pickup: 1, delivery: 1 },
    })
    expect(r.payments).toEqual({ cashCentavos: 39500, gcashCentavos: 55000 })
    // The report adds up: the tills plus online are the day, and so are the two payment methods.
    expect(r.sales.counter.totalCentavos + r.sales.online.totalCentavos).toBe(r.sales.totalCentavos)
    expect(r.payments.cashCentavos + r.payments.gcashCentavos).toBe(r.sales.totalCentavos)
  })

  test('voids, refunds, rejections and pending payments stay out of the sales, each in its own bucket', () => {
    const sales = fourSales()
    const voided = order({
      totalCentavos: 12000,
      prepStatus: 'cancelled',
      paymentStatus: 'refunded',
      payments: [{ method: 'cash', amountCentavos: 12000, status: 'refunded' }],
    })
    const refunded = online({
      totalCentavos: 18000,
      prepStatus: 'cancelled',
      paymentStatus: 'refunded',
      payments: [{ method: 'gcash', amountCentavos: 18000, status: 'refunded' }],
    })
    const rejected = online({
      totalCentavos: 9000,
      prepStatus: 'cancelled',
      paymentStatus: 'rejected',
      payments: [{ method: 'gcash', amountCentavos: 9000, status: 'rejected' }],
    })
    const pending = online({
      totalCentavos: 7500,
      prepStatus: 'placed',
      paymentStatus: 'pending_verification',
      payments: [{ method: 'gcash', amountCentavos: 7500, status: 'pending_verification' }],
    })
    const r = summariseDay(rows({ orders: [...sales, voided, refunded, rejected, pending] }))
    expect(r.sales.orders).toBe(4)
    expect(r.sales.totalCentavos).toBe(94500)
    expect(r.payments).toEqual({ cashCentavos: 39500, gcashCentavos: 55000 })
    expect(r.cancelled).toEqual({
      counterVoids: { orders: 1, totalCentavos: 12000 },
      onlineRefunded: { orders: 1, totalCentavos: 18000 },
      onlineRejected: { orders: 1, totalCentavos: 9000 },
    })
    expect(r.awaitingVerification).toEqual({ orders: 1, totalCentavos: 7500 })
    // The voided ticket was still issued: the till's range covers it, its sales do not.
    expect(r.sales.counter.byTill).toEqual([{ deviceName: 'Till A', orders: 2, totalCentavos: 39500, firstTicket: 'C1', lastTicket: `C${voided.ticketNumber}` }])
  })

  test('every order of the day lands in exactly one bucket, and the buckets sum to the day', () => {
    const orders = [
      ...fourSales(),
      order({ totalCentavos: 12000, prepStatus: 'cancelled', paymentStatus: 'refunded' }),
      online({ totalCentavos: 18000, prepStatus: 'cancelled', paymentStatus: 'refunded' }),
      online({ totalCentavos: 9000, prepStatus: 'cancelled', paymentStatus: 'rejected' }),
      online({ totalCentavos: 7500, prepStatus: 'placed', paymentStatus: 'pending_verification' }),
      // Neither a sale nor any named bucket: a legacy unpaid row, and a cancelled online order never refunded.
      order({ totalCentavos: 4000, paymentStatus: 'unpaid', flags: ['legacy'], payments: [] }),
      online({ totalCentavos: 6000, prepStatus: 'cancelled', paymentStatus: 'paid' }),
      online({ totalCentavos: 3000, prepStatus: 'cancelled', paymentStatus: 'pending_verification' }),
    ]
    const r = summariseDay(rows({ orders }))
    expect(r.other).toEqual({ orders: 3, totalCentavos: 13000 })
    const buckets = [r.sales, r.cancelled.counterVoids, r.cancelled.onlineRefunded, r.cancelled.onlineRejected, r.awaitingVerification, r.other]
    expect(buckets.map((b) => b.orders)).toEqual([4, 1, 1, 1, 1, 3])
    expect(sum(buckets, (b) => b.orders)).toBe(orders.length)
    expect(sum(buckets, (b) => b.totalCentavos)).toBe(sum(orders, (o) => o.totalCentavos))
  })

  test('a counted order pays only with recorded or verified payments', () => {
    const o = order({
      totalCentavos: 10000,
      payments: [
        { method: 'gcash', amountCentavos: 10000, status: 'rejected' },
        { method: 'cash', amountCentavos: 10000, status: 'recorded' },
      ],
    })
    expect(summariseDay(rows({ orders: [o] })).payments).toEqual({ cashCentavos: 10000, gcashCentavos: 0 })
  })

  test('items: one row per item and size, by quantity then name; cancelled orders do not count', () => {
    const [c1, c2, pickup] = fourSales()
    const voided = order({ prepStatus: 'cancelled', paymentStatus: 'refunded' })
    const lines = [
      line(c1!.id, 'Latte', 'Medium', 2, 28000),
      line(c2!.id, 'Latte', 'Medium', 1, 14000),
      line(c2!.id, 'Americano', 'Medium', 1, 10000),
      line(pickup!.id, 'Mocha', 'Large', 1, 16000),
      line(pickup!.id, 'Latte', 'Large', 1, 16000),
      line(voided.id, 'Latte', 'Medium', 5, 70000),
    ]
    const r = summariseDay(rows({ orders: [c1!, c2!, pickup!, voided], lines }))
    expect(r.items).toEqual([
      { name: 'Latte', variant: 'Medium', quantity: 3, totalCentavos: 42000 },
      { name: 'Americano', variant: 'Medium', quantity: 1, totalCentavos: 10000 },
      { name: 'Latte', variant: 'Large', quantity: 1, totalCentavos: 16000 },
      { name: 'Mocha', variant: 'Large', quantity: 1, totalCentavos: 16000 },
    ])
  })

  test("shifts: the till's expected, over or short, and an admin close computed from the drawer", () => {
    const [c1, c2] = fourSales()
    const shiftSales: ShiftSaleRow[] = [
      { shiftId: 's1', orderId: c1!.id, cashCentavos: 15000, receivedAt: '2026-11-21T03:00:00.000Z' },
      { shiftId: 's1', orderId: c2!.id, cashCentavos: 24500, receivedAt: '2026-11-21T04:00:00.000Z' },
      { shiftId: 's2', orderId: 'x1', cashCentavos: 5000, receivedAt: '2026-11-21T05:00:00.000Z' },
      { shiftId: 's2', orderId: 'x2', cashCentavos: 0, receivedAt: '2026-11-21T05:30:00.000Z' },
    ]
    const admin = shift({
      id: 's2',
      deviceName: 'Till B',
      expectedCentavos: null,
      countedCentavos: 0,
      closedInAdmin: true,
      closedByName: 'Olive',
      openingFloatCentavos: 50000,
      cashInCentavos: 0,
      cashOutCentavos: 2000,
    })
    const open = shift({ id: 's3', closedAt: null, closeReceivedAt: null, closedByName: null, countedCentavos: null, expectedCentavos: null })
    const r = summariseDay(rows({ orders: [c1!, c2!], shifts: [shift(), admin, open], shiftSales }))
    expect(r.shifts).toEqual([
      {
        id: 's1',
        deviceName: 'Till A',
        openedAt: '2026-11-21T00:00:00.000Z',
        closedAt: '2026-11-21T10:00:00.000Z',
        openedByName: 'Bea',
        closedByName: 'Bea',
        floatCentavos: 100000,
        cashSalesCentavos: 39500,
        cashInCentavos: 20000,
        cashOutCentavos: 10000,
        expectedCentavos: 149500,
        countedCentavos: 148000,
        overShortCentavos: -1500,
        closedInAdmin: false,
        lateSales: 0,
      },
      expect.objectContaining({ id: 's2', cashSalesCentavos: 5000, expectedCentavos: 53000, countedCentavos: 0, overShortCentavos: -53000, closedInAdmin: true }),
      expect.objectContaining({ id: 's3', cashSalesCentavos: 0, expectedCentavos: 110000, countedCentavos: null, overShortCentavos: null, lateSales: 0 }),
    ])
  })

  test('a sale stored after its shift closed is counted on its day and listed under its shift (Ruling 8)', () => {
    const late = order({ totalCentavos: 14000 })
    const onTime = order({ totalCentavos: 10000 })
    const shiftSales: ShiftSaleRow[] = [
      // Stored with the close in the same push: not late, even though the till closed first.
      { shiftId: 's1', orderId: onTime.id, cashCentavos: 10000, receivedAt: '2026-11-21T10:00:05.000Z' },
      { shiftId: 's1', orderId: late.id, cashCentavos: 14000, receivedAt: '2026-11-21T11:00:00.000Z' },
    ]
    const r = summariseDay(rows({ orders: [late, onTime], shifts: [shift({ expectedCentavos: null })], shiftSales }))
    expect(r.shifts[0]).toMatchObject({ lateSales: 1, cashSalesCentavos: 24000, expectedCentavos: 134000 })
    expect(r.sales).toMatchObject({ orders: 2, totalCentavos: 24000 })
  })

  test('legacy orders are inside the totals and counted; only other flags are listed', () => {
    const plain = order({ totalCentavos: 10000, flags: ['legacy'] })
    const dup = order({ totalCentavos: 12000, flags: ['legacy', 'ticket_duplicate'] })
    const skew = online({ totalCentavos: 9000, flags: ['clock_skew'], prepStatus: 'cancelled', paymentStatus: 'refunded' })
    const r = summariseDay(rows({ orders: [plain, dup, skew] }))
    expect(r.legacy).toEqual({ orders: 2, totalCentavos: 22000 })
    expect(r.sales).toMatchObject({ orders: 2, totalCentavos: 22000 })
    expect(r.flagged).toEqual([
      { id: dup.id, ticket: `C${dup.ticketNumber}`, channel: 'counter', flags: ['legacy', 'ticket_duplicate'], totalCentavos: 12000, deviceName: 'Till A' },
      { id: skew.id, ticket: `W${skew.ticketNumber}`, channel: 'online', flags: ['clock_skew'], totalCentavos: 9000, deviceName: null },
    ])
  })

  test('held and set-aside sales are listed apart and never inside the sales (Ruling 4)', () => {
    const heldSales: HeldSaleRow[] = [
      { deviceName: 'Till A', eventId: 'e1', result: 'held', reason: 'invalid: totals', ticketNumber: 7, totalCentavos: 13000, note: null },
      { deviceName: 'Till A', eventId: 'e2', result: 'discarded', reason: 'shift_unknown', ticketNumber: 8, totalCentavos: 6000, note: 'Test sale' },
      { deviceName: 'Till A', eventId: 'e3', result: 'held', reason: 'invalid: lines', ticketNumber: null, totalCentavos: null, note: null },
    ]
    const r = summariseDay(rows({ orders: fourSales(), heldSales }))
    expect(r.held).toEqual({ held: { count: 2, totalCentavos: 13000 }, setAside: { count: 1, totalCentavos: 6000 }, rows: heldSales })
    expect(r.sales.totalCentavos).toBe(94500)
  })

  test('an empty day is zeros and empty lists', () => {
    const zero = { orders: 0, totalCentavos: 0 }
    expect(summariseDay(rows())).toEqual({
      date: DAY,
      sales: {
        orders: 0,
        totalCentavos: 0,
        discountCentavos: 0,
        deliveryFeeCentavos: 0,
        counter: { orders: 0, totalCentavos: 0, byTill: [] },
        online: { orders: 0, totalCentavos: 0, pickup: 0, delivery: 0 },
      },
      payments: { cashCentavos: 0, gcashCentavos: 0 },
      cancelled: { counterVoids: zero, onlineRefunded: zero, onlineRejected: zero },
      awaitingVerification: zero,
      other: zero,
      items: [],
      shifts: [],
      flagged: [],
      legacy: zero,
      held: { held: { count: 0, totalCentavos: 0 }, setAside: { count: 0, totalCentavos: 0 }, rows: [] },
    })
  })
})

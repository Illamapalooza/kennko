import { randomUUID } from 'node:crypto'
import type { CounterOrderPayload } from '@kennko/core'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { startTestDb, type TestDb } from './pg.js'
import {
  availability,
  cashMoved,
  orderCancelled,
  orderCreated,
  prepStatus,
  publishTwoVersions,
  seedDevice,
  seedStaff,
  shiftClosed,
  shiftOpened,
  syncApp,
  type TwoVersions,
} from './sync-helpers.js'

let db: TestDb
let api: ReturnType<typeof syncApp>
let menu: TwoVersions
let bea: string
let olive: string

beforeAll(async () => {
  db = await startTestDb()
  api = syncApp(db.sql)
  menu = await publishTwoVersions(db.sql)
  bea = await seedStaff(db.sql, { fullName: 'Bea' })
  olive = await seedStaff(db.sql, { fullName: 'Olive', role: 'manager' })
})
afterAll(async () => {
  await db.stop()
})

/** A fresh till with a shift opened by Bea. */
async function tillWithShift() {
  const { deviceId, token } = await seedDevice(db.sql)
  const open = shiftOpened({}, { staffId: bea })
  const res = await api.push(token, [open])
  expect(res.results[0]!.result).toBe('applied')
  return { deviceId, token, shiftId: open.payload.shiftId }
}

/** One latte M with oat, priced on a published version: v1 ₱120 + ₱20, v2 ₱130 + ₱20. */
function pricedOn(version: 1 | 2, quantity = 1): Partial<CounterOrderPayload> {
  const base = version === 1 ? 12000 : 13000
  const total = (base + 2000) * quantity
  return {
    menuVersion: version === 1 ? menu.v1 : menu.v2,
    lines: [
      {
        menuItemId: menu.latteId,
        name: 'Latte',
        size: 'M',
        basePriceCentavos: base,
        modifiers: [{ id: menu.oatId, name: 'Oat milk', priceCentavos: 2000 }],
        quantity,
        iceLevel: 'regular',
        iceServe: 'mixed',
        note: 'less sweet',
        lineTotalCentavos: total,
      },
    ],
    subtotalCentavos: total,
    discountCentavos: 0,
    totalCentavos: total,
    payment: { id: randomUUID(), method: 'cash', tenderedCentavos: 20000, changeCentavos: 20000 - total, reference: null },
  }
}

const count = async (table: string, orderId: string) => {
  const rows =
    table === 'orders'
      ? await db.sql`select count(*)::int as n from orders where id = ${orderId}`
      : table === 'order_lines'
        ? await db.sql`select count(*)::int as n from order_lines where order_id = ${orderId}`
        : table === 'order_line_options'
          ? await db.sql`select count(*)::int as n from order_line_options o join order_lines l on l.id = o.line_id
              where l.order_id = ${orderId}`
          : table === 'payments'
            ? await db.sql`select count(*)::int as n from payments where order_id = ${orderId}`
            : await db.sql`select count(*)::int as n from order_events where order_id = ${orderId}`
  return rows[0]!.n as number
}
const fiveCounts = async (orderId: string) =>
  Promise.all(['orders', 'order_lines', 'order_line_options', 'payments', 'order_events'].map((t) => count(t, orderId)))

const orderRow = async (id: string) => (await db.sql`select * from orders where id = ${id}`)[0]

test('an order priced on v2 with menuVersion 2 is applied and stored in all five tables', async () => {
  const { deviceId, token, shiftId } = await tillWithShift()
  const sale = orderCreated({ shiftId, ticketNumber: 7, customerName: 'Ana', ...pricedOn(2) }, { staffId: olive })
  const res = await api.push(token, [sale])
  expect(res).toEqual({ results: [{ id: sale.id, result: 'applied', reason: null, flags: [] }], held: 0 })

  const orderId = sale.payload.orderId
  expect(await orderRow(orderId)).toMatchObject({
    channel: 'counter',
    fulfilment: 'dine_in',
    ticket_series: 'C',
    ticket_number: 7,
    prep_status: 'placed',
    payment_status: 'paid',
    customer_name: 'Ana',
    device_id: deviceId,
    shift_id: shiftId,
    opened_by_staff: bea,
    menu_version: String(menu.v2),
    subtotal_centavos: 15000,
    discount_centavos: 0,
    total_centavos: 15000,
    flags: [],
    order_code: null,
  })
  const order = (await orderRow(orderId))!
  expect(order.business_day).toEqual(new Date('2026-11-21T00:00:00Z'))
  expect(order.created_at.toISOString()).toBe(sale.occurredAt)
  expect(order.received_at.toISOString()).toBe('2026-11-21T02:00:00.000Z')
  expect(order.updated_at.toISOString()).toBe('2026-11-21T02:00:00.000Z')

  const lines = await db.sql`select * from order_lines where order_id = ${orderId}`
  expect(lines).toHaveLength(1)
  expect(lines[0]).toMatchObject({
    item_id: menu.latteId,
    variant_id: menu.latteMId,
    item_name: 'Latte',
    variant_code: 'M',
    variant_label: 'Medium',
    unit_price_centavos: 13000,
    quantity: 1,
    line_total_centavos: 15000,
    ice_level: 'regular',
    ice_serve: 'mixed',
    note: 'less sweet',
  })
  const options = await db.sql`select * from order_line_options where line_id = ${lines[0]!.id}`
  expect(options).toHaveLength(1)
  expect(options[0]).toMatchObject({ option_id: menu.oatId, group_name: 'Milk of Choice', option_name: 'Oat milk', price_centavos: 2000 })

  const payments = await db.sql`select * from payments where order_id = ${orderId}`
  expect(payments).toHaveLength(1)
  expect(payments[0]).toMatchObject({
    id: sale.payload.payment.id,
    method: 'cash',
    status: 'recorded',
    amount_centavos: 15000,
    tendered_centavos: 20000,
    change_centavos: 5000,
    device_id: deviceId,
  })

  const events = await db.sql`select * from order_events where order_id = ${orderId}`
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({
    id: sale.id,
    device_id: deviceId,
    kind: 'created',
    to_value: 'placed',
    staff_id: olive,
    result: 'applied',
    reason: null,
  })
  expect(events[0]!.received_at.toISOString()).toBe('2026-11-21T02:00:00.000Z')
})

test('a GCash order keeps its reference; a discount is stored with its label, kind and value', async () => {
  const { token, shiftId } = await tillWithShift()
  const p = pricedOn(2)
  const sale = orderCreated({
    shiftId,
    ...p,
    fulfilment: 'takeout',
    discount: { label: 'Senior', kind: 'amount', value: 3000 },
    discountCentavos: 3000,
    totalCentavos: 12000,
    payment: { id: randomUUID(), method: 'gcash', tenderedCentavos: null, changeCentavos: null, reference: '1234567890123' },
  })
  const res = await api.push(token, [sale])
  expect(res.results[0]).toMatchObject({ result: 'applied', flags: [] })
  expect(await orderRow(sale.payload.orderId)).toMatchObject({
    fulfilment: 'takeout',
    discount_label: 'Senior',
    discount_kind: 'amount',
    discount_value: 3000,
    discount_centavos: 3000,
    total_centavos: 12000,
  })
  const [pay] = await db.sql`select * from payments where order_id = ${sale.payload.orderId}`
  expect(pay).toMatchObject({ method: 'gcash', reference: '1234567890123', amount_centavos: 12000, tendered_centavos: null })
})

test('re-pricing uses the version the order was rung on', async () => {
  const { token, shiftId } = await tillWithShift()
  const onV1 = orderCreated({ shiftId, ticketNumber: 1, ...pricedOn(1) })
  const r1 = await api.push(token, [onV1])
  expect(r1.results[0]).toMatchObject({ result: 'applied', reason: null, flags: [] })
  expect((await orderRow(onV1.payload.orderId))!.menu_version).toBe(String(menu.v1))

  const claimsV2 = orderCreated({ shiftId, ticketNumber: 2, ...pricedOn(1), menuVersion: menu.v2 })
  const r2 = await api.push(token, [claimsV2])
  expect(r2.results[0]).toMatchObject({ result: 'flagged', reason: 'reprice_mismatch', flags: ['reprice_mismatch'] })
  expect(await orderRow(claimsV2.payload.orderId)).toMatchObject({
    flags: ['reprice_mismatch'],
    menu_version: String(menu.v2),
    subtotal_centavos: 14000,
    total_centavos: 14000,
  })
  const [line] = await db.sql`select * from order_lines where order_id = ${claimsV2.payload.orderId}`
  expect(line).toMatchObject({ unit_price_centavos: 12000, line_total_centavos: 14000 })
  const [ev] = await db.sql`select result, reason from order_events where id = ${claimsV2.id}`
  expect(ev).toEqual({ result: 'flagged', reason: 'reprice_mismatch' })
})

test('unknown or missing versions, duplicate C numbers and a far business day are flagged, never held', async () => {
  const { token, shiftId } = await tillWithShift()

  const v99 = orderCreated({ shiftId, ticketNumber: 1, ...pricedOn(2), menuVersion: 99 })
  // The built-in menu: slug ids and no version.
  const builtIn = orderCreated({ shiftId, ticketNumber: 2, menuVersion: null })
  const again = orderCreated({ shiftId, ticketNumber: 2, menuVersion: null })
  const skewed = orderCreated({ shiftId, ticketNumber: 3, businessDay: '2026-11-18', ...pricedOn(2) })
  const res = await api.push(token, [v99, builtIn, again, skewed])
  expect(res.held).toBe(0)
  expect(res.results.map((r) => [r.result, r.flags])).toEqual([
    ['flagged', ['unknown_version']],
    ['flagged', ['unknown_version']],
    ['flagged', ['unknown_version', 'ticket_duplicate']],
    ['flagged', ['clock_skew']],
  ])
  expect(res.results[2]!.reason).toBe('unknown_version,ticket_duplicate')

  expect(await orderRow(v99.payload.orderId)).toMatchObject({ menu_version: null, flags: ['unknown_version'] })
  // Real uuids still resolve without a snapshot; the label falls back to the size name.
  const [v99Line] = await db.sql`select * from order_lines where order_id = ${v99.payload.orderId}`
  expect(v99Line).toMatchObject({ item_id: menu.latteId, variant_label: 'Medium' })
  const [v99Opt] = await db.sql`select * from order_line_options where line_id = ${v99Line!.id}`
  expect(v99Opt).toMatchObject({ option_id: menu.oatId, group_name: '' })

  const [line] = await db.sql`select * from order_lines where order_id = ${builtIn.payload.orderId}`
  expect(line).toMatchObject({ item_id: null, variant_id: null, item_name: 'Latte', variant_code: 'M', variant_label: 'Medium' })
  const [opt] = await db.sql`select * from order_line_options where line_id = ${line!.id}`
  expect(opt).toMatchObject({ option_id: null, option_name: 'Oat milk', group_name: '', price_centavos: 2000 })

  // Both C2 orders exist.
  expect(await orderRow(builtIn.payload.orderId)).toMatchObject({ ticket_number: 2, flags: ['unknown_version'] })
  expect(await orderRow(again.payload.orderId)).toMatchObject({ ticket_number: 2, flags: ['unknown_version', 'ticket_duplicate'] })
  expect(await orderRow(skewed.payload.orderId)).toMatchObject({ flags: ['clock_skew'] })
  expect((await orderRow(skewed.payload.orderId))!.business_day).toEqual(new Date('2026-11-18T00:00:00Z'))
})

test('the same C number on another till or another day is not a duplicate; one day off is not skew', async () => {
  const a = await tillWithShift()
  const b = await tillWithShift()
  const one = orderCreated({ shiftId: a.shiftId, ticketNumber: 5, ...pricedOn(2) })
  const otherTill = orderCreated({ shiftId: b.shiftId, ticketNumber: 5, ...pricedOn(2) })
  const yesterday = orderCreated({ shiftId: a.shiftId, ticketNumber: 5, businessDay: '2026-11-20', ...pricedOn(2) })
  expect((await api.push(a.token, [one])).results[0]!.flags).toEqual([])
  expect((await api.push(b.token, [otherTill])).results[0]!.flags).toEqual([])
  expect((await api.push(a.token, [yesterday])).results[0]!.flags).toEqual([])
})

test('an item sold out in admin is still applied', async () => {
  const { token, shiftId } = await tillWithShift()
  await db.sql`update menu_items set is_available = false where id = ${menu.latteId}`
  try {
    const sale = orderCreated({ shiftId, ...pricedOn(2) })
    const res = await api.push(token, [sale])
    expect(res.results[0]).toMatchObject({ result: 'applied', flags: [] })
  } finally {
    await db.sql`update menu_items set is_available = true where id = ${menu.latteId}`
  }
})

test('the same order.created pushed twice is a duplicate and leaves one row in each table', async () => {
  const { token, shiftId } = await tillWithShift()
  const sale = orderCreated({ shiftId, ...pricedOn(2) })
  expect((await api.push(token, [sale])).results[0]!.result).toBe('applied')
  const second = await api.push(token, [sale])
  expect(second.results[0]!.result).toBe('duplicate')
  expect(await fiveCounts(sale.payload.orderId)).toEqual([1, 1, 1, 1, 1])
})

test('an order for an unknown shift is held, then applied when the shift arrives', async () => {
  const { token } = await seedDevice(db.sql)
  const open = shiftOpened({}, { staffId: bea })
  const sale = orderCreated({ shiftId: open.payload.shiftId, ...pricedOn(2) })
  const first = await api.push(token, [sale])
  expect(first).toMatchObject({ results: [{ result: 'held', reason: 'shift_unknown' }], held: 1 })
  expect(await orderRow(sale.payload.orderId)).toBeUndefined()

  const second = await api.push(token, [open])
  expect(second.held).toBe(0)
  expect(await orderRow(sale.payload.orderId)).toMatchObject({ opened_by_staff: bea })
  const [receipt] = await db.sql`select result, reason, applied_at from sync_events where id = ${sale.id}`
  expect(receipt).toMatchObject({ result: 'applied', reason: null })
  expect(receipt!.applied_at).not.toBeNull()
})

test('prep and cancel for an order not yet received wait, then all three apply in seq order', async () => {
  const { deviceId, token, shiftId } = await tillWithShift()
  // Rung first (lower seq), but its push is the last to arrive.
  const sale = orderCreated({ shiftId, ...pricedOn(2) })
  const orderId = sale.payload.orderId
  const prep = prepStatus({ orderId, to: 'preparing' }, { staffId: bea })
  const cancel = orderCancelled({ orderId, reason: 'Customer left' }, { staffId: olive })

  const first = await api.push(token, [prep])
  expect(first).toMatchObject({ results: [{ result: 'held', reason: 'order_unknown' }], held: 1 })
  const second = await api.push(token, [cancel])
  expect(second).toMatchObject({ results: [{ result: 'held', reason: 'waits_for_earlier' }], held: 2 })

  const third = await api.push(token, [sale])
  expect(third).toEqual({ results: [{ id: sale.id, result: 'applied', reason: null, flags: [] }], held: 0 })

  expect(await orderRow(orderId)).toMatchObject({
    prep_status: 'cancelled',
    payment_status: 'refunded',
    cancelled_by_staff: olive,
    cancel_reason: 'Customer left',
  })
  expect((await orderRow(orderId))!.cancelled_at.toISOString()).toBe(cancel.occurredAt)
  const [pay] = await db.sql`select status from payments where order_id = ${orderId}`
  expect(pay!.status).toBe('refunded')
  const events = await db.sql`select id, kind, from_value, to_value, staff_id, device_id, reason from order_events
    where order_id = ${orderId} order by occurred_at`
  expect(events).toEqual([
    { id: sale.id, kind: 'created', from_value: null, to_value: 'placed', staff_id: null, device_id: deviceId, reason: null },
    { id: prep.id, kind: 'prep_status', from_value: 'placed', to_value: 'preparing', staff_id: bea, device_id: deviceId, reason: null },
    {
      id: cancel.id,
      kind: 'cancelled',
      from_value: 'preparing',
      to_value: 'cancelled',
      staff_id: olive,
      device_id: deviceId,
      reason: 'Customer left',
    },
  ])
  const receipts = await db.sql`select result from sync_events where id in ${db.sql([prep.id, cancel.id])}`
  expect(receipts.map((r) => r.result)).toEqual(['applied', 'applied'])
})

test('prep placed → preparing → ready → completed in one push; a change after cancel is a no-op', async () => {
  const { token, shiftId } = await tillWithShift()
  const sale = orderCreated({ shiftId, ...pricedOn(2) })
  const orderId = sale.payload.orderId
  const steps = (['preparing', 'ready', 'completed'] as const).map((to) => prepStatus({ orderId, to }))
  const res = await api.push(token, [sale, ...steps])
  expect(res.results.map((r) => r.result)).toEqual(['applied', 'applied', 'applied', 'applied'])
  expect((await orderRow(orderId))!.prep_status).toBe('completed')
  const events = await db.sql`select from_value, to_value from order_events where order_id = ${orderId} and kind = 'prep_status'
    order by occurred_at`
  expect(events).toEqual([
    { from_value: 'placed', to_value: 'preparing' },
    { from_value: 'preparing', to_value: 'ready' },
    { from_value: 'ready', to_value: 'completed' },
  ])
  const updated = (await orderRow(orderId))!.updated_at.toISOString()
  expect(updated).toBe('2026-11-21T02:00:00.000Z')

  const other = orderCreated({ shiftId, ticketNumber: 2, ...pricedOn(2) })
  const cancel = orderCancelled({ orderId: other.payload.orderId })
  const late = prepStatus({ orderId: other.payload.orderId, to: 'ready' })
  const cancelAgain = orderCancelled({ orderId: other.payload.orderId })
  const r2 = await api.push(token, [other, cancel, late, cancelAgain])
  expect(r2.results.map((r) => [r.result, r.reason])).toEqual([
    ['applied', null],
    ['applied', null],
    ['applied', 'already_cancelled'],
    ['applied', 'already_cancelled'],
  ])
  expect(await orderRow(other.payload.orderId)).toMatchObject({ prep_status: 'cancelled', payment_status: 'refunded' })
  expect(await count('order_events', other.payload.orderId)).toBe(2)
})

test('prep or cancel from the till on an online order is flagged online_order and changes nothing', async () => {
  const { token } = await seedDevice(db.sql)
  const [o] = await db.sql`
    insert into orders (channel, order_code, fulfilment, prep_status, payment_status, business_day,
      ticket_series, ticket_number, customer_name, customer_phone, customer_email, fulfil_at,
      subtotal_centavos, total_centavos)
    values ('online', 'KNK-SYNC1', 'pickup', 'placed', 'paid', '2026-11-21', 'W', 901, 'Ana', '09171234567',
      'a@x.test', now(), 10000, 10000)
    returning id`
  const orderId = o!.id as string
  const res = await api.push(token, [prepStatus({ orderId, to: 'ready' }), orderCancelled({ orderId })])
  expect(res.results.map((r) => [r.result, r.reason])).toEqual([
    ['flagged', 'online_order'],
    ['flagged', 'online_order'],
  ])
  expect(await orderRow(orderId)).toMatchObject({ prep_status: 'placed', payment_status: 'paid' })
  expect(await count('order_events', orderId)).toBe(0)
})

test('impossible totals are held invalid: totals with no order rows; events on other entities still apply', async () => {
  const p = pricedOn(2)
  const cases: Partial<CounterOrderPayload>[] = [
    { totalCentavos: 14999 },
    { discountCentavos: 16000, totalCentavos: 0 },
    { payment: { ...p.payment!, tenderedCentavos: 20000, changeCentavos: 1 } },
    { lines: [{ ...p.lines![0]!, lineTotalCentavos: 14000 }] },
  ]
  for (const over of cases) {
    const { token, shiftId } = await tillWithShift()
    const bad = orderCreated({ shiftId, ...p, ...over })
    const toggle = availability({ itemId: menu.latteId, available: true })
    // Per-entity order: a later event on the same shift waits behind the held order.
    const sameShift = cashMoved({ shiftId, amountCentavos: 1000 })
    const res = await api.push(token, [bad, toggle, sameShift])
    expect(res.results.map((r) => [r.result, r.reason])).toEqual([
      ['held', 'invalid: totals'],
      ['applied', null],
      ['held', 'waits_for_earlier'],
    ])
    expect(await orderRow(bad.payload.orderId)).toBeUndefined()
    expect(await fiveCounts(bad.payload.orderId)).toEqual([0, 0, 0, 0, 0])
  }
})

test('payload values a table would refuse are held invalid, not thrown', async () => {
  const p = pricedOn(2)
  const line = p.lines![0]!
  const cases: [Partial<CounterOrderPayload>, string][] = [
    [{ customerName: 'x'.repeat(81) }, 'invalid: customerName:'],
    [{ lines: [{ ...line, quantity: 21, lineTotalCentavos: 15000 * 21 }] }, 'invalid: lines.0.quantity:'],
    [{ lines: [{ ...line, note: 'x'.repeat(201) }] }, 'invalid: lines.0.note:'],
    [{ lines: [{ ...line, iceLevel: 'none', iceServe: 'side' }] }, 'invalid: lines.0.iceServe:'],
    [{ lines: [{ ...line, iceLevel: 'regular', iceServe: null }] }, 'invalid: lines.0.iceServe:'],
    [{ lines: Array.from({ length: 41 }, () => line), subtotalCentavos: 15000 * 41, totalCentavos: 15000 * 41 }, 'invalid: lines:'],
    [{ totalCentavos: 2 ** 31 }, 'invalid: totalCentavos:'],
    [{ ticketNumber: 2 ** 31 }, 'invalid: ticketNumber:'],
    [{ discount: { label: 'x', kind: 'amount', value: 2 ** 31 } }, 'invalid: discount.value:'],
  ]
  for (const [over, reason] of cases) {
    const { token, shiftId } = await tillWithShift()
    const sale = orderCreated({ shiftId, ...p, ...over })
    const res = await api.push(token, [sale])
    expect(res.results[0]!.result).toBe('held')
    expect(res.results[0]!.reason).toContain(reason)
  }
  // No ice preference at all (a hot drink) is fine.
  const { token, shiftId } = await tillWithShift()
  const hot = orderCreated({ shiftId, ...p, lines: [{ ...line, iceLevel: null, iceServe: null }] })
  expect((await api.push(token, [hot])).results[0]!.result).toBe('applied')
})

test('an order whose id already exists is applied as already_recorded and writes nothing more', async () => {
  const { token, shiftId } = await tillWithShift()
  const sale = orderCreated({ shiftId, ...pricedOn(2) })
  await api.push(token, [sale])
  const resent = orderCreated({ shiftId, ...pricedOn(2), orderId: sale.payload.orderId })
  const res = await api.push(token, [resent])
  expect(res.results[0]).toMatchObject({ result: 'applied', reason: 'already_recorded' })
  expect(await fiveCounts(sale.payload.orderId)).toEqual([1, 1, 1, 1, 1])
})

test('a shift close after the orders, and a sale with an unknown staff id, still apply', async () => {
  const { token, shiftId } = await tillWithShift()
  const sale = orderCreated({ shiftId, ...pricedOn(2) }, { staffId: randomUUID() })
  const close = shiftClosed({ shiftId })
  const res = await api.push(token, [sale, close, availability({ itemId: menu.latteId, available: true })])
  expect(res.results.map((r) => [r.result, r.reason])).toEqual([
    ['applied', 'unknown_staff'],
    ['applied', null],
    ['applied', null],
  ])
  const [ev] = await db.sql`select staff_id from order_events where id = ${sale.id}`
  expect(ev!.staff_id).toBeNull()
})

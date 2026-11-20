import { randomUUID } from 'node:crypto'
import type { ImportChunk, ImportOrder, ImportResponse, ImportShift } from '@kennko/core'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { startTestDb, type TestDb } from './pg.js'
import { seedDevice, seedStaff, shiftOpened, syncApp } from './sync-helpers.js'

let db: TestDb
let api: ReturnType<typeof syncApp>
let bea: string

beforeAll(async () => {
  db = await startTestDb()
  api = syncApp(db.sql)
  bea = await seedStaff(db.sql, { fullName: 'Bea' })
})
afterAll(async () => {
  await db.stop()
})

const post = (token: string | null, body: unknown) =>
  api.app.request('/v1/sync/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })

async function importOk(token: string, chunk: unknown): Promise<ImportResponse> {
  const res = await post(token, chunk)
  if (res.status !== 200) throw new Error(`import answered ${res.status}: ${await res.text()}`)
  return (await res.json()) as ImportResponse
}

const shift = (over: Partial<ImportShift> = {}): ImportShift => ({
  id: randomUUID(),
  openedAt: '2026-11-01T00:00:00.000Z',
  openingFloatCentavos: 100000,
  closedAt: '2026-11-01T10:00:00.000Z',
  countedCentavos: 150000,
  expectedCentavos: 149000,
  note: 'ok',
  openedByStaff: bea,
  closedByStaff: null,
  ...over,
})

const order = (shiftId: string | null, over: Partial<ImportOrder> = {}): ImportOrder => ({
  id: randomUUID(),
  shiftId,
  businessDay: '2026-11-01',
  ticketNumber: 1,
  fulfilment: 'dine_in',
  customerName: 'Walk-in',
  status: 'done',
  lines: [
    {
      menuItemId: 'latte',
      name: 'Latte',
      size: 'M',
      basePriceCentavos: 12000,
      modifiers: [{ id: 'oat', name: 'Oat milk', priceCentavos: 2000 }],
      quantity: 1,
      iceLevel: null,
      iceServe: null,
      note: '',
      lineTotalCentavos: 14000,
    },
  ],
  subtotalCentavos: 14000,
  discountCentavos: 0,
  discountLabel: null,
  totalCentavos: 14000,
  payment: { id: randomUUID(), method: 'cash', tenderedCentavos: 20000, changeCentavos: 6000, reference: null },
  createdAt: '2026-11-01T01:00:00.000Z',
  voidedAt: null,
  voidReason: null,
  cancelledByStaff: null,
  ...over,
})

const counts = async () => {
  const [r] = await db.sql<Record<string, number>[]>`
    select (select count(*)::int from shifts) as shifts, (select count(*)::int from orders) as orders,
      (select count(*)::int from order_lines) as lines, (select count(*)::int from order_line_options) as options,
      (select count(*)::int from payments) as payments, (select count(*)::int from cash_moves) as cash_moves,
      (select count(*)::int from order_events) as events`
  return r
}

function fullChunk() {
  const s = shift()
  const done = order(s.id, { ticketNumber: 1 })
  const voided = order(s.id, {
    ticketNumber: 2,
    status: 'voided',
    voidedAt: '2026-11-01T02:00:00.000Z',
    voidReason: 'Wrong order',
    cancelledByStaff: bea,
    discountCentavos: 1400,
    discountLabel: 'Senior',
    totalCentavos: 12600,
    payment: { id: randomUUID(), method: 'cash', tenderedCentavos: 13000, changeCentavos: 400, reference: null },
  })
  const serving = order(s.id, { ticketNumber: 3, status: 'serving' })
  const chunk: ImportChunk = {
    shifts: [s],
    orders: [done, voided, serving],
    cashMoves: [{ id: randomUUID(), shiftId: s.id, kind: 'in', amountCentavos: 5000, reason: 'Change', at: '2026-11-01T03:00:00.000Z', staffId: bea }],
  }
  return { chunk, s, done, voided, serving }
}

test('imports a shift, three orders and a cash move as legacy rows; a second run changes nothing', async () => {
  const { token, deviceId } = await seedDevice(db.sql)
  const { chunk, s, done, voided, serving } = fullChunk()
  const before = await counts()
  expect(await importOk(token, chunk)).toEqual({ inserted: 5, existing: 0, skipped: 0 })

  const [sh] = await db.sql`select * from shifts where id = ${s.id}`
  expect(sh).toMatchObject({ is_legacy: true, device_id: deviceId, opened_by_staff: bea, counted_centavos: 150000, expected_centavos: 149000 })
  const rows = await db.sql`select * from orders where id = any(${[done.id, voided.id, serving.id]}::uuid[]) order by ticket_number`
  expect(rows).toHaveLength(3)
  for (const r of rows) {
    expect(r).toMatchObject({
      channel: 'counter',
      ticket_series: 'C',
      menu_version: null,
      device_id: deviceId,
      shift_id: s.id,
      discount_kind: null,
      discount_value: null,
    })
    expect(r.flags).toEqual(['legacy'])
  }
  expect(rows[0]).toMatchObject({ prep_status: 'completed', payment_status: 'paid' })
  expect(rows[1]).toMatchObject({
    prep_status: 'cancelled',
    payment_status: 'refunded',
    cancel_reason: 'Wrong order',
    cancelled_by_staff: bea,
    discount_label: 'Senior',
  })
  expect(rows[1]!.cancelled_at.toISOString()).toBe('2026-11-01T02:00:00.000Z')
  expect(rows[2]).toMatchObject({ prep_status: 'ready', payment_status: 'paid' })
  expect(rows[0]!.received_at.toISOString()).toBe(api.now().toISOString())

  const pays = await db.sql`select order_id, status, id from payments where order_id = any(${[done.id, voided.id, serving.id]}::uuid[])`
  expect(pays.find((p) => p.order_id === voided.id)).toMatchObject({ status: 'refunded', id: voided.payment.id })
  expect(pays.find((p) => p.order_id === done.id)!.status).toBe('recorded')
  const [line] = await db.sql`select * from order_lines where order_id = ${done.id}`
  expect(line).toMatchObject({ item_id: null, variant_id: null, variant_label: 'Medium', item_name: 'Latte' })
  const [opt] = await db.sql`select * from order_line_options where line_id = ${line!.id}`
  expect(opt).toMatchObject({ option_id: null, group_name: '', option_name: 'Oat milk' })

  const after = await counts()
  expect(after.orders! - before!.orders!).toBe(3)
  expect(after.events).toBe(before!.events) // no order_events rows

  // Run twice: nothing changes.
  expect(await importOk(token, chunk)).toEqual({ inserted: 0, existing: 5, skipped: 0 })
  expect(await counts()).toEqual(after)
})

test('an open legacy shift while the device has another open shift is existing; its orders import without a shift', async () => {
  const { token } = await seedDevice(db.sql)
  await api.push(token, [shiftOpened()])
  const open = shift({ closedAt: null, countedCentavos: null, expectedCentavos: null })
  const o = order(open.id)
  const res = await importOk(token, { shifts: [open], orders: [o], cashMoves: [] })
  expect(res).toEqual({ inserted: 1, existing: 1, skipped: 0 })
  const [row] = await db.sql`select shift_id from orders where id = ${o.id}`
  expect(row!.shift_id).toBeNull()
})

test('a cash move for an unknown shift is skipped; the rest is inserted', async () => {
  const { token } = await seedDevice(db.sql)
  const s = shift()
  const res = await importOk(token, {
    shifts: [s],
    orders: [],
    cashMoves: [
      { id: randomUUID(), shiftId: randomUUID(), kind: 'out', amountCentavos: 100, reason: 'Ice', at: '2026-11-01T03:00:00.000Z', staffId: null },
      { id: randomUUID(), shiftId: s.id, kind: 'out', amountCentavos: 100, reason: 'Ice', at: '2026-11-01T03:00:00.000Z', staffId: randomUUID() },
    ],
  })
  expect(res).toEqual({ inserted: 2, existing: 0, skipped: 1 })
  const [m] = await db.sql`select staff_id from cash_moves where shift_id = ${s.id}`
  expect(m!.staff_id).toBeNull() // unknown staff → null
})

test('an order that breaks the orders table checks is skipped, not a failed chunk', async () => {
  const { token } = await seedDevice(db.sql)
  const s = shift()
  const bad = order(s.id, { totalCentavos: 99999 })
  const good = order(s.id, { ticketNumber: 2 })
  const res = await importOk(token, { shifts: [s], orders: [bad, good], cashMoves: [] })
  expect(res).toEqual({ inserted: 2, existing: 0, skipped: 1 })
  const rows = await db.sql`select 1 from orders where id = ${bad.id}`
  expect(rows).toHaveLength(0)
  const lines = await db.sql`select 1 from order_lines where order_id = ${bad.id}`
  expect(lines).toHaveLength(0)
})

test('an order whose shift is unknown imports with a null shift', async () => {
  const { token } = await seedDevice(db.sql)
  const o = order(randomUUID())
  expect(await importOk(token, { shifts: [], orders: [o], cashMoves: [] })).toEqual({ inserted: 1, existing: 0, skipped: 0 })
  const [row] = await db.sql`select shift_id from orders where id = ${o.id}`
  expect(row!.shift_id).toBeNull()
})

test('101 rows → 400; malformed, NUL text → 400 INVALID; revoked and anonymous → 401', async () => {
  const { token, deviceId } = await seedDevice(db.sql)
  const many = Array.from({ length: 101 }, () => shift())
  const tooMany = await post(token, { shifts: many, orders: [], cashMoves: [] })
  expect(tooMany.status).toBe(400)
  expect(await tooMany.json()).toMatchObject({ code: 'INVALID' })
  expect((await post(token, { shifts: [] })).status).toBe(400)
  expect((await post(token, { shifts: [shift({ note: 'a\u0000b' })], orders: [], cashMoves: [] })).status).toBe(400)
  expect((await post(null, { shifts: [], orders: [], cashMoves: [] })).status).toBe(401)
  await db.sql`update devices set revoked_at = now(), token_hash = null where id = ${deviceId}`
  const revoked = await post(token, { shifts: [], orders: [], cashMoves: [] })
  expect(revoked.status).toBe(401)
})

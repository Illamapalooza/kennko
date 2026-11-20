import { randomUUID } from 'node:crypto'
import type { DayReport } from '@kennko/core'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { startTestDb, type TestDb } from './pg.js'
import { orderCreated, publishTwoVersions, seedDevice, seedStaff, shiftClosed, shiftOpened, syncApp, type TwoVersions } from './sync-helpers.js'

const NOW = new Date('2026-11-21T02:00:00Z')

let db: TestDb
let api: ReturnType<typeof syncApp>
let menu: TwoVersions
let ownerLogin: string
let managerLogin: string
let baristaLogin: string
let wTicket = 500

const loginOf = async (staffId: string) => {
  const [r] = await db.sql<{ user_id: string }[]>`select user_id from staff where id = ${staffId}`
  return r!.user_id
}

beforeAll(async () => {
  db = await startTestDb()
  // A staff token here is the login's user id.
  api = syncApp(db.sql, NOW, { verifyUser: async (token) => ({ userId: token }) })
  menu = await publishTwoVersions(db.sql)
  ownerLogin = await loginOf(await seedStaff(db.sql, { fullName: 'Olive', role: 'owner' }))
  managerLogin = await loginOf(await seedStaff(db.sql, { fullName: 'Mia', role: 'manager' }))
  baristaLogin = await loginOf(await seedStaff(db.sql, { fullName: 'Bea', role: 'barista' }))
})
afterAll(async () => {
  await db.stop()
})

async function call(method: string, path: string, token: string | null = managerLogin, body?: unknown) {
  const res = await api.app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Record<string, unknown> }
}

async function report(date: string): Promise<DayReport> {
  const r = await call('GET', `/v1/reports/day/${date}`)
  expect(r.status, JSON.stringify(r.body)).toBe(200)
  return r.body as unknown as DayReport
}

/** The day's sales, cash and GCash summed straight from the tables, apart from the report's code. */
async function independent(date: string) {
  const [row] = await db.sql<{ orders: number; total: number; cash: number; gcash: number }[]>`
    select
      (select count(*)::int from orders where business_day = ${date} and prep_status <> 'cancelled' and payment_status = 'paid') as orders,
      (select coalesce(sum(total_centavos), 0)::int from orders
        where business_day = ${date} and prep_status <> 'cancelled' and payment_status = 'paid') as total,
      (select coalesce(sum(p.amount_centavos), 0)::int from payments p join orders o on o.id = p.order_id
        where o.business_day = ${date} and o.prep_status <> 'cancelled' and o.payment_status = 'paid'
          and p.status in ('recorded', 'verified') and p.method = 'cash') as cash,
      (select coalesce(sum(p.amount_centavos), 0)::int from payments p join orders o on o.id = p.order_id
        where o.business_day = ${date} and o.prep_status <> 'cancelled' and o.payment_status = 'paid'
          and p.status in ('recorded', 'verified') and p.method = 'gcash') as gcash`
  return row!
}

async function expectAddsUp(r: DayReport) {
  const sums = await independent(r.date)
  expect(r.sales.orders).toBe(sums.orders)
  expect(r.sales.totalCentavos).toBe(sums.total)
  expect(r.payments).toEqual({ cashCentavos: sums.cash, gcashCentavos: sums.gcash })
  expect(r.sales.counter.totalCentavos + r.sales.online.totalCentavos).toBe(r.sales.totalCentavos)
  expect(r.payments.cashCentavos + r.payments.gcashCentavos).toBe(r.sales.totalCentavos)
}

/** A paid online pickup with its verified GCash payment, inserted as the website would leave it. */
async function onlineOrder(day: string, total: number, over: { prep?: string; payment?: string; paymentRow?: string } = {}) {
  wTicket += 1
  const at = `${day}T02:00:00.000Z`
  const [o] = await db.sql<{ id: string }[]>`
    insert into orders (channel, order_code, fulfilment, prep_status, payment_status, business_day,
      ticket_series, ticket_number, customer_name, customer_phone, customer_email, fulfil_at,
      subtotal_centavos, total_centavos, created_at, updated_at)
    values ('online', ${`KNK-R${wTicket}`}, 'pickup', ${over.prep ?? 'placed'}, ${over.payment ?? 'paid'}, ${day}, 'W', ${wTicket},
      'Ana', '09170000000', 'a@x.test', ${at}, ${total}, ${total}, ${at}, ${at})
    returning id`
  await db.sql`insert into payments (order_id, method, amount_centavos, reference, status)
    values (${o!.id}, 'gcash', ${total}, ${`REF${wTicket}`}, ${over.paymentRow ?? 'verified'})`
  return o!.id
}

/** A clean sale at v1 prices (latte M + oat, ₱140), paid cash. */
const sale = (shiftId: string, businessDay: string, ticketNumber: number, occurredAt: string) =>
  orderCreated(
    {
      shiftId,
      businessDay,
      ticketNumber,
      menuVersion: menu.v1,
      lines: [
        {
          menuItemId: menu.latteId,
          name: 'Latte',
          size: 'M',
          basePriceCentavos: 12000,
          modifiers: [{ id: menu.oatId, name: 'Oat milk', priceCentavos: 2000 }],
          quantity: 1,
          iceLevel: 'regular',
          iceServe: 'mixed',
          note: '',
          lineTotalCentavos: 14000,
        },
      ],
    },
    { occurredAt },
  )

describe('the day report adds up', () => {
  test('a sale held shift_unknown that applies after its shift closed counts on its day, with lateSales 1', async () => {
    const day = '2026-11-21'
    const tillA = await seedDevice(db.sql, 'Till A')
    const tillB = await seedDevice(db.sql, 'Till B')
    const shiftId = randomUUID()
    const late = sale(shiftId, day, 1, '2026-11-21T01:10:00.000Z')
    api.setNow(new Date('2026-11-21T01:11:00Z'))
    expect((await api.push(tillA.token, [late])).results[0]).toMatchObject({ result: 'held', reason: 'shift_unknown' })

    // The shift reaches the server through the other till, opened and closed, before the sale applies.
    api.setNow(new Date('2026-11-21T09:05:00Z'))
    const pushed = await api.push(tillB.token, [
      shiftOpened({ shiftId, openingFloatCentavos: 100000 }, { occurredAt: '2026-11-21T01:00:00.000Z' }),
      shiftClosed({ shiftId, countedCentavos: 114000, expectedCentavos: 114000 }, { occurredAt: '2026-11-21T09:00:00.000Z' }),
    ])
    expect(pushed.results.map((r) => r.result)).toEqual(['applied', 'applied'])
    api.setNow(new Date('2026-11-21T09:30:00Z'))
    expect((await call('POST', `/v1/attention/devices/${tillA.deviceId}/retry`, ownerLogin)).body).toEqual({ held: 0 })

    const r = await report(day)
    await expectAddsUp(r)
    expect(r.sales.counter.byTill).toContainEqual({ deviceName: 'Till A', orders: 1, totalCentavos: 14000, firstTicket: 'C1', lastTicket: 'C1' })
    expect(r.shifts.find((s) => s.id === shiftId)).toMatchObject({
      deviceName: 'Till B',
      cashSalesCentavos: 14000,
      expectedCentavos: 114000,
      countedCentavos: 114000,
      overShortCentavos: 0,
      lateSales: 1,
    })
  })

  test('a held invalid sale and a set-aside one are listed with the ticket and total they carried, outside the sales', async () => {
    const day = '2026-11-23'
    api.setNow(new Date('2026-11-23T02:00:00Z'))
    const till = await seedDevice(db.sql, 'Till C')
    const open = shiftOpened({}, { occurredAt: '2026-11-23T00:00:00.000Z' })
    const good = sale(open.payload.shiftId, day, 1, '2026-11-23T00:10:00.000Z')
    // The total does not follow from the lines: held as invalid.
    const bad = { ...sale(open.payload.shiftId, day, 2, '2026-11-23T00:20:00.000Z') }
    bad.payload = { ...bad.payload, totalCentavos: 13000 }
    // Its shift never reaches the server: held, then set aside by the owner.
    const orphan = sale(randomUUID(), day, 3, '2026-11-23T00:30:00.000Z')
    const res = await api.push(till.token, [open, good, bad, orphan])
    expect(res.results.map((r) => r.result)).toEqual(['applied', 'applied', 'held', 'held'])
    expect(res.results[2]!.reason).toMatch(/^invalid/)
    const discard = await call('POST', `/v1/attention/events/${till.deviceId}/${orphan.id}`, ownerLogin, { action: 'discard', note: 'Test sale' })
    expect(discard.status).toBe(200)

    const r = await report(day)
    await expectAddsUp(r)
    expect(r.sales).toMatchObject({ orders: 1, totalCentavos: 14000 })
    expect(r.held.held).toEqual({ count: 1, totalCentavos: 13000 })
    expect(r.held.setAside).toEqual({ count: 1, totalCentavos: 14000 })
    expect(r.held.rows).toEqual(
      expect.arrayContaining([
        { deviceName: 'Till C', eventId: bad.id, result: 'held', reason: res.results[2]!.reason, ticketNumber: 2, totalCentavos: 13000, note: null },
        { deviceName: 'Till C', eventId: orphan.id, result: 'discarded', reason: 'shift_unknown', ticketNumber: 3, totalCentavos: 14000, note: 'Test sale' },
      ]),
    )
    expect(r.held.rows).toHaveLength(2)
  })

  test("an online order on the next business day is not counted; voids, refunds and pending payments are apart", async () => {
    const day = '2026-11-25'
    await onlineOrder(day, 30000)
    await onlineOrder(day, 18000, { prep: 'cancelled', payment: 'refunded', paymentRow: 'refunded' })
    await onlineOrder(day, 9000, { prep: 'cancelled', payment: 'rejected', paymentRow: 'rejected' })
    await onlineOrder(day, 7500, { payment: 'pending_verification', paymentRow: 'pending_verification' })
    await onlineOrder('2026-11-26', 45000)

    const r = await report(day)
    await expectAddsUp(r)
    expect(r.sales).toMatchObject({ orders: 1, totalCentavos: 30000, online: { orders: 1, totalCentavos: 30000, pickup: 1, delivery: 0 } })
    expect(r.payments).toEqual({ cashCentavos: 0, gcashCentavos: 30000 })
    expect(r.cancelled.onlineRefunded).toEqual({ orders: 1, totalCentavos: 18000 })
    expect(r.cancelled.onlineRejected).toEqual({ orders: 1, totalCentavos: 9000 })
    expect(r.awaitingVerification).toEqual({ orders: 1, totalCentavos: 7500 })

    const next = await report('2026-11-26')
    await expectAddsUp(next)
    expect(next.sales.totalCentavos).toBe(45000)
  })

  test("a shift opened 23:30 Manila keeps its 00:10 sale under the shift; the sale counts on the next day", async () => {
    const till = await seedDevice(db.sql, 'Till D')
    const open = shiftOpened({ openingFloatCentavos: 50000 }, { occurredAt: '2026-11-27T15:30:00.000Z' })
    const midnight = sale(open.payload.shiftId, '2026-11-28', 1, '2026-11-27T16:10:00.000Z')
    // Close is computed from the drawer: float ₱500 + ₱140.
    const close = shiftClosed({ shiftId: open.payload.shiftId, countedCentavos: 64000, expectedCentavos: 64000 }, { occurredAt: '2026-11-27T17:00:00.000Z' })
    // Sent together after the close, as an offline till would: the sale is not late.
    api.setNow(new Date('2026-11-27T17:05:00Z'))
    expect((await api.push(till.token, [open, midnight, close])).results.map((r) => r.result)).toEqual(['applied', 'applied', 'applied'])

    const shiftDay = await report('2026-11-27')
    await expectAddsUp(shiftDay)
    expect(shiftDay.sales.orders).toBe(0)
    expect(shiftDay.shifts).toEqual([
      expect.objectContaining({ id: open.payload.shiftId, deviceName: 'Till D', cashSalesCentavos: 14000, expectedCentavos: 64000, overShortCentavos: 0, lateSales: 0 }),
    ])

    const saleDay = await report('2026-11-28')
    await expectAddsUp(saleDay)
    expect(saleDay.sales).toMatchObject({ orders: 1, totalCentavos: 14000 })
    expect(saleDay.items).toEqual([{ name: 'Latte', variant: 'Medium', quantity: 1, totalCentavos: 14000 }])
    expect(saleDay.shifts).toEqual([])
  })
})

describe('who may read it', () => {
  test('a manager and the owner get 200; a barista with a login gets 403; no token gets 401', async () => {
    expect((await call('GET', '/v1/reports/day/2026-11-21', managerLogin)).status).toBe(200)
    expect((await call('GET', '/v1/reports/day/2026-11-21', ownerLogin)).status).toBe(200)
    expect((await call('GET', '/v1/reports/day/2026-11-21', baristaLogin)).status).toBe(403)
    expect((await call('GET', '/v1/reports/day/2026-11-21', null)).status).toBe(401)
  })
})

describe('dates', () => {
  test.each(['2026-02-30', '2026-11-21x', '2026-1-21', '20261121', '2026-13-01'])('%s is 400 INVALID', async (date) => {
    const r = await call('GET', `/v1/reports/day/${date}`)
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('INVALID')
  })

  test('a day with nothing on it is all zeros', async () => {
    const r = await report('2030-01-01')
    expect(r.sales.orders).toBe(0)
    expect(r.shifts).toEqual([])
    expect(r.held.rows).toEqual([])
  })
})

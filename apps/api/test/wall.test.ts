import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/create-app.js'
import type { PublicWallSnapshot } from '../src/wall/read.js'
import { fakeAuthAdmin, fakeProofs, inlineDefer } from './fakes.js'
import { startTestDb, type TestDb } from './pg.js'
import { seedDevice, seedStaff } from './sync-helpers.js'

const NOW = new Date('2026-11-22T02:00:00Z')
let db: TestDb
let app: ReturnType<typeof createApp>

beforeAll(async () => {
  db = await startTestDb()
  app = createApp({
    sql: db.sql,
    verifyUser: async () => ({ userId: 'unused' }),
    proofs: fakeProofs(),
    authAdmin: fakeAuthAdmin(),
    now: () => NOW,
    push: null,
    defer: inlineDefer,
    webKey: null,
  })
})

afterAll(async () => {
  await db.stop()
})

describe('GET /v1/wall', () => {
  it('returns baristas=0 when closed, then baristas=2 and safe order/visitor fields when open', async () => {
    const closedRes = await app.request('/v1/wall')
    expect(closedRes.status).toBe(200)
    expect(await closedRes.json()).toEqual({
      now: NOW.getTime(),
      baristas: 0,
      openNow: true,
      isOpen: true,
      closingTime: '23:00',
      orders: [],
      visitors: [],
    })

    const staffId = await seedStaff(db.sql, { fullName: 'Olive', role: 'owner' })
    const dev = await seedDevice(db.sql, 'Counter tablet')
    await db.sql`
      insert into shifts (id, device_id, opened_at, opened_by_staff, opening_float_centavos, received_at, updated_at)
      values (${randomUUID()}, ${dev.deviceId}, ${NOW}, ${staffId}, 0, ${NOW}, ${NOW})`

    const paidId = randomUUID()
    await db.sql`
      insert into orders (
        id, channel, order_code, fulfilment, fulfil_at, prep_status, payment_status, business_day, ticket_series, ticket_number,
        customer_name, customer_email, customer_phone, subtotal_centavos, discount_centavos, delivery_fee_centavos, total_centavos,
        created_at, updated_at
      ) values (
        ${paidId}, 'online', 'KNK-WALL01', 'pickup', ${NOW}, 'preparing', 'paid', '2026-11-22', 'W', 7,
        'Secret Full Name', 'secret@x.test', '09171234567', 12000, 0, 0, 12000, ${NOW}, ${NOW}
      )`
    await db.sql`
      insert into order_lines (id, order_id, item_name, variant_code, variant_label, quantity, unit_price_centavos, line_total_centavos)
      values (${randomUUID()}, ${paidId}, 'Spanish Latte', 'M', 'Medium', 2, 12000, 24000)`

    const unpaidId = randomUUID()
    await db.sql`
      insert into orders (
        id, channel, order_code, fulfilment, fulfil_at, prep_status, payment_status, business_day, ticket_series, ticket_number,
        customer_name, customer_email, customer_phone, subtotal_centavos, discount_centavos, delivery_fee_centavos, total_centavos, created_at, updated_at
      ) values (
        ${unpaidId}, 'online', 'KNK-WALL02', 'pickup', ${NOW}, 'placed', 'pending_verification', '2026-11-22', 'W', 8,
        'Unpaid Person', 'unpaid@x.test', '09170000000', 12000, 0, 0, 12000, ${NOW}, ${NOW}
      )`

    const res = await app.request('/v1/wall')
    expect(res.status).toBe(200)
    const body = (await res.json()) as PublicWallSnapshot
    expect(body.baristas).toBe(2)
    expect(body.orders).toHaveLength(1)
    expect(body.orders[0]).toMatchObject({
      number: 7,
      series: 'W',
      label: 'W7',
      name: '',
      status: 'preparing',
      items: [{ name: 'Spanish Latte', qty: 2 }],
    })
    const text = JSON.stringify(body)
    expect(text).not.toContain('Secret Full Name')
    expect(text).not.toContain('secret@x.test')
    expect(text).not.toContain('09171234567')
    expect(text).not.toContain('Unpaid Person')
  })
})

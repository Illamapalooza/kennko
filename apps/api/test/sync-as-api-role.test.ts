import { randomInt, randomUUID } from 'node:crypto'
import { formatPublicCode, makePublicCode, wallCode, wallMinute, type CounterOrderPayload, type ImportOrder, type ImportShift, type PushResponse } from '@kennko/core'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import type { Hono } from 'hono'
import type postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { verifierFromJwks, type AppEnv } from '../src/auth.js'
import { createApp } from '../src/create-app.js'
import { addStamp, claimFreeDrink, removeOrderStamp, unclaim } from '../src/loyalty/cards.js'
import { cardSummary, customerByCode, tillCustomer } from '../src/loyalty/customers.js'
import { adjustPoints, balance, creditOrderPoints, dropOrderPoints, reverseOrderPoints } from '../src/loyalty/points.js'
import { publishMenu } from '../src/menu/snapshot.js'
import type { PushSender } from '../src/push/send.js'
import { fakeAuthAdmin, fakeProofs, inlineDefer } from './fakes.js'
import { startTestDb, type TestDb } from './pg.js'
import {
  availability,
  cashMoved,
  customerLinked,
  customerUnlinked,
  orderCancelled,
  orderCreated,
  prepStatus,
  rewardUsed,
  shiftClosed,
  shiftOpened,
  stampAdded,
} from './sync-helpers.js'

/**
 * Production connects as `kennko_api` (no superuser, RLS on), while the other tests run as the
 * PGlite superuser and so cannot see a missing grant or policy. Here every seed runs as superuser,
 * then the app's own queries run with `set role kennko_api` on the one session the app uses.
 */
const ISSUER = 'http://supabase.test/auth/v1'
const OWNER = '00000000-0000-4000-8000-0000000000a1'
const BARISTA = '00000000-0000-4000-8000-0000000000a2'
const MANAGER_LOGIN = '00000000-0000-4000-8000-0000000000a3'
const CUSTOMER = '00000000-0000-4000-8000-0000000000a4'
const NOW = new Date('2026-11-21T02:00:00Z')
const WEB_KEY = 'w'.repeat(48)

describe('every route as kennko_api', () => {
  let db: TestDb
  let app: Hono<AppEnv>
  let ownerJwt: string
  let baristaJwt: string
  let customerJwt: string
  let signFor: (sub: string) => Promise<string>
  let latteId: string
  let oatId: string
  let version: number
  let deviceToken: string
  let deviceId: string
  let readPaymentId: string
  const auth = fakeAuthAdmin({ [CUSTOMER]: { email: 'cy@x.test', emailConfirmed: true, createdAt: '2026-11-01T00:00:00Z' } })
  const pushed: string[] = []
  const sender: PushSender = async (_sub, payload) => {
    pushed.push(payload.title)
    return 'sent'
  }

  /** Runs `fn` as the superuser (seeding and checks), then returns the session to kennko_api. */
  async function asSuper<T>(fn: () => Promise<T>): Promise<T> {
    await db.sql.unsafe('reset role')
    try {
      return await fn()
    } finally {
      await db.sql.unsafe('set role kennko_api')
    }
  }

  beforeAll(async () => {
    db = await startTestDb()
    await db.sql
      .unsafe(
        `insert into auth.users (id, email) values ('${OWNER}', 'o@x.test'), ('${BARISTA}', 'b@x.test'), ('${MANAGER_LOGIN}', 'm@x.test'), ('${CUSTOMER}', 'cy@x.test');
         insert into staff (id, user_id, email, full_name, role, is_active) values
           ('${OWNER}', '${OWNER}', 'o@x.test', 'Owner', 'owner', true),
           ('${BARISTA}', '${BARISTA}', 'b@x.test', 'Barista', 'barista', true);`,
      )
      .simple()
    const [cat] = await db.sql`insert into menu_categories (name, sort_order) values ('Coffee', 0) returning id`
    const [latte] = await db.sql`insert into menu_items (category_id, name) values (${cat!.id}, 'Latte') returning id`
    latteId = latte!.id
    await db.sql`insert into menu_variants (item_id, code, label, price_centavos, temperature)
      values (${latteId}, 'M', 'Medium', 12000, 'iced')`
    const [group] = await db.sql`insert into option_groups (name) values ('Milk of Choice') returning id`
    const [oat] = await db.sql`insert into options (group_id, name, price_centavos) values (${group!.id}, 'Oat milk', 2000) returning id`
    oatId = oat!.id
    await db.sql`insert into item_option_groups (item_id, group_id) values (${latteId}, ${group!.id})`
    await db.sql`insert into delivery_zones (barangay, fee_centavos, latitude, longitude) values ('Libertad', 0, 8.942, 125.529)`

    const pair = await generateKeyPair('ES256')
    const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' }
    const sign = (sub: string) =>
      new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
        .setSubject(sub)
        .setIssuer(ISSUER)
        .setAudience('authenticated')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(pair.privateKey)
    ownerJwt = await sign(OWNER)
    baristaJwt = await sign(BARISTA)
    customerJwt = await sign(CUSTOMER)
    signFor = sign
    app = createApp({
      sql: db.sql,
      verifyUser: verifierFromJwks(createLocalJWKSet({ keys: [jwk] }), ISSUER),
      proofs: fakeProofs(),
      authAdmin: auth,
      push: sender,
      defer: inlineDefer,
      now: () => NOW,
      webKey: WEB_KEY,
    })
    await db.sql.unsafe('set role kennko_api')
  })
  afterAll(async () => {
    await db.stop()
  })

  const call = async (method: string, path: string, auth?: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, text, json: () => JSON.parse(text) as Record<string, unknown> }
  }
  /** Expects `ok` (default 200); the body is in the failure message so a 500 says which grant is missing. */
  const ok = async (method: string, path: string, auth?: string, body?: unknown, status = 200) => {
    const r = await call(method, path, auth, body)
    expect(r.status, `${method} ${path}: ${r.text}`).toBe(status)
    return r.json()
  }
  const push = async (events: unknown[]) => (await ok('POST', '/v1/sync/push', deviceToken, { events })) as unknown as PushResponse

  it('the session really is kennko_api', async () => {
    const [r] = await db.sql`select current_user as u`
    expect(r!.u).toBe('kennko_api')
  })

  it('menu: owner publishes, anyone reads, staff read status', async () => {
    const pub = await ok('POST', '/v1/menu/publish', ownerJwt)
    version = pub.version as number
    expect(version).toBeGreaterThan(0)
    await ok('GET', '/v1/menu')
    await ok('GET', `/v1/menu/${version}`)
    await ok('GET', '/v1/menu/status', baristaJwt)
  })

  it('staff: list, add, rename, issue a PIN, deactivate', async () => {
    await ok('GET', '/v1/staff', ownerJwt)
    const ana = await ok('POST', '/v1/staff', ownerJwt, { fullName: 'Ana', role: 'barista' }, 201)
    await ok('POST', '/v1/staff', ownerJwt, { fullName: 'Mia', role: 'manager', userId: MANAGER_LOGIN, email: 'm@x.test' }, 201)
    await ok('PATCH', `/v1/staff/${ana.id as string}`, ownerJwt, { fullName: 'Ana Cruz' })
    const pin = await ok('POST', `/v1/staff/${ana.id as string}/pin`, ownerJwt, undefined, 201)
    expect(pin.pin).toMatch(/^\d{6}$/)
    const temp = await ok('POST', '/v1/staff', ownerJwt, { fullName: 'Temp', role: 'barista' }, 201)
    await ok('PATCH', `/v1/staff/${temp.id as string}`, ownerJwt, { isActive: false })
  })

  it('devices: add, list, pair, me, revoke a spare one', async () => {
    const added = await ok('POST', '/v1/devices', ownerJwt, { name: 'Front till' }, 201)
    await ok('GET', '/v1/devices', ownerJwt)
    const paired = await ok('POST', '/v1/devices/pair', undefined, { code: added.code })
    deviceToken = paired.token as string
    deviceId = added.id as string
    expect(deviceToken).toBeTruthy()
    await ok('GET', '/v1/devices/me', deviceToken)
    const spare = await ok('POST', '/v1/devices', ownerJwt, { name: 'Spare' }, 201)
    const del = await call('DELETE', `/v1/devices/${spare.id as string}`, ownerJwt)
    expect([200, 204], del.text).toContain(del.status)
  })

  it('sync push: shift, cash, order, prep, cancel, sold-out, close; then a held retry', async () => {
    const open = shiftOpened({}, { staffId: BARISTA })
    const priced: Partial<CounterOrderPayload> = {
      menuVersion: version,
      lines: [
        {
          menuItemId: latteId,
          name: 'Latte',
          size: 'M',
          basePriceCentavos: 12000,
          modifiers: [{ id: oatId, name: 'Oat milk', priceCentavos: 2000 }],
          quantity: 1,
          iceLevel: 'regular',
          iceServe: 'mixed',
          note: '',
          lineTotalCentavos: 14000,
        },
      ],
    }
    const order = orderCreated({ shiftId: open.payload.shiftId, ...priced }, { staffId: BARISTA })
    const second = orderCreated({ shiftId: open.payload.shiftId, ticketNumber: 2, ...priced })
    const events = [
      open,
      cashMoved({ shiftId: open.payload.shiftId }, { staffId: BARISTA }),
      order,
      second,
      prepStatus({ orderId: order.payload.orderId, to: 'preparing' }, { staffId: BARISTA }),
      orderCancelled({ orderId: second.payload.orderId }, { staffId: OWNER }),
      availability({ itemId: latteId, available: false }, { staffId: BARISTA }),
    ]
    const res = await push(events)
    expect(res.results.map((r) => [r.result, r.reason])).toEqual(events.map(() => ['applied', null]))

    // A prep step for an order this till has not sent yet is held, then applies on the next push.
    const later = orderCreated({ shiftId: open.payload.shiftId, ticketNumber: 3, ...priced })
    const early = prepStatus({ orderId: later.payload.orderId, to: 'preparing' })
    expect((await push([early])).results[0]!.result).toBe('held')
    expect((await push([later])).results[0]!.result).toBe('applied')
    const held = await asSuper(() => db.sql`select result from sync_events where id = ${early.id}`)
    expect(held[0]!.result).toBe('applied')

    const close = shiftClosed({ shiftId: open.payload.shiftId })
    expect((await push([close])).results[0]!.result).toBe('applied')
  })

  it('sync pull', async () => {
    const pulled = await ok('GET', '/v1/sync/pull?version=0', deviceToken)
    expect(pulled).toBeTruthy()
  })

  it('sync pull: paid online orders with lines and options are readable as kennko_api', async () => {
    const orderId = await asSuper(async () => {
      const [o] = await db.sql`
        insert into orders (channel, order_code, fulfilment, prep_status, payment_status, business_day,
          ticket_series, ticket_number, customer_name, customer_phone, customer_email, fulfil_at,
          subtotal_centavos, total_centavos, created_at, updated_at)
        values ('online', 'KNK-ROLE', 'pickup', 'placed', 'paid', '2026-11-21', 'W', 901, 'Ana', '09170000000',
          'a@x.test', ${NOW.toISOString()}, 14000, 14000, ${NOW.toISOString()}, ${NOW.toISOString()})
        returning id`
      const [l] = await db.sql`
        insert into order_lines (order_id, item_id, item_name, variant_code, variant_label, unit_price_centavos,
          quantity, line_total_centavos, ice_level, ice_serve)
        values (${o!.id}, ${latteId}, 'Latte', 'M', 'Medium', 12000, 1, 14000, 'regular', 'mixed') returning id`
      await db.sql`insert into order_line_options (line_id, group_name, option_name, price_centavos) values (${l!.id}, 'Milk of Choice', 'Oat milk', 2000)`
      return o!.id as string
    })
    const pulled = await ok('GET', '/v1/sync/pull?version=0', deviceToken)
    const online = pulled.onlineOrders as { id: string; lines: { name: string; options: string[] }[] }[]
    const mine = online.find((o) => o.id === orderId)
    expect(mine?.lines).toMatchObject([{ name: 'Latte', options: ['Oat milk'] }])
  })

  it('sync push: an online prep step moves the order and notifies the customer as kennko_api', async () => {
    const orderId = await asSuper(async () => {
      const [o] = await db.sql`
        insert into orders (channel, order_code, fulfilment, prep_status, payment_status, business_day,
          ticket_series, ticket_number, customer_name, customer_phone, customer_email, fulfil_at,
          subtotal_centavos, total_centavos, created_at, updated_at)
        values ('online', 'KNK-ROLE2', 'pickup', 'placed', 'paid', '2026-11-21', 'W', 902, 'Ana', '09170000000',
          'a@x.test', ${NOW.toISOString()}, 14000, 14000, ${NOW.toISOString()}, ${NOW.toISOString()})
        returning id`
      const [sub] = await db.sql`insert into push_subscriptions (endpoint, p256dh, auth, kind)
        values ('https://push.test/role', 'p', 'a', 'customer') returning id`
      await db.sql`insert into push_order_watch (order_id, subscription_id) values (${o!.id}, ${sub!.id})`
      return o!.id as string
    })
    pushed.length = 0
    const res = await push([prepStatus({ orderId, to: 'preparing' }, { staffId: BARISTA })])
    expect(res.results.map((r) => [r.result, r.reason])).toEqual([['applied', null]])
    expect(pushed).toEqual(['W902 is being prepared'])
    const [row] = await asSuper(
      () => db.sql`select o.prep_status, s.last_used_at from orders o, push_subscriptions s
        where o.id = ${orderId} and s.endpoint = 'https://push.test/role'`,
    )
    expect(row!.prep_status).toBe('preparing')
    expect(row!.last_used_at).not.toBeNull()
  })

  it('sync import: a stored row, a rejected row, and a rerun that clears the receipt', async () => {
    const shift: ImportShift = {
      id: randomUUID(),
      openedAt: '2026-11-01T00:00:00.000Z',
      openingFloatCentavos: 100000,
      closedAt: '2026-11-01T10:00:00.000Z',
      countedCentavos: 150000,
      expectedCentavos: 149000,
      note: 'ok',
      openedByStaff: BARISTA,
      closedByStaff: null,
    }
    const order: ImportOrder = {
      id: randomUUID(),
      shiftId: shift.id,
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
          modifiers: [],
          quantity: 1,
          iceLevel: null,
          iceServe: null,
          note: '',
          lineTotalCentavos: 12000,
        },
      ],
      subtotalCentavos: 12000,
      discountCentavos: 0,
      discountLabel: null,
      totalCentavos: 12000,
      payment: { id: randomUUID(), method: 'cash', tenderedCentavos: 20000, changeCentavos: 8000, reference: null },
      createdAt: '2026-11-01T01:00:00.000Z',
      voidedAt: null,
      voidReason: null,
      cancelledByStaff: null,
    }
    // The cash move names a shift that is not stored yet: rejected and kept as a held receipt.
    const orphanShift = { ...shift, id: randomUUID() }
    const move = { id: randomUUID(), shiftId: orphanShift.id, kind: 'in', amountCentavos: 5000, reason: 'Change', at: '2026-11-02T01:00:00.000Z', staffId: null }
    const bad = { ...order, id: randomUUID(), payment: { ...order.payment, id: randomUUID() }, ticketNumber: 0 }

    const first = await ok('POST', '/v1/sync/import', deviceToken, { shifts: [shift], orders: [order, bad], cashMoves: [move] })
    expect(first).toEqual({ inserted: 2, existing: 0, rejected: 2 })

    // Rerun with the missing shift: the cash move stores and its receipt is closed, not deleted.
    const rerun = await ok('POST', '/v1/sync/import', deviceToken, { shifts: [shift, orphanShift], orders: [order], cashMoves: [move] })
    expect(rerun).toEqual({ inserted: 2, existing: 2, rejected: 0 })
    const receipt = await asSuper(() => db.sql`select result, reason, applied_at from sync_events where device_id = ${deviceId} and id = ${move.id}`)
    expect(receipt[0]).toMatchObject({ result: 'applied', reason: 'legacy: stored on a later send' })
    expect(receipt[0]!.applied_at).not.toBeNull()
  })

  it('online orders: create, verify, prep steps, reject and cancel', async () => {
    const fd = new FormData()
    fd.set(
      'order',
      JSON.stringify({
        name: 'Ana Cruz',
        email: 'ana@x.test',
        phone: '09171234567',
        fulfilment: 'pickup',
        address: '',
        barangay: '',
        fulfilAt: '2026-11-21T04:00:00.000Z',
        gcashReference: 'abc123456',
        note: '',
        lines: [{ menuItemId: latteId, size: 'M', quantity: 1, modifierIds: [], iceLevel: 'regular', iceServe: 'mixed', note: '' }],
        claimedTotalCentavos: 12000,
      }),
    )
    const proof = new Uint8Array(64)
    proof.set([0xff, 0xd8, 0xff, 0xe0])
    fd.set('proof', new File([proof], 'proof.jpg', { type: 'image/jpeg' }))
    // Sold out from the till earlier: put it back first so the website can sell it.
    await asSuper(() => db.sql`update menu_items set is_available = true where id = ${latteId}`)
    const created = await app.request('/v1/orders', { method: 'POST', body: fd })
    const createdText = await created.text()
    expect(created.status, createdText).toBe(201)
    const orderId = (JSON.parse(createdText) as { orderId: string }).orderId
    const [pay] = await asSuper(() => db.sql`select id from payments where order_id = ${orderId}`)
    await ok('POST', `/v1/payments/${pay!.id as string}/verify`, baristaJwt)
    await ok('PATCH', `/v1/orders/${orderId}`, baristaJwt, { prepStatus: 'preparing' })
    await ok('PATCH', `/v1/orders/${orderId}`, baristaJwt, { staffNote: 'regular' })
    await ok('POST', `/v1/orders/${orderId}/cancel`, ownerJwt, { reason: 'out of beans' })

    // A second order whose payment is rejected.
    const fd2 = new FormData()
    for (const [k, v] of fd.entries()) fd2.set(k, v)
    const again = await app.request('/v1/orders', { method: 'POST', body: fd2 })
    const againText = await again.text()
    expect(again.status, againText).toBe(201)
    const id2 = (JSON.parse(againText) as { orderId: string }).orderId
    const [pay2] = await asSuper(() => db.sql`select id from payments where order_id = ${id2}`)
    await ok('POST', `/v1/payments/${pay2!.id as string}/reject`, baristaJwt, { reason: 'wrong amount' })
  })

  it('needs a look: list, count, discard, close a stuck shift, retry, order seen as kennko_api', async () => {
    const s1 = shiftOpened({}, { staffId: BARISTA })
    expect((await push([s1])).results[0]!.result).toBe('applied')
    // A second shift on the same till waits behind the first, and so does its sale.
    const s2 = shiftOpened()
    const waiting = orderCreated({ shiftId: s2.payload.shiftId, ticketNumber: 40, menuVersion: null })
    const typo = prepStatus({ orderId: waiting.payload.orderId, to: 'brewing' as 'ready' })
    const held = await push([s2, waiting, typo])
    expect(held.results.map((r) => r.result)).toEqual(['held', 'held', 'held'])

    const view = await ok('GET', '/v1/attention', ownerJwt)
    expect((view.shifts as { id: string; blocking: number }[])[0]).toMatchObject({ id: s1.payload.shiftId, blocking: 1 })
    await ok('GET', '/v1/attention?show=resolved', ownerJwt)
    expect((await ok('GET', '/v1/attention/count', ownerJwt)).count).toBeGreaterThan(0)

    await ok('POST', `/v1/attention/events/${deviceId}/${typo.id}`, ownerJwt, { action: 'discard', note: 'Typo on the till' })
    await ok('POST', `/v1/attention/shifts/${s1.payload.shiftId}/close`, ownerJwt, { countedCentavos: 0, note: 'pos.db replaced' })
    expect(await ok('POST', `/v1/attention/devices/${deviceId}/retry`, ownerJwt)).toEqual({ held: 0 })

    const rows = await asSuper(
      () => db.sql`select id, result from sync_events where device_id = ${deviceId} and id in ${db.sql([s2.id, waiting.id, typo.id])}`,
    )
    expect(Object.fromEntries(rows.map((r) => [r.id, r.result]))).toEqual({ [s2.id]: 'applied', [waiting.id]: 'flagged', [typo.id]: 'discarded' })

    // The sale was rung with no menu version: a flagged order the owner marks seen.
    await ok('POST', `/v1/attention/orders/${waiting.payload.orderId}/seen`, ownerJwt)
    const [order] = await asSuper(() => db.sql`select flags, flags_seen_by from orders where id = ${waiting.payload.orderId}`)
    expect(order).toMatchObject({ flags: ['unknown_version'], flags_seen_by: OWNER })
    expect((await call('GET', '/v1/attention', baristaJwt)).status).toBe(403)
  })

  it('day report: owner reads 2026-11-21 as kennko_api, with the seeded totals', async () => {
    const r = await ok('GET', '/v1/reports/day/2026-11-21', ownerJwt)
    const [sums] = await asSuper(
      () => db.sql`
        select count(*)::int as orders, coalesce(sum(total_centavos), 0)::int as total,
          count(*) filter (where channel = 'counter')::int as counter
        from orders where business_day = '2026-11-21' and prep_status <> 'cancelled' and payment_status = 'paid'`,
    )
    expect(sums!.counter).toBeGreaterThan(0)
    expect(r.sales).toMatchObject({ orders: sums!.orders, totalCentavos: sums!.total, counter: { orders: sums!.counter } })
    const shifts = r.shifts as { cashSalesCentavos: number }[]
    expect(shifts.length).toBeGreaterThan(0)
    expect((r.held as { rows: unknown[] }).rows).toEqual([])
    expect((await call('GET', '/v1/reports/day/2026-11-21', baristaJwt)).status).toBe(403)
  })

  it('order page, receipt and customer history as kennko_api', async () => {
    await asSuper(async () => {
      const at = NOW.toISOString()
      const [own] = await db.sql`
        insert into orders (channel, order_code, fulfilment, prep_status, payment_status, business_day,
          ticket_series, ticket_number, customer_name, customer_phone, customer_email, customer_user_id, fulfil_at,
          subtotal_centavos, total_centavos, created_at, updated_at)
        values ('online', 'KNK-READ1', 'pickup', 'preparing', 'paid', '2026-11-21', 'W', 950, 'Cy', '09170000000',
          'cy@x.test', ${CUSTOMER}, ${at}, 14000, 14000, ${at}, ${at})
        returning id`
      const [line] = await db.sql`
        insert into order_lines (order_id, item_id, item_name, variant_code, variant_label, unit_price_centavos,
          quantity, line_total_centavos, ice_level, ice_serve)
        values (${own!.id}, ${latteId}, 'Latte', 'M', 'Medium', 12000, 1, 14000, 'regular', 'mixed') returning id`
      await db.sql`insert into order_line_options (line_id, group_name, option_name, price_centavos)
        values (${line!.id}, 'Milk of Choice', 'Oat milk', 2000)`
      const [pay] = await db.sql`insert into payments (order_id, method, amount_centavos, reference, proof_path, status, verified_by, verified_at)
        values (${own!.id}, 'gcash', 14000, 'GC-READ1', 'proofs/KNK-READ1/p.jpg', 'verified', ${BARISTA}, ${at}) returning id`
      readPaymentId = pay!.id as string
      // A guest order under the same, confirmed address.
      await db.sql`
        insert into orders (channel, order_code, fulfilment, prep_status, payment_status, business_day,
          ticket_series, ticket_number, customer_name, customer_phone, customer_email, fulfil_at,
          subtotal_centavos, total_centavos, created_at, updated_at)
        values ('online', 'KNK-READ2', 'pickup', 'placed', 'pending_verification', '2026-11-21', 'W', 951, 'Cy',
          '09170000000', 'CY@x.test', ${at}, 12000, 12000, ${at}, ${at})`
    })

    const page = await ok('GET', '/v1/orders/by-code/knk-read1')
    expect(page).toMatchObject({ orderCode: 'KNK-READ1', ticket: 'W950', lines: [{ name: 'Latte' }] })
    const receipt = await ok('GET', '/v1/orders/by-code/KNK-READ1/receipt')
    expect(receipt.order).toMatchObject({ payment: { referenceMasked: '••••EAD1' }, lines: [{ options: [{ name: 'Oat milk' }] }] })
    expect(receipt.shop).toMatchObject({ displayName: expect.any(String) })
    const history = await ok('GET', '/v1/me/orders', customerJwt)
    expect((history.orders as { orderCode: string }[]).map((o) => o.orderCode).sort()).toEqual(['KNK-READ1', 'KNK-READ2'])
  })

  it('proof link, customer-email data, staff alert list and an invite as kennko_api', async () => {
    const proof = await ok('GET', `/v1/payments/${readPaymentId}/proof`, baristaJwt)
    expect(proof.url).toBe('https://storage.test/proofs/KNK-READ1/p.jpg?expires=300')
    const notice = await ok('GET', `/v1/payments/${readPaymentId}/notice`, baristaJwt)
    expect(notice).toMatchObject({ to: 'cy@x.test', orderCode: 'KNK-READ1', reference: 'GC-READ1', items: [{ name: 'Latte' }] })

    const res = await app.request('/v1/staff/alert-emails', { headers: { 'X-Kennko-Web-Key': WEB_KEY } })
    const text = await res.text()
    expect(res.status, text).toBe(200)
    expect((JSON.parse(text) as { emails: string[] }).emails).toContain('o@x.test')

    // GoTrue creates the auth user; here the superuser stands in for it.
    auth.onInvite = (email, id) => asSuper(async () => void (await db.sql`insert into auth.users (id, email) values (${id}, ${email})`))
    const invited = await ok('POST', '/v1/staff', ownerJwt, { fullName: 'Lia', role: 'manager', email: 'lia@x.test' }, 201)
    expect(invited).toMatchObject({ hasLogin: true, email: 'lia@x.test' })
    expect(auth.invited).toEqual(['lia@x.test'])
  })

  it('loyalty module: stamps, repack, claim, unclaim, removal and points as kennko_api', async () => {
    const member = '00000000-0000-4000-8000-0000000000b1'
    const orders = await asSuper(async () => {
      await db.sql`insert into auth.users (id, email) values (${member}, 'member@x.test')`
      await db.sql`insert into customers (id, public_code, display_name, age_confirmed_at, privacy_accepted_at,
          privacy_version, created_at)
        values (${member}, '23456789A', 'Member', ${NOW}, ${NOW}, '2026-11', ${NOW})`
      const ids: string[] = []
      for (let i = 0; i < 9; i++) {
        const [o] = await db.sql`
          insert into orders (channel, order_code, fulfilment, prep_status, payment_status, business_day,
            ticket_series, ticket_number, customer_name, customer_phone, customer_email, fulfil_at,
            subtotal_centavos, total_centavos, created_at, updated_at, customer_id)
          values ('online', ${`KNK-LOY${i}`}, 'pickup', 'completed', 'paid', '2026-11-21', 'W', ${960 + i}, 'M',
            '09170000000', 'member@x.test', ${NOW}, 12000, 12000, ${NOW}, ${NOW}, ${member})
          returning id`
        ids.push(o!.id as string)
      }
      return ids
    })
    const run = <T,>(fn: (tx: postgres.TransactionSql) => Promise<T>) => db.sql.begin(fn) as Promise<T>
    for (const [i, orderId] of orders.entries()) {
      const r = await run((tx) =>
        addStamp(tx, {
          customerId: member,
          stampId: randomUUID(),
          orderId,
          staffId: BARISTA,
          deviceId,
          stampedAt: new Date(NOW.getTime() + i * 1000).toISOString(),
          now: NOW,
        }),
      )
      expect(r).toBe('added')
    }
    expect(await run((tx) => tillCustomer(tx, member))).toMatchObject({ stamps: 1, fullCards: 1, stampMode: 'digital' })
    expect(await run((tx) => customerByCode(tx, '23456789A'))).toMatchObject({ id: member })
    const claimId = randomUUID()
    expect(await run((tx) => claimFreeDrink(tx, { customerId: member, claimId, staffId: BARISTA, deviceId, now: NOW }))).toBe('claimed')
    expect(await run((tx) => removeOrderStamp(tx, orders[0]!, NOW))).toBe('forgiven')
    expect(await run((tx) => unclaim(tx, { claimId }, NOW))).toBe('unclaimed')
    expect(await run((tx) => removeOrderStamp(tx, orders[1]!, NOW))).toBe('removed')

    expect(await run((tx) => creditOrderPoints(tx, orders[2]!, NOW))).toBe(12)
    await run((tx) => adjustPoints(tx, { customerId: member, delta: 3, note: 'Welcome', staffId: OWNER, now: NOW }))
    expect(await run((tx) => reverseOrderPoints(tx, orders[2]!, NOW))).toBe(-12)
    expect(await run((tx) => creditOrderPoints(tx, orders[3]!, NOW))).toBe(12)
    expect(await run((tx) => dropOrderPoints(tx, orders[3]!, member))).toBe(1)
    expect(await run((tx) => balance(tx, member))).toBe(3)
    expect(await run((tx) => cardSummary(tx, member))).toMatchObject({ fullCards: 0 })
  })

  it('sync push: link, stamp, free drink, void, unlink and an admin verify/refund move cards and points as kennko_api', async () => {
    const member = '00000000-0000-4000-8000-0000000000b2'
    const bare = makePublicCode(randomInt)
    const claimId = randomUUID()
    const cardId = await asSuper(async () => {
      await db.sql`insert into auth.users (id, email) values (${member}, 'linked@x.test')`
      await db.sql`insert into customers (id, public_code, display_name, age_confirmed_at, privacy_accepted_at,
          privacy_version, created_at)
        values (${member}, ${bare}, 'Linked', ${NOW}, ${NOW}, '2026-11', ${NOW})`
      // A full card already claimed at the till (Ruling 10), waiting for its sale.
      const [card] = await db.sql`insert into stamp_cards (customer_id, started_at, filled_at, claimed_at, claim_id)
        values (${member}, ${NOW}, ${NOW}, ${NOW}, ${claimId}) returning id`
      return card!.id as string
    })
    const code = formatPublicCode(bare)
    // The shift the needs-a-look case left open on this till.
    const [open] = await asSuper(() => db.sql<{ id: string }[]>`select id from shifts where device_id = ${deviceId} and closed_at is null`)
    const shiftId = open!.id
    const line = {
      menuItemId: latteId,
      name: 'Latte',
      size: 'M' as const,
      basePriceCentavos: 12000,
      modifiers: [{ id: oatId, name: 'Oat milk', priceCentavos: 2000 }],
      quantity: 1,
      iceLevel: 'regular' as const,
      iceServe: 'mixed' as const,
      note: '',
      lineTotalCentavos: 14000,
    }
    const reward = { ...line, basePriceCentavos: 0, lineTotalCentavos: 2000, reward: true as const }
    const free = orderCreated(
      { shiftId, ticketNumber: 50, menuVersion: version, lines: [line, reward],
        subtotalCentavos: 16000, totalCentavos: 16000,
        payment: { id: randomUUID(), method: 'cash', tenderedCentavos: 16000, changeCentavos: 0, reference: null } },
      { staffId: BARISTA },
    )
    const plain = orderCreated({ shiftId, ticketNumber: 51, menuVersion: version, lines: [line] }, { staffId: BARISTA })
    const events = [
      free,
      customerLinked({ orderId: free.payload.orderId, publicCode: code }, { staffId: BARISTA }),
      stampAdded({ orderId: free.payload.orderId }, { staffId: BARISTA }),
      rewardUsed({ claimId, orderId: free.payload.orderId }, { staffId: BARISTA }),
      orderCancelled({ orderId: free.payload.orderId }, { staffId: OWNER }),
      plain,
      customerLinked({ orderId: plain.payload.orderId, publicCode: code }, { staffId: BARISTA }),
      stampAdded({ orderId: plain.payload.orderId }, { staffId: BARISTA }),
      customerUnlinked({ orderId: plain.payload.orderId }, { staffId: BARISTA }),
    ]
    const res = await push(events)
    expect(res.results.map((r) => [r.result, r.reason])).toEqual(events.map(() => ['applied', null]))

    const state = await asSuper(async () => ({
      card: (await db.sql`select claimed_at from stamp_cards where id = ${cardId}`)[0],
      ledger: await db.sql`select delta, reason from points_ledger where customer_id = ${member} order by created_at, reason`,
      stamps: await db.sql`select count(*)::int as n from stamps where customer_id = ${member}`,
      linked: await db.sql`select count(*)::int as n from orders where customer_id = ${member}`,
    }))
    // The void released the claim; the free sale earned 14 and lost them; the unlinked sale left nothing.
    expect(state.card).toBeUndefined()
    expect(state.ledger.map((r) => [r.delta, r.reason])).toEqual([
      [14, 'order'],
      [-14, 'order_reversed'],
    ])
    expect(state.stamps[0]!.n).toBe(0)
    expect(state.linked[0]!.n).toBe(1)

    // An online order linked at checkout: verified, then refunded, through admin's routes.
    const online = await asSuper(async () => {
      const [o] = await db.sql`
        insert into orders (channel, order_code, fulfilment, prep_status, payment_status, business_day,
          ticket_series, ticket_number, customer_name, customer_phone, customer_email, fulfil_at,
          subtotal_centavos, total_centavos, created_at, updated_at, customer_id)
        values ('online', 'KNK-LINK1', 'pickup', 'placed', 'pending_verification', '2026-11-21', 'W', 980, 'L',
          '09170000000', 'linked@x.test', ${NOW}, 12000, 12000, ${NOW}, ${NOW}, ${member})
        returning id`
      const [p] = await db.sql`insert into payments (order_id, method, amount_centavos, reference, status)
        values (${o!.id}, 'gcash', 12000, 'GC-LINK1', 'pending_verification') returning id`
      return { orderId: o!.id as string, paymentId: p!.id as string }
    })
    await ok('POST', `/v1/payments/${online.paymentId}/verify`, baristaJwt)
    await ok('POST', `/v1/orders/${online.orderId}/cancel`, ownerJwt, { reason: 'closed early' })
    const after = await asSuper(
      () => db.sql`select delta, reason from points_ledger where order_id = ${online.orderId} order by reason`,
    )
    expect(after.map((r) => [r.delta, r.reason])).toEqual([
      [12, 'order'],
      [-12, 'order_reversed'],
    ])
  })

  it('Kennko card: view, join, rename, and delete a second customer as kennko_api', async () => {
    expect(await ok('GET', '/v1/me', customerJwt)).toEqual({ customer: null })
    const joined = await ok('POST', '/v1/me/join', customerJwt, { ageConfirmed: true, privacyVersion: '2026-11' })
    expect(joined.customer).toMatchObject({ displayName: 'cy', stampMode: 'none', points: 0 })
    await ok('PATCH', '/v1/me', customerJwt, { displayName: 'Cy' })
    expect((await ok('GET', '/v1/me', customerJwt)).customer).toMatchObject({ displayName: 'Cy' })

    // The second customer has a card with a stamp, points, a linked order and a push subscription.
    const leaver = '00000000-0000-4000-8000-0000000000a5'
    const orderId = await asSuper(async () => {
      await db.sql`insert into auth.users (id, email) values (${leaver}, 'leaver@x.test')`
      const [o] = await db.sql`
        insert into orders (channel, order_code, fulfilment, prep_status, payment_status, business_day,
          ticket_series, ticket_number, customer_name, customer_phone, customer_email, customer_user_id, fulfil_at,
          subtotal_centavos, total_centavos, created_at, updated_at)
        values ('online', 'KNK-LEAVE', 'pickup', 'completed', 'paid', '2026-11-21', 'W', 990, 'L', '09170000000',
          'leaver@x.test', ${leaver}, ${NOW}, 12000, 12000, ${NOW}, ${NOW})
        returning id`
      await db.sql`insert into push_subscriptions (endpoint, p256dh, auth, kind, customer_user_id)
        values ('https://push.test/leaver', 'p', 'a', 'customer', ${leaver})`
      return o!.id as string
    })
    auth.users[leaver] = { email: 'leaver@x.test', emailConfirmed: true, createdAt: '2026-11-01T00:00:00Z' }
    const leaverJwt = await signFor(leaver)
    await ok('POST', '/v1/me/join', leaverJwt, { ageConfirmed: true, privacyVersion: '2026-11', displayName: 'Leaver' })
    await asSuper(async () => {
      await db.sql`update orders set customer_id = ${leaver} where id = ${orderId}`
      const [card] = await db.sql`insert into stamp_cards (customer_id, started_at) values (${leaver}, ${NOW}) returning id`
      await db.sql`insert into stamps (id, customer_id, card_id, order_id, stamped_at, received_at)
        values (${randomUUID()}, ${leaver}, ${card!.id}, ${orderId}, ${NOW}, ${NOW})`
      await db.sql`insert into points_ledger (customer_id, delta, reason, order_id, created_at)
        values (${leaver}, 12, 'order', ${orderId}, ${NOW})`
      await db.sql`insert into points_ledger (customer_id, delta, reason, note, created_by_staff, created_at)
        values (${leaver}, 18, 'adjustment', 'Welcome', ${OWNER}, ${NOW})`
    })
    // The cat from joining, a bought and worn bandana (30 points) and a visit go too.
    const [bandana] = await asSuper(() => db.sql`select id from cosmetics where key = 'bandana'`)
    await ok('POST', `/v1/me/cosmetics/${bandana!.id as string}/buy`, leaverJwt)
    await ok('PUT', '/v1/me/cat', leaverJwt, { name: 'Biko', look: { coat: 'black', neck: 'bandana' }, showOnWall: true })
    await asSuper(
      () => db.sql`insert into visits (customer_id, visit_key, source, started_at, ends_at)
        values (${leaver}, ${randomUUID()}, 'checkin', ${NOW}, '2026-11-21T03:30:00Z')`,
    )
    const [had] = await asSuper(
      () => db.sql`select
        (select count(*)::int from cats where customer_id = ${leaver}) as cats,
        (select count(*)::int from customer_cosmetics where customer_id = ${leaver}) as cosmetics,
        (select count(*)::int from visits where customer_id = ${leaver}) as visits`,
    )
    expect(had).toEqual({ cats: 1, cosmetics: 1, visits: 1 })
    expect(await ok('DELETE', '/v1/me', leaverJwt, { confirm: 'DELETE' })).toEqual({ deleted: true })
    const [left] = await asSuper(
      () => db.sql`select
        (select count(*)::int from customers where id = ${leaver}) +
        (select count(*)::int from stamp_cards where customer_id = ${leaver}) +
        (select count(*)::int from stamps where customer_id = ${leaver}) +
        (select count(*)::int from points_ledger where customer_id = ${leaver}) +
        (select count(*)::int from orders where customer_id = ${leaver} or customer_user_id = ${leaver}) +
        (select count(*)::int from push_subscriptions where customer_user_id = ${leaver}) +
        (select count(*)::int from cats where customer_id = ${leaver}) +
        (select count(*)::int from customer_cosmetics where customer_id = ${leaver}) +
        (select count(*)::int from visits where customer_id = ${leaver}) as n`,
    )
    expect(left!.n).toBe(0)
    expect(auth.deleted).toContain(leaver)
  })

  it('Kennko cats: catalogue, join with a cat, buy, equip and view as kennko_api', async () => {
    const shop = (await ok('GET', '/v1/cosmetics')) as unknown as { id: string; key: string }[]
    expect(shop).toHaveLength(22)
    const beanie = shop.find((x) => x.key === 'beanie')!

    const catLover = '00000000-0000-4000-8000-0000000000a6'
    await asSuper(() => db.sql`insert into auth.users (id, email) values (${catLover}, 'cat@x.test')`)
    auth.users[catLover] = { email: 'cat@x.test', emailConfirmed: true, createdAt: '2026-11-01T00:00:00Z' }
    const jwt = await signFor(catLover)
    const joined = await ok('POST', '/v1/me/join', jwt, { ageConfirmed: true, privacyVersion: '2026-11' })
    expect((joined.customer as { owned: string[] }).owned).toEqual(['black', 'cream', 'ginger', 'tabby'])
    await asSuper(
      () => db.sql`insert into points_ledger (customer_id, delta, reason, note, created_by_staff, created_at)
        values (${catLover}, 45, 'adjustment', 'Welcome', ${OWNER}, ${NOW})`,
    )

    const bought = await ok('POST', `/v1/me/cosmetics/${beanie.id}/buy`, jwt)
    expect(bought.customer).toMatchObject({ points: 5 })
    expect((bought.customer as { owned: string[] }).owned).toContain('beanie')
    await ok('PUT', '/v1/me/cat', jwt, { name: ' Kape ', look: { coat: 'ginger', hat: 'beanie' }, showOnWall: false })
    expect((await ok('GET', '/v1/me', jwt)).customer).toMatchObject({
      points: 5,
      cat: { name: 'Kape', look: { coat: 'ginger', hat: 'beanie' }, showOnWall: false, hiddenByAdmin: false, visitEndsAt: null },
    })

    // A customer from a pre-deploy join (no cat) gets one on the next GET.
    const gap = '00000000-0000-4000-8000-0000000000a7'
    await asSuper(async () => {
      await db.sql`insert into auth.users (id, email) values (${gap}, 'gap@x.test')`
      await db.sql`insert into customers (id, public_code, display_name, age_confirmed_at, privacy_accepted_at, privacy_version, created_at)
        values (${gap}, ${makePublicCode(randomInt)}, 'Gap', ${NOW}, ${NOW}, '2026-11', ${NOW})`
    })
    const gapView = await ok('GET', '/v1/me', await signFor(gap))
    expect((gapView.customer as { cat: { look: { coat: string } } }).cat.look.coat).toMatch(/^(ginger|tabby|black|cream)$/)
  })

  it('wall check-in: a pull that creates the secret, a check-in, visitors and a counter link that extends the visit as kennko_api', async () => {
    // Start with no secret, so the pull below inserts it as kennko_api.
    await asSuper(() => db.sql`delete from shop_secrets where id = 1`)
    const first = await ok('GET', '/v1/sync/pull', deviceToken)
    const [row] = await asSuper(() => db.sql<{ checkin_secret: string }[]>`select checkin_secret from shop_secrets where id = 1`)
    expect(first.checkin).toEqual({ secret: row!.checkin_secret, url: 'https://kennko.vercel.app/here' })

    const scanner = '00000000-0000-4000-8000-0000000000a8'
    await asSuper(() => db.sql`insert into auth.users (id, email) values (${scanner}, 'scan@x.test')`)
    auth.users[scanner] = { email: 'scan@x.test', emailConfirmed: true, createdAt: '2026-11-01T00:00:00Z' }
    const jwt = await signFor(scanner)
    await ok('POST', '/v1/me/join', jwt, { ageConfirmed: true, privacyVersion: '2026-11' })
    // A customer from before the cats deploy: check-in gives them a cat too.
    await asSuper(() => db.sql`delete from cats where customer_id = ${scanner}`)
    const code = await wallCode(row!.checkin_secret, wallMinute(NOW.getTime()))
    const end = new Date(NOW.getTime() + 90 * 60_000).toISOString()
    expect(await ok('POST', '/v1/checkin', jwt, { code })).toEqual({ endsAt: end, onWall: true })
    const [visit] = await asSuper(() => db.sql<{ visit_key: string }[]>`select visit_key from visits where customer_id = ${scanner}`)
    const state = await ok('GET', '/v1/sync/pull', deviceToken)
    expect((state.visitors as { key: string; endsAt: string }[]).find((v) => v.key === visit!.visit_key)?.endsAt).toBe(end)

    // A counter sale linked to the card extends the visit.
    const bare = (await asSuper(() => db.sql<{ public_code: string }[]>`select public_code from customers where id = ${scanner}`))[0]!
      .public_code
    await asSuper(() => db.sql`update visits set ends_at = ${new Date(NOW.getTime() + 10 * 60_000)} where customer_id = ${scanner}`)
    const [open] = await asSuper(() => db.sql<{ id: string }[]>`select id from shifts where device_id = ${deviceId} and closed_at is null`)
    const sale = orderCreated({ shiftId: open!.id, ticketNumber: 61, menuVersion: null }, { staffId: BARISTA })
    const res = await push([sale, customerLinked({ orderId: sale.payload.orderId, publicCode: formatPublicCode(bare) }, { staffId: BARISTA })])
    expect(res.results.map((r) => r.result)).toEqual(['flagged', 'applied'])
    const [after] = await asSuper(() => db.sql<{ ends_at: Date }[]>`select ends_at from visits where customer_id = ${scanner}`)
    expect(after!.ends_at.toISOString()).toBe(end)
  })

  it('till customers: lookup, claim, release and a pull with customers and online card state as kennko_api', async () => {
    const member = '00000000-0000-4000-8000-0000000000b3'
    const bare = makePublicCode(randomInt)
    const onlineId = await asSuper(async () => {
      await db.sql`insert into auth.users (id, email) values (${member}, 'till@x.test')`
      await db.sql`insert into customers (id, public_code, display_name, stamp_mode, age_confirmed_at, privacy_accepted_at,
          privacy_version, created_at)
        values (${member}, ${bare}, 'Till Member', 'digital', ${NOW}, ${NOW}, '2026-11', ${NOW})`
      // Two full cards waiting, so one claim can be released and another kept.
      for (let i = 0; i < 2; i++) {
        await db.sql`insert into stamp_cards (customer_id, started_at, filled_at) values (${member}, ${NOW}, ${NOW})`
      }
      const [o] = await db.sql`
        insert into orders (channel, order_code, fulfilment, prep_status, payment_status, business_day,
          ticket_series, ticket_number, customer_name, customer_phone, customer_email, fulfil_at,
          subtotal_centavos, total_centavos, created_at, updated_at, customer_id)
        values ('online', 'KNK-TILL1', 'pickup', 'placed', 'paid', '2026-11-21', 'W', 970, 'T',
          '09170000000', 'till@x.test', ${NOW}, 12000, 12000, ${NOW}, ${NOW}, ${member})
        returning id`
      await db.sql`insert into order_lines (order_id, item_id, item_name, variant_code, variant_label, unit_price_centavos,
          quantity, line_total_centavos)
        values (${o!.id}, ${latteId}, 'Latte', 'M', 'Medium', 12000, 1, 12000)`
      await db.sql`insert into payments (order_id, method, amount_centavos, reference, status)
        values (${o!.id}, 'gcash', 12000, 'GC-TILL1', 'verified')`
      return o!.id as string
    })
    const code = formatPublicCode(bare)

    expect(await ok('GET', `/v1/customers/by-code/${code}`, deviceToken)).toEqual({
      code,
      catName: null,
      stampMode: 'digital',
      stamps: 0,
      fullCards: 2,
    })
    const kept = randomUUID()
    const dropped = randomUUID()
    expect((await ok('POST', '/v1/stamp-cards/claim', deviceToken, { claimId: kept, code, staffId: BARISTA })).customer).toMatchObject({
      fullCards: 1,
    })
    await ok('POST', '/v1/stamp-cards/claim', deviceToken, { claimId: dropped, code, staffId: null })
    expect(await ok('POST', '/v1/stamp-cards/release', deviceToken, { claimId: dropped })).toEqual({ released: true })

    // A sale linked on this till brings the customer into the pull.
    const [open] = await asSuper(() => db.sql<{ id: string }[]>`select id from shifts where device_id = ${deviceId} and closed_at is null`)
    const sale = orderCreated({ shiftId: open!.id, ticketNumber: 60, menuVersion: null }, { staffId: BARISTA })
    const res = await push([sale, customerLinked({ orderId: sale.payload.orderId, publicCode: code }, { staffId: BARISTA })])
    // The unpriced sale is stored flagged; the link applies either way.
    expect(res.results.map((r) => r.result)).toEqual(['flagged', 'applied'])
    const state = await ok('GET', '/v1/sync/pull', deviceToken)
    expect(state.customers).toContainEqual({ code, catName: null, stampMode: 'digital', stamps: 0, fullCards: 0 })
    const online = (state.onlineOrders as { id: string; card: string | null }[]).find((o) => o.id === onlineId)
    expect(online?.card).toBe('stamp')
    const [rl] = await asSuper(() => db.sql`select count(*)::int as n from rate_limits where key like 'lookup:%'`)
    expect(rl!.n).toBeGreaterThan(0)
  })

  it('admin customers and stamps to check: lookup, detail, card mode, points, apply, discard, Needs a look as kennko_api', async () => {
    const member = '00000000-0000-4000-8000-0000000000b4'
    const bare = makePublicCode(randomInt)
    await asSuper(async () => {
      await db.sql`insert into auth.users (id, email) values (${member}, 'admin-view@x.test')`
      await db.sql`insert into customers (id, public_code, display_name, stamp_mode, age_confirmed_at, privacy_accepted_at,
          privacy_version, created_at)
        values (${member}, ${bare}, 'Paula Paper', 'paper', ${NOW}, ${NOW}, '2026-11', ${NOW})`
    })
    const code = formatPublicCode(bare)
    const managerJwt = await signFor(MANAGER_LOGIN)

    // Two paper stamps through the till.
    const [open] = await asSuper(() => db.sql<{ id: string }[]>`select id from shifts where device_id = ${deviceId} and closed_at is null`)
    const stampIds: string[] = []
    for (const ticketNumber of [70, 71]) {
      const sale = orderCreated({ shiftId: open!.id, ticketNumber, menuVersion: null }, { staffId: BARISTA })
      const stamp = stampAdded({ orderId: sale.payload.orderId }, { staffId: BARISTA })
      const res = await push([sale, customerLinked({ orderId: sale.payload.orderId, publicCode: code }, { staffId: BARISTA }), stamp])
      expect(res.results.map((r) => r.reason)).toEqual(['unknown_version', null, 'mode_was_paper'])
      stampIds.push(stamp.payload.stampId)
    }

    const byName = (await ok('GET', '/v1/customers?q=paula', managerJwt)) as unknown as { id: string }[]
    expect(byName.map((c) => c.id)).toEqual([member])
    const byCode = (await ok('GET', `/v1/customers?q=${encodeURIComponent(code)}`, ownerJwt)) as unknown as { id: string }[]
    expect(byCode.map((c) => c.id)).toEqual([member])
    const detail = await call('GET', `/v1/customers/${member}`, managerJwt)
    expect(detail.status, detail.text).toBe(200)
    expect(detail.text).not.toContain('admin-view@x.test')
    expect((detail.json().paperStamps as unknown[]).length).toBe(2)

    const toCheck = (await ok('GET', '/v1/stamps/to-check', managerJwt)) as unknown as { id: string }[]
    expect(toCheck.map((s) => s.id)).toEqual(expect.arrayContaining(stampIds))
    const view = await ok('GET', '/v1/attention', ownerJwt)
    expect((view.stamps as { id: string }[]).map((s) => s.id)).toEqual(expect.arrayContaining(stampIds))
    const before = (await ok('GET', '/v1/attention/count', ownerJwt)).count as number

    expect((await call('POST', `/v1/stamps/${stampIds[0]}/apply`, managerJwt)).json().code).toBe('STILL_PAPER')
    expect(await ok('POST', `/v1/customers/${member}/stamp-mode`, managerJwt, { mode: 'digital' })).toEqual({
      stampMode: 'digital',
      changed: true,
    })
    await ok('POST', `/v1/stamps/${stampIds[0]}/apply`, managerJwt)
    await ok('POST', `/v1/stamps/${stampIds[1]}/discard`, managerJwt)
    expect((await ok('GET', '/v1/attention/count', ownerJwt)).count).toBe(before - 2)
    // Paper customers still earn: 14 for each sale, then the adjustment.
    expect(await ok('POST', `/v1/customers/${member}/points`, ownerJwt, { delta: 25, note: 'Welcome back' })).toEqual({
      points: 53,
    })

    const state = await asSuper(async () => ({
      stamps: await db.sql`select card_id, flags, resolved_by from stamps where customer_id = ${member} order by stamped_at`,
      receipts: await db.sql`select resolve_note from sync_events where kind = 'stamp.added' and payload->>'stampId' in ${db.sql(stampIds)}
        order by seq`,
      ledger: await db.sql`select delta, reason, created_by_staff from points_ledger
        where customer_id = ${member} and reason = 'adjustment'`,
      mode: await db.sql`select stamp_mode, stamp_mode_set_by from customers where id = ${member}`,
    }))
    expect(state.stamps[0]!.card_id).not.toBeNull()
    expect(state.stamps[1]).toMatchObject({ card_id: null, flags: ['mode_was_paper', 'discarded'] })
    expect(state.receipts.map((r) => r.resolve_note)).toEqual(['Stamp applied', 'Stamp discarded'])
    expect(state.ledger.map((r) => [r.delta, r.reason, r.created_by_staff])).toEqual([[25, 'adjustment', OWNER]])
    expect(state.mode[0]!.stamp_mode).toBe('digital')
    expect(state.mode[0]!.stamp_mode_set_by).not.toBeNull()
  })

  it('stranded claims are swept by lookup, pull, claim, /v1/me, attention and admin reads; a late sale re-claims; a free line earns no stamp, as kennko_api', async () => {
    const member = '00000000-0000-4000-8000-0000000000b5'
    const bare = makePublicCode(randomInt)
    const code = formatPublicCode(bare)
    const longAgo = new Date(NOW.getTime() - 40 * 60_000)
    await asSuper(async () => {
      await db.sql`insert into auth.users (id, email) values (${member}, 'strand@x.test')`
      await db.sql`insert into customers (id, public_code, display_name, stamp_mode, age_confirmed_at, privacy_accepted_at,
          privacy_version, created_at)
        values (${member}, ${bare}, 'Stranded', 'digital', ${NOW}, ${NOW}, '2026-11', ${NOW})`
    })
    let strandTicket = 1000
    /** A full card of 8 stamps for `who`, claimed 40 minutes ago with no sale. */
    const strand = (who: string) =>
      asSuper(async () => {
        const claimId = randomUUID()
        const [card] = await db.sql`insert into stamp_cards (customer_id, started_at, filled_at, claimed_at, claim_id)
          values (${who}, ${longAgo}, ${longAgo}, ${longAgo}, ${claimId}) returning id`
        for (let i = 0; i < 8; i++) {
          strandTicket += 1
          const [o] = await db.sql`
            insert into orders (channel, fulfilment, prep_status, payment_status, business_day, ticket_series, ticket_number,
              customer_name, subtotal_centavos, total_centavos, device_id, customer_id)
            values ('counter', 'dine_in', 'completed', 'paid', '2026-11-20', 'C', ${strandTicket}, 'Walk-in', 12000, 12000,
              ${deviceId}, ${who})
            returning id`
          await db.sql`insert into stamps (id, customer_id, card_id, order_id, stamped_at, received_at)
            values (${randomUUID()}, ${who}, ${card!.id}, ${o!.id}, ${longAgo}, ${longAgo})`
        }
        return claimId
      })
    const stillClaimed = async (claimId: string) =>
      (await asSuper(() => db.sql`select count(*)::int as n from stamp_cards where claim_id = ${claimId}`))[0]!.n as number

    // Lookup sweeps.
    const first = await strand(member)
    expect(await ok('GET', `/v1/customers/by-code/${code}`, deviceToken)).toMatchObject({ fullCards: 1 })
    expect(await stillClaimed(first)).toBe(0)

    // A late sale for the swept claim re-claims the full card; its free line earns no stamp.
    const [open] = await asSuper(() => db.sql<{ id: string }[]>`select id from shifts where device_id = ${deviceId} and closed_at is null`)
    const free = {
      menuItemId: latteId,
      name: 'Latte',
      size: 'M' as const,
      basePriceCentavos: 0,
      modifiers: [],
      quantity: 1,
      iceLevel: 'regular' as const,
      iceServe: 'mixed' as const,
      note: '',
      lineTotalCentavos: 0,
      reward: true as const,
    }
    const sale = orderCreated(
      { shiftId: open!.id, ticketNumber: 80, menuVersion: version, lines: [free], subtotalCentavos: 0, totalCentavos: 0,
        payment: { id: randomUUID(), method: 'cash', tenderedCentavos: 0, changeCentavos: 0, reference: null } },
      { staffId: BARISTA },
    )
    const res = await push([
      sale,
      customerLinked({ orderId: sale.payload.orderId, publicCode: code }, { staffId: BARISTA }),
      rewardUsed({ claimId: first, orderId: sale.payload.orderId }, { staffId: BARISTA }),
      stampAdded({ orderId: sale.payload.orderId }, { staffId: BARISTA }),
    ])
    expect(res.results.map((r) => r.reason).slice(1)).toEqual([null, 'reclaimed', 'no_drink'])
    expect(await stillClaimed(first)).toBe(1)

    // The pull (this customer was linked on this till just now) and a new claim sweep.
    const second = await strand(member)
    expect((await ok('GET', '/v1/sync/pull', deviceToken)).customers).toContainEqual(expect.objectContaining({ code, fullCards: 1 }))
    expect(await stillClaimed(second)).toBe(0)
    const third = await strand(member)
    await ok('POST', '/v1/stamp-cards/claim', deviceToken, { claimId: randomUUID(), code, staffId: BARISTA })
    expect(await stillClaimed(third)).toBe(0)

    // Admin search, admin detail and Needs a look sweep; so does the customer's own /v1/me.
    const managerJwt = await signFor(MANAGER_LOGIN)
    const viaSearch = await strand(member)
    await ok('GET', '/v1/customers?q=stranded', managerJwt)
    expect(await stillClaimed(viaSearch)).toBe(0)
    const viaDetail = await strand(member)
    await ok('GET', `/v1/customers/${member}`, managerJwt)
    expect(await stillClaimed(viaDetail)).toBe(0)
    const viaAttention = await strand(member)
    await ok('GET', '/v1/attention', ownerJwt)
    expect(await stillClaimed(viaAttention)).toBe(0)
    const viaMe = await strand(CUSTOMER)
    await ok('GET', '/v1/me', customerJwt)
    expect(await stillClaimed(viaMe)).toBe(0)
  })

  it('publishMenu from the deploy helper also works as kennko_api', async () => {
    await asSuper(() => db.sql`update menu_variants set price_centavos = 13000 where item_id = ${latteId}`)
    const r = await publishMenu(db.sql, OWNER)
    expect(r.version).toBeGreaterThan(version)
  })
})

import { randomUUID } from 'node:crypto'
import type { CounterOrderPayload, ImportOrder, ImportShift, PushResponse } from '@kennko/core'
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
  orderCancelled,
  orderCreated,
  prepStatus,
  shiftClosed,
  shiftOpened,
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
    })
    expect(await ok('DELETE', '/v1/me', leaverJwt, { confirm: 'DELETE' })).toEqual({ deleted: true })
    const [left] = await asSuper(
      () => db.sql`select
        (select count(*)::int from customers where id = ${leaver}) +
        (select count(*)::int from stamp_cards where customer_id = ${leaver}) +
        (select count(*)::int from stamps where customer_id = ${leaver}) +
        (select count(*)::int from points_ledger where customer_id = ${leaver}) +
        (select count(*)::int from orders where customer_id = ${leaver} or customer_user_id = ${leaver}) +
        (select count(*)::int from push_subscriptions where customer_user_id = ${leaver}) as n`,
    )
    expect(left!.n).toBe(0)
    expect(auth.deleted).toContain(leaver)
  })

  it('publishMenu from the deploy helper also works as kennko_api', async () => {
    await asSuper(() => db.sql`update menu_variants set price_centavos = 13000 where item_id = ${latteId}`)
    const r = await publishMenu(db.sql, OWNER)
    expect(r.version).toBeGreaterThan(version)
  })
})

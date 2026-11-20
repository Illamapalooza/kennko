import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import type { Hono } from 'hono'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/create-app.js'
import { verifierFromJwks, type AppEnv } from '../src/auth.js'
import { generateOrderCode } from '../src/orders/create.js'
import { publishMenu } from '../src/menu/snapshot.js'
import type { PushPayload, PushSender } from '../src/push/send.js'
import { fakeAuthAdmin, fakeProofs, inlineDefer } from './fakes.js'
import { startTestDb, type TestDb } from './pg.js'

const ISSUER = 'http://supabase.test/auth/v1'
const OWNER = '00000000-0000-4000-8000-000000000001'
const BARISTA = '00000000-0000-4000-8000-000000000002'
const FORMER = '00000000-0000-4000-8000-000000000003'
const CUSTOMER = '00000000-0000-4000-8000-0000000000c5'
const NOW = new Date('2026-11-21T02:00:00Z')

type Sent = { endpoint: string; payload: PushPayload }
type Body = { code?: string; errors?: string[]; publicKey?: string; orderCode?: string }

/** Base64url of `len` bytes filled with `seed`: a well-formed key that differs per seed. */
const key = (seed: string, len: number) => Buffer.alloc(len, seed).toString('base64url')
const p256 = (n: string) => key(`p-${n}`, 65)
const authKey = (n: string) => key(`a-${n}`, 16)
const sub = (n: string) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${n}`,
  keys: { p256dh: p256(n), auth: authKey(n) },
})

describe('web push', () => {
  let db: TestDb
  let app: Hono<AppEnv>
  let appOff: Hono<AppEnv>
  let appFlaky: Hono<AppEnv>
  let appBadDefer: Hono<AppEnv>
  let flakyOn = false
  let tokens: Record<string, string>
  let sent: Sent[]
  let behaviour: (endpoint: string) => 'sent' | 'gone' | 'failed' | 'throw'
  let seq = 0
  let latteId: string

  const sender: PushSender = async (s, payload) => {
    sent.push({ endpoint: s.endpoint, payload })
    const b = behaviour(s.endpoint)
    if (b === 'throw') throw new Error('push service exploded')
    return b
  }

  beforeAll(async () => {
    db = await startTestDb()
    await db.sql
      .unsafe(
        `insert into auth.users (id, email) values ('${OWNER}', 'o@x.test'), ('${BARISTA}', 'b@x.test'),
           ('${FORMER}', 'f@x.test'), ('${CUSTOMER}', 'c@x.test');
         insert into staff (id, user_id, email, full_name, role, is_active) values
           ('${OWNER}', '${OWNER}', 'o@x.test', 'Owner', 'owner', true),
           ('${BARISTA}', '${BARISTA}', 'b@x.test', 'Barista', 'barista', true),
           ('${FORMER}', '${FORMER}', 'f@x.test', 'Former', 'barista', false);`,
      )
      .simple()
    const [cat] = await db.sql`insert into menu_categories (name, sort_order) values ('Coffee', 0) returning id`
    const [latte] = await db.sql`insert into menu_items (category_id, name) values (${cat!.id}, 'Iced Latte') returning id`
    latteId = latte!.id
    await db.sql`insert into menu_variants (item_id, code, label, price_centavos, temperature)
      values (${latteId}, 'M', 'Medium', 24500, 'iced')`
    await publishMenu(db.sql, null)

    const pair = await generateKeyPair('ES256')
    const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' }
    const sign = (sub: string) =>
      new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
        .setSubject(sub)
        .setIssuer(ISSUER)
        .setAudience('authenticated')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(pair.privateKey)
    tokens = {
      owner: await sign(OWNER),
      barista: await sign(BARISTA),
      former: await sign(FORMER),
      customer: await sign(CUSTOMER),
    }
    const base = {
      defer: inlineDefer,
      sql: db.sql,
      verifyUser: verifierFromJwks(createLocalJWKSet({ keys: [jwk] }), ISSUER),
      proofs: fakeProofs(),
      authAdmin: fakeAuthAdmin(),
      now: () => NOW,
      orderCode: generateOrderCode,
      webKey: null,
    }
    app = createApp({ ...base, push: sender, vapidPublicKey: 'PUBKEY' })
    appOff = createApp({ ...base, push: null })
    // Same app, but the database fails whenever push looks up an order or its watchers.
    const flaky = new Proxy(db.sql, {
      apply(target, thisArg, args) {
        const text = Array.isArray(args[0]) ? (args[0] as string[]).join('?') : ''
        if (flakyOn && /order_code|push_order_watch/.test(text) && !/insert into/.test(text)) throw new Error('db blip')
        return Reflect.apply(target, thisArg, args)
      },
    })
    appFlaky = createApp({ ...base, sql: flaky, push: sender })
    appBadDefer = createApp({
      ...base,
      push: sender,
      defer: () => {
        throw new Error('defer exploded')
      },
    })
  })
  afterAll(async () => {
    await db.stop()
  })
  beforeEach(() => {
    sent = []
    behaviour = () => 'sent'
    flakyOn = false
  })

  async function seedOnline(userId: string | null = null) {
    seq += 1
    const [o] = await db.sql`
      insert into orders (channel, order_code, fulfilment, prep_status, payment_status, business_day,
        ticket_series, ticket_number, customer_name, customer_phone, customer_email, customer_user_id, fulfil_at,
        subtotal_centavos, total_centavos)
      values ('online', ${'KNK-P' + seq}, 'pickup', 'placed', 'pending_verification', '2026-01-01',
        'W', ${seq}, 'Ana', '09171234567', 'a@x.test', ${userId}, now(), 24500, 24500)
      returning id`
    const [p] = await db.sql`
      insert into payments (order_id, method, amount_centavos, reference, status)
      values (${o!.id}, 'gcash', 24500, 'REF', 'pending_verification') returning id`
    return { orderId: o!.id as string, paymentId: p!.id as string, code: `KNK-P${seq}` }
  }

  const call = async (
    who: string | null,
    method: string,
    path: string,
    body?: unknown,
    target: Hono<AppEnv> = app,
  ) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (who) headers.Authorization = `Bearer ${tokens[who]}`
    const res = await target.request(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: (text ? JSON.parse(text) : {}) as Body }
  }
  const subscribe = (who: string | null, body: unknown) => call(who, 'POST', '/v1/push/subscriptions', body)
  const verify = (paymentId: string) => call('barista', 'POST', `/v1/payments/${paymentId}/verify`)
  const subRow = async (endpoint: string) =>
    (await db.sql`select * from push_subscriptions where endpoint = ${endpoint}`)[0]

  describe('subscriptions', () => {
    it('customer subscribes with an order code -> 201, subscription and watch rows', async () => {
      const o = await seedOnline()
      const s = sub('c1')
      const r = await subscribe(null, { subscription: s, orderCode: o.code })
      expect(r.status).toBe(201)
      const row = await subRow(s.endpoint)
      expect(row).toMatchObject({ kind: 'customer', staff_id: null, customer_user_id: null, p256dh: p256('c1'), auth: authKey('c1') })
      const watch = await db.sql`select * from push_order_watch where subscription_id = ${row!.id}`
      expect(watch.map((w) => w.order_id)).toEqual([o.orderId])
    })

    it('upserts by endpoint and links a signed-in customer to their account', async () => {
      const a = await seedOnline()
      const b = await seedOnline()
      const s = sub('c2')
      await subscribe(null, { subscription: s, orderCode: a.code })
      await subscribe('customer', { subscription: { ...s, keys: { p256dh: p256('new'), auth: authKey('newer') } }, orderCode: b.code })
      const rows = await db.sql`select * from push_subscriptions where endpoint = ${s.endpoint}`
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ p256dh: p256('new'), auth: authKey('newer'), customer_user_id: CUSTOMER })
      const watch = await db.sql`select order_id from push_order_watch where subscription_id = ${rows[0]!.id}`
      expect(watch.map((w) => w.order_id).sort()).toEqual([a.orderId, b.orderId].sort())
    })

    it('a subscription watches at most 20 orders; the oldest watch is dropped', async () => {
      const s = sub('cap')
      const orders: string[] = []
      for (let i = 0; i < 21; i++) {
        const o = await seedOnline()
        await db.sql`update orders set created_at = '2026-01-01T00:00:00Z'::timestamptz + ${i} * interval '1 minute' where id = ${o.orderId}`
        orders.push(o.orderId)
        expect((await subscribe(null, { subscription: s, orderCode: o.code })).status).toBe(201)
      }
      const row = await subRow(s.endpoint)
      const watch = await db.sql`select order_id from push_order_watch where subscription_id = ${row!.id}`
      expect(watch).toHaveLength(20)
      expect(watch.map((w) => w.order_id)).not.toContain(orders[0])
      expect(watch.map((w) => w.order_id)).toContain(orders[20])
    })

    it('unknown order code -> 404 NOT_FOUND with errors[]', async () => {
      const r = await subscribe(null, { subscription: sub('c3'), orderCode: 'KNK-NOPE' })
      expect(r.status).toBe(404)
      expect(r.body.code).toBe('NOT_FOUND')
      expect(r.body.errors?.length).toBeGreaterThan(0)
      expect(await subRow(sub('c3').endpoint)).toBeUndefined()
    })

    it('staff token without an order code -> staff subscription', async () => {
      const s = sub('s1')
      const r = await subscribe('barista', { subscription: s })
      expect(r.status).toBe(201)
      expect(await subRow(s.endpoint)).toMatchObject({ kind: 'staff', staff_id: BARISTA })
    })

    it('inactive staff cannot subscribe', async () => {
      const r = await subscribe('former', { subscription: sub('s2') })
      expect(r.status).toBe(403)
    })

    it('neither a staff token nor an order code -> 400 INVALID', async () => {
      const r = await subscribe(null, { subscription: sub('x1') })
      expect(r.status).toBe(400)
      expect(r.body.code).toBe('INVALID')
      expect(r.body.errors?.length).toBeGreaterThan(0)
    })

    it('malformed subscription -> 400 INVALID', async () => {
      const r = await subscribe(null, { subscription: { endpoint: 'nope' }, orderCode: 'KNK-X' })
      expect(r.status).toBe(400)
      expect(r.body.code).toBe('INVALID')
    })

    it('DELETE removes the subscription and answers 204 even when it does not exist', async () => {
      const s = sub('d1')
      await subscribe('barista', { subscription: s })
      expect((await call(null, 'DELETE', '/v1/push/subscriptions', { endpoint: s.endpoint })).status).toBe(204)
      expect(await subRow(s.endpoint)).toBeUndefined()
      expect((await call(null, 'DELETE', '/v1/push/subscriptions', { endpoint: s.endpoint })).status).toBe(204)
    })

    it('an order code on a staff device adds the watch and keeps it a staff subscription', async () => {
      const o = await seedOnline()
      const s = sub('sw1')
      await subscribe('barista', { subscription: s })
      const r = await subscribe(null, { subscription: { ...s, keys: { p256dh: p256('hijack'), auth: authKey('hijack') } }, orderCode: o.code })
      expect(r.status).toBe(201)
      const row = await subRow(s.endpoint)
      expect(row).toMatchObject({ kind: 'staff', staff_id: BARISTA, p256dh: p256('sw1'), auth: authKey('sw1') })
      const watch = await db.sql`select order_id from push_order_watch where subscription_id = ${row!.id}`
      expect(watch.map((w) => w.order_id)).toEqual([o.orderId])
    })

    it('DELETE /subscriptions/watch removes only that order watch', async () => {
      const a = await seedOnline()
      const b = await seedOnline()
      const s = sub('uw1')
      await subscribe(null, { subscription: s, orderCode: a.code })
      await subscribe(null, { subscription: s, orderCode: b.code })
      const r = await call(null, 'DELETE', '/v1/push/subscriptions/watch', { endpoint: s.endpoint, orderCode: a.code })
      expect(r.status).toBe(204)
      const row = await subRow(s.endpoint)
      expect(row).toBeDefined()
      const watch = await db.sql`select order_id from push_order_watch where subscription_id = ${row!.id}`
      expect(watch.map((w) => w.order_id)).toEqual([b.orderId])
    })

    it('DELETE /subscriptions/watch answers 204 for unknown order or endpoint, 400 for a bad body', async () => {
      const o = await seedOnline()
      expect((await call(null, 'DELETE', '/v1/push/subscriptions/watch', { endpoint: 'https://push.test/none', orderCode: o.code })).status).toBe(204)
      expect((await call(null, 'DELETE', '/v1/push/subscriptions/watch', { endpoint: 'https://push.test/none', orderCode: 'KNK-NOPE' })).status).toBe(204)
      expect((await call(null, 'DELETE', '/v1/push/subscriptions/watch', { endpoint: 'x' })).status).toBe(400)
    })

    it('a guest subscribe on a shared device drops the previous account link', async () => {
      const a = await seedOnline()
      const b = await seedOnline()
      const s = sub('shared1')
      await subscribe('customer', { subscription: s, orderCode: a.code })
      expect(await subRow(s.endpoint)).toMatchObject({ customer_user_id: CUSTOMER })
      expect((await subscribe(null, { subscription: s, orderCode: b.code })).status).toBe(201)
      expect(await subRow(s.endpoint)).toMatchObject({ customer_user_id: null })
    })

    it.each([
      ['http://fcm.googleapis.com/fcm/send/x'],
      ['https://push.test/x'],
      ['https://evil.test/fcm.googleapis.com'],
      ['https://fcm.googleapis.com.evil.test/x'],
    ])('endpoint %s is refused with 400 INVALID and nothing stored', async (endpoint) => {
      const o = await seedOnline()
      const r = await subscribe(null, { subscription: { ...sub('bad'), endpoint }, orderCode: o.code })
      expect(r.status).toBe(400)
      expect(r.body.code).toBe('INVALID')
      expect(r.body.errors).toEqual(["That notification address isn't supported."])
      expect(await subRow(endpoint)).toBeUndefined()
    })

    it.each([
      ['https://updates.push.services.mozilla.com/wpush/v2/x'],
      ['https://web.push.apple.com/x'],
      ['https://wns2-par02p.notify.windows.com/w/?token=x'],
    ])('endpoint %s is accepted', async (endpoint) => {
      const o = await seedOnline()
      const r = await subscribe(null, { subscription: { ...sub('ok'), endpoint }, orderCode: o.code })
      expect(r.status).toBe(201)
    })

    it.each([
      ['p256dh not base64url', { p256dh: 'p-c1!', auth: authKey('k') }],
      ['p256dh wrong length', { p256dh: key('p', 64), auth: authKey('k') }],
      ['auth wrong length', { p256dh: p256('k'), auth: key('a', 15) }],
      ['auth not base64url', { p256dh: p256('k'), auth: 'a-c1' + '%%%' }],
    ])('%s -> 400 INVALID', async (_label, keys) => {
      const o = await seedOnline()
      const s = { endpoint: 'https://fcm.googleapis.com/fcm/send/keys', keys }
      const r = await subscribe(null, { subscription: s, orderCode: o.code })
      expect(r.status).toBe(400)
      expect(r.body.code).toBe('INVALID')
      expect(await subRow(s.endpoint)).toBeUndefined()
    })

    it('at most 10 devices watch one order; the 11th gets 429 TOO_MANY, a watcher re-subscribing is fine', async () => {
      const o = await seedOnline()
      for (let i = 0; i < 10; i++) {
        expect((await subscribe(null, { subscription: sub(`many${i}`), orderCode: o.code })).status).toBe(201)
      }
      const r = await subscribe(null, { subscription: sub('many10'), orderCode: o.code })
      expect(r.status).toBe(429)
      expect(r.body.code).toBe('TOO_MANY')
      expect(r.body.errors).toEqual(['This order already has the most devices it can notify.'])
      expect(await subRow(sub('many10').endpoint)).toBeUndefined()
      expect((await subscribe(null, { subscription: sub('many3'), orderCode: o.code })).status).toBe(201)
      expect(await db.sql`select 1 from push_order_watch where order_id = ${o.orderId}`).toHaveLength(10)
    })

    it('push off -> subscribe answers 503 PUSH_UNAVAILABLE and stores nothing', async () => {
      const o = await seedOnline()
      const s = sub('off1')
      const r = await call(null, 'POST', '/v1/push/subscriptions', { subscription: s, orderCode: o.code }, appOff)
      expect(r.status).toBe(503)
      expect(r.body.code).toBe('PUSH_UNAVAILABLE')
      expect(r.body.errors).toEqual(["Notifications aren't available right now."])
      expect(await subRow(s.endpoint)).toBeUndefined()
      const staff = await call('barista', 'POST', '/v1/push/subscriptions', { subscription: sub('off2') }, appOff)
      expect(staff.status).toBe(503)
      expect(await subRow(sub('off2').endpoint)).toBeUndefined()
    })

    it('GET /v1/push/public-key -> key when enabled, 404 when push is off', async () => {
      const on = await call(null, 'GET', '/v1/push/public-key')
      expect(on.status).toBe(200)
      expect(on.body.publicKey).toBe('PUBKEY')
      const off = await call(null, 'GET', '/v1/push/public-key', undefined, appOff)
      expect(off.status).toBe(404)
      expect(off.body.code).toBe('NOT_FOUND')
    })
  })

  describe('order updates', () => {
    it('verify -> one paid notification to the watcher with the W number first', async () => {
      const o = await seedOnline()
      const s = sub('w1')
      await subscribe(null, { subscription: s, orderCode: o.code })
      const r = await verify(o.paymentId)
      expect(r.status).toBe(200)
      expect(sent).toHaveLength(1)
      expect(sent[0]!.endpoint).toBe(s.endpoint)
      expect(sent[0]!.payload).toEqual({
        title: expect.stringMatching(/^W\d+ · Payment confirmed — we're on it$/),
        body: expect.any(String),
        url: `/order/${o.code}`,
        tag: `order-${o.code}`,
      })
      expect((await subRow(s.endpoint))!.last_used_at).not.toBeNull()
    })

    it('prep steps send the matching copy', async () => {
      const o = await seedOnline()
      await subscribe(null, { subscription: sub('w2'), orderCode: o.code })
      await verify(o.paymentId)
      sent = []
      const titles: string[] = []
      for (const step of ['preparing', 'ready', 'completed']) {
        await call('barista', 'PATCH', `/v1/orders/${o.orderId}`, { prepStatus: step })
        titles.push(sent.at(-1)!.payload.title)
      }
      const w = `W${seq}`
      expect(titles).toEqual([`${w} is being prepared`, `${w} is ready for pickup`, `${w} is complete — enjoy!`])
    })

    it('out for delivery copy', async () => {
      seq += 1
      const [zone] = await db.sql`insert into delivery_zones (barangay, fee_centavos, latitude, longitude)
        values (${'Zone' + seq}, 0, 8.942, 125.529) returning id`
      const [o] = await db.sql`
        insert into orders (channel, order_code, fulfilment, prep_status, payment_status, business_day,
          ticket_series, ticket_number, customer_name, customer_phone, customer_email, fulfil_at,
          subtotal_centavos, total_centavos, delivery_address, delivery_barangay, delivery_zone_id)
        values ('online', ${'KNK-P' + seq}, 'delivery', 'preparing', 'paid', '2026-01-01',
          'W', ${seq}, 'Ana', '09171234567', 'a@x.test', now(), 100, 100, '1 Gate', ${'Zone' + seq}, ${zone!.id}) returning id`
      await subscribe(null, { subscription: sub('w3'), orderCode: `KNK-P${seq}` })
      await call('barista', 'PATCH', `/v1/orders/${o!.id}`, { prepStatus: 'out_for_delivery' })
      expect(sent.at(-1)!.payload.title).toBe(`W${seq} is on its way`)
    })

    it('reject and cancel send the problem copy', async () => {
      const a = await seedOnline()
      await subscribe(null, { subscription: sub('w4'), orderCode: a.code })
      await call('barista', 'POST', `/v1/payments/${a.paymentId}/reject`, { reason: 'blurry' })
      expect(sent.at(-1)!.payload.title).toMatch(/^W\d+ · There's a problem with your order$/)

      const b = await seedOnline()
      await subscribe(null, { subscription: sub('w5'), orderCode: b.code })
      sent = []
      await call('owner', 'POST', `/v1/orders/${b.orderId}/cancel`, { reason: 'out of beans' })
      expect(sent).toHaveLength(1)
      expect(sent[0]!.payload.title).toMatch(/^W\d+ · There's a problem with your order$/)
    })

    it('a failed action sends nothing', async () => {
      const o = await seedOnline()
      await subscribe(null, { subscription: sub('w6'), orderCode: o.code })
      await verify(o.paymentId)
      sent = []
      expect((await verify(o.paymentId)).status).toBe(409)
      expect((await call('barista', 'PATCH', `/v1/orders/${o.orderId}`, { staffNote: 'hi' })).status).toBe(200)
      expect(sent).toHaveLength(0)
    })

    it("a 'gone' answer deletes the subscription", async () => {
      const o = await seedOnline()
      const s = sub('g1')
      await subscribe(null, { subscription: s, orderCode: o.code })
      behaviour = () => 'gone'
      expect((await verify(o.paymentId)).status).toBe(200)
      expect(await subRow(s.endpoint)).toBeUndefined()
    })

    it("a 'failed' answer keeps the subscription", async () => {
      const o = await seedOnline()
      const s = sub('f1')
      await subscribe(null, { subscription: s, orderCode: o.code })
      behaviour = () => 'failed'
      expect((await verify(o.paymentId)).status).toBe(200)
      expect(await subRow(s.endpoint)).toBeDefined()
    })

    it('a sender that throws never fails the action', async () => {
      const o = await seedOnline()
      await subscribe(null, { subscription: sub('t1'), orderCode: o.code })
      behaviour = () => 'throw'
      const r = await verify(o.paymentId)
      expect(r.status).toBe(200)
      const [row] = await db.sql`select payment_status from orders where id = ${o.orderId}`
      expect(row!.payment_status).toBe('paid')
    })

    it('a failing post-commit lookup or a throwing defer still returns 200 for verify', async () => {
      const a = await seedOnline()
      await subscribe(null, { subscription: sub('l1'), orderCode: a.code })
      flakyOn = true
      const r = await call('barista', 'POST', `/v1/payments/${a.paymentId}/verify`, undefined, appFlaky)
      expect(r.status).toBe(200)
      expect(r.body).toMatchObject({ paymentStatus: 'paid' })
      expect(sent).toHaveLength(0)

      flakyOn = false
      const b = await seedOnline()
      const r2 = await call('barista', 'POST', `/v1/payments/${b.paymentId}/verify`, undefined, appBadDefer)
      expect(r2.status).toBe(200)
      const r3 = await call('barista', 'PATCH', `/v1/orders/${b.orderId}`, { prepStatus: 'preparing' }, appBadDefer)
      expect(r3.status).toBe(200)
    })

    it('push disabled -> actions still succeed', async () => {
      const o = await seedOnline()
      await subscribe(null, { subscription: sub('n1'), orderCode: o.code })
      const r = await call('barista', 'POST', `/v1/payments/${o.paymentId}/verify`, undefined, appOff)
      expect(r.status).toBe(200)
    })
  })

  describe('new orders', () => {
    const order = {
      name: 'Ana Cruz',
      email: 'ana@x.test',
      phone: '09171234567',
      fulfilment: 'pickup',
      address: '',
      barangay: '',
      fulfilAt: '2026-11-21T04:00:00.000Z',
      gcashReference: 'abc123456',
      note: '',
      lines: [{ menuItemId: '', size: 'M', quantity: 1, modifierIds: [], iceLevel: 'regular', iceServe: 'mixed', note: '' }],
      claimedTotalCentavos: 24500,
    }
    const place = async (who: string | null, target: Hono<AppEnv> = app) => {
      const fd = new FormData()
      fd.set('order', JSON.stringify({ ...order, lines: [{ ...order.lines[0], menuItemId: latteId }] }))
      const bytes = new Uint8Array(64)
      bytes.set([0xff, 0xd8, 0xff, 0xe0])
      fd.set('proof', new File([bytes], 'proof.jpg', { type: 'image/jpeg' }))
      const res = await target.request('/v1/orders', {
        method: 'POST',
        body: fd,
        headers: who ? { Authorization: `Bearer ${tokens[who]}` } : {},
      })
      return { status: res.status, body: (await res.json()) as Body & { orderId?: string } }
    }

    it('alerts every active staff subscription, not inactive staff', async () => {
      await db.sql`delete from push_subscriptions`
      await subscribe('owner', { subscription: sub('o1') })
      await subscribe('barista', { subscription: sub('b1') })
      await db.sql`insert into push_subscriptions (endpoint, p256dh, auth, kind, staff_id)
        values ('https://push.test/former', 'p', 'a', 'staff', ${FORMER})`
      await subscribe(null, { subscription: sub('cust'), orderCode: (await seedOnline()).code })
      sent = []

      const r = await place(null)
      expect(r.status).toBe(201)
      expect(sent.map((s) => s.endpoint).sort()).toEqual([sub('b1').endpoint, sub('o1').endpoint].sort())
      expect(sent[0]!.payload).toEqual({
        title: expect.stringMatching(/^New order W\d+ · ₱245 — check payment$/),
        body: expect.any(String),
        url: '/admin/orders?tab=check',
        tag: `new-order-${r.body.orderCode}`,
      })
      expect(r.body.orderCode).toBeTruthy()
    })

    it('each new order alerts with its own tag', async () => {
      await db.sql`delete from push_subscriptions`
      await subscribe('barista', { subscription: sub('b3') })
      sent = []
      const a = await place(null)
      const b = await place(null)
      const tags = sent.map((s) => s.payload.tag)
      expect(tags).toEqual([`new-order-${a.body.orderCode}`, `new-order-${b.body.orderCode}`])
      expect(tags[0]).not.toBe(tags[1])
    })

    it('a signed-in customer subscribed on order A has order B watched automatically', async () => {
      await db.sql`delete from push_subscriptions`
      const a = await seedOnline(CUSTOMER)
      const s = sub('acct')
      await subscribe('customer', { subscription: s, orderCode: a.code })
      const b = await place('customer')
      expect(b.status).toBe(201)
      const row = await subRow(s.endpoint)
      const watch = await db.sql`select order_id from push_order_watch where subscription_id = ${row!.id}`
      expect(watch.map((w) => w.order_id)).toContain(b.body.orderId)

      sent = []
      const [pay] = await db.sql`select id from payments where order_id = ${b.body.orderId!}`
      await verify(pay!.id)
      expect(sent).toHaveLength(1)
      expect(sent[0]!.endpoint).toBe(s.endpoint)
    })

    it('a guest order does not touch other subscriptions; a failing sender never fails the order', async () => {
      await db.sql`delete from push_subscriptions`
      await subscribe('barista', { subscription: sub('b2') })
      behaviour = () => 'throw'
      const r = await place(null)
      expect(r.status).toBe(201)
      expect(await db.sql`select 1 from push_order_watch where order_id = ${r.body.orderId!}`).toHaveLength(0)
    })

    it('push disabled -> placing an order still works', async () => {
      expect((await place(null, appOff)).status).toBe(201)
    })
  })
})

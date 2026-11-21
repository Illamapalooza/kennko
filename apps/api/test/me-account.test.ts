import { randomUUID } from 'node:crypto'
import { normalisePublicCode, type MeView } from '@kennko/core'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import type { Hono } from 'hono'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { verifierFromJwks, type AppEnv } from '../src/auth.js'
import { createApp } from '../src/create-app.js'
import { publishMenu } from '../src/menu/snapshot.js'
import { fakeAuthAdmin, fakeProofs, inlineDefer, type FakeAuthAdmin } from './fakes.js'
import { startTestDb, type TestDb } from './pg.js'

const ISSUER = 'http://supabase.test/auth/v1'
const NOW = new Date('2026-11-21T02:00:00Z') // 10:00 in Manila
const STAFF = '00000000-0000-4000-8000-0000000000d1'
const DEVICE = '00000000-0000-4000-8000-0000000000d2'
const SHIFT = '00000000-0000-4000-8000-0000000000d3'
const CODE_RE = /^KC-[2-9A-HJKMNP-Z]{3}(-[2-9A-HJKMNP-Z]{3}){2}$/
/** Valid bare codes (check symbol included), for forcing clashes. */
const CODE_A = '23456789A'

type Json = Record<string, unknown>

describe('/v1/me: Kennko card, account and deletion', () => {
  let db: TestDb
  let app: Hono<AppEnv>
  let auth: FakeAuthAdmin
  let sign: (sub: string) => Promise<string>
  let codes: string[]
  let latteId: string
  let ticket = 0

  beforeAll(async () => {
    db = await startTestDb()
    await db.sql
      .unsafe(
        `insert into auth.users (id, email) values ('${STAFF}', 'staff@x.test');
         insert into staff (id, user_id, email, full_name, role, is_active)
           values ('${STAFF}', '${STAFF}', 'staff@x.test', 'Olive', 'owner', true);
         insert into devices (id, name) values ('${DEVICE}', 'Front till');
         insert into shifts (id, device_id, opened_at, opened_by_staff, opening_float_centavos)
           values ('${SHIFT}', '${DEVICE}', '2026-11-21T00:00:00Z', '${STAFF}', 100000);
         insert into delivery_zones (barangay, fee_centavos, latitude, longitude) values ('Libertad', 0, 8.942, 125.529);`,
      )
      .simple()
    const [cat] = await db.sql`insert into menu_categories (name, sort_order) values ('Coffee', 0) returning id`
    const [latte] = await db.sql`insert into menu_items (category_id, name) values (${cat!.id}, 'Latte') returning id`
    latteId = latte!.id as string
    await db.sql`insert into menu_variants (item_id, code, label, price_centavos, temperature)
      values (${latteId}, 'M', 'Medium', 12000, 'iced')`
    await publishMenu(db.sql, null)

    const pair = await generateKeyPair('ES256')
    const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' }
    sign = (sub) =>
      new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
        .setSubject(sub)
        .setIssuer(ISSUER)
        .setAudience('authenticated')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(pair.privateKey)
    auth = fakeAuthAdmin({ [STAFF]: { email: 'staff@x.test', emailConfirmed: true, createdAt: '2026-01-01T00:00:00Z' } })
    codes = []
    app = createApp({
      sql: db.sql,
      verifyUser: verifierFromJwks(createLocalJWKSet({ keys: [jwk] }), ISSUER),
      proofs: fakeProofs(),
      authAdmin: auth,
      push: null,
      defer: inlineDefer,
      now: () => NOW,
      webKey: null,
      publicCode: () => codes.shift() ?? freshCode(),
    })
  })
  afterAll(async () => {
    await db.stop()
  })
  beforeEach(() => {
    codes.length = 0
    auth.failDelete = false
    auth.deleted.length = 0
  })

  // A fresh valid code each call when the test does not force one.
  let codeSeq = 0
  function freshCode(): string {
    const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
    codeSeq += 1
    let n = codeSeq * 7919
    let body = ''
    for (let i = 0; i < 8; i++) {
      body += alphabet[n % 31]
      n = Math.floor(n / 31)
    }
    // Choose the check symbol so the weighted sum is 0 mod 31.
    let sum = 0
    for (let i = 0; i < 8; i++) sum += (i + 1) * alphabet.indexOf(body[i]!)
    for (let c = 0; c < 31; c++) if ((sum + 9 * c) % 31 === 0) return body + alphabet[c]
    throw new Error('unreachable')
  }

  /** A signed-in person with an auth.users row and a fake Auth record. */
  async function person(over: { email?: string; name?: string | null; createdAt?: string } = {}) {
    const id = randomUUID()
    const email = over.email ?? `${id.slice(0, 8)}@x.test`
    await db.sql`insert into auth.users (id, email) values (${id}, ${email})`
    auth.users[id] = { email, emailConfirmed: true, createdAt: over.createdAt ?? '2026-11-10T00:00:00Z', name: over.name ?? null }
    return { id, email, jwt: await sign(id) }
  }

  const call = async (method: string, path: string, jwt?: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, headers: res.headers, body: (text ? JSON.parse(text) : null) as Json }
  }
  const join = (jwt: string, over: Json = {}) =>
    call('POST', '/v1/me/join', jwt, { ageConfirmed: true, privacyVersion: '2026-11', ...over })

  describe('join and view', () => {
    it('GET before joining answers { customer: null }, no-store', async () => {
      const p = await person()
      const r = await call('GET', '/v1/me', p.jwt)
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ customer: null })
      expect(r.headers.get('cache-control')).toBe('no-store')
    })

    it('join creates the card: a valid formatted code, mode none, an empty card, 0 points; a second join is the same', async () => {
      const p = await person({ name: 'Ana Cruz' })
      const r = await join(p.jwt)
      expect(r.status).toBe(200)
      const c = (r.body as MeView).customer!
      expect(c.publicCode).toMatch(CODE_RE)
      expect(normalisePublicCode(c.publicCode)).not.toBeNull()
      expect(c).toMatchObject({ displayName: 'Ana Cruz', stampMode: 'none', card: { stamps: [], fullCards: 0 }, points: 0 })
      expect(c.joinedAt).toBe(NOW.toISOString())
      expect(JSON.stringify(r.body)).not.toContain(p.email)

      const again = await join(p.jwt, { displayName: 'Someone Else' })
      expect(again.status).toBe(200)
      expect(again.body).toEqual(r.body)
      const view = await call('GET', '/v1/me', p.jwt)
      expect(view.body).toEqual(r.body)

      const [row] = await db.sql`select public_code, privacy_version, age_confirmed_at, privacy_accepted_at from customers where id = ${p.id}`
      expect(row).toMatchObject({ public_code: normalisePublicCode(c.publicCode), privacy_version: '2026-11' })
      expect((row!.age_confirmed_at as Date).toISOString()).toBe(NOW.toISOString())
      expect((row!.privacy_accepted_at as Date).toISOString()).toBe(NOW.toISOString())
    })

    it('refuses without ageConfirmed true, or without a privacy version', async () => {
      const p = await person()
      expect((await call('POST', '/v1/me/join', p.jwt, { privacyVersion: '2026-11' })).status).toBe(400)
      expect((await join(p.jwt, { ageConfirmed: false })).status).toBe(400)
      expect((await join(p.jwt, { ageConfirmed: 'yes' })).status).toBe(400)
      expect((await join(p.jwt, { privacyVersion: '' })).status).toBe(400)
      expect((await join(p.jwt, { privacyVersion: 'x'.repeat(21) })).status).toBe(400)
      expect((await call('POST', '/v1/me/join', p.jwt, 'not json')).status).toBe(400)
      const [n] = await db.sql`select count(*)::int as n from customers where id = ${p.id}`
      expect(n!.n).toBe(0)
    })

    it('a taken code twice: the third code is used', async () => {
      const first = await person()
      codes.push(CODE_A)
      expect(((await join(first.jwt)).body as MeView).customer!.publicCode).toBe('KC-234-567-89A')
      const p = await person()
      const third = freshCode()
      codes.push(CODE_A, CODE_A, third)
      const r = await join(p.jwt)
      expect(r.status).toBe(200)
      expect(normalisePublicCode((r.body as MeView).customer!.publicCode)).toBe(third)
    })

    it('display name: given, else the Auth name, else the email local part; trimmed and cut to 40', async () => {
      const given = await person({ name: 'Google Name' })
      expect(((await join(given.jwt, { displayName: '  Ana  ' })).body as MeView).customer!.displayName).toBe('Ana')
      const google = await person({ name: `  ${'G'.repeat(45)} ` })
      expect(((await join(google.jwt)).body as MeView).customer!.displayName).toBe('G'.repeat(40))
      const local = await person({ email: 'bo.santos@x.test', name: null })
      expect(((await join(local.jwt)).body as MeView).customer!.displayName).toBe('bo.santos')
      const tooLong = await person()
      expect((await join(tooLong.jwt, { displayName: 'x'.repeat(41) })).status).toBe(400)
    })

    it('needs a signed-in user', async () => {
      expect((await call('GET', '/v1/me')).status).toBe(401)
      expect((await call('POST', '/v1/me/join', undefined, { ageConfirmed: true, privacyVersion: '1' })).status).toBe(401)
    })

    it('shows stamps, full cards and points; a paper customer has no card', async () => {
      const p = await person()
      await join(p.jwt)
      const order = await counterOrder(p.id)
      const [card] = await db.sql`insert into stamp_cards (customer_id, started_at) values (${p.id}, ${NOW}) returning id`
      await db.sql`insert into stamps (id, customer_id, card_id, order_id, stamped_at, received_at)
        values (${randomUUID()}, ${p.id}, ${card!.id}, ${order}, '2026-11-21T01:00:00Z', ${NOW})`
      await db.sql`insert into points_ledger (customer_id, delta, reason, order_id, created_at) values (${p.id}, 12, 'order', ${order}, ${NOW})`
      await db.sql`update customers set stamp_mode = 'digital' where id = ${p.id}`
      const r = (await call('GET', '/v1/me', p.jwt)).body as MeView
      expect(r.customer).toMatchObject({
        stampMode: 'digital',
        card: { stamps: [{ stampedAt: '2026-11-21T01:00:00.000Z' }], fullCards: 0 },
        points: 12,
      })
      await db.sql`update customers set stamp_mode = 'paper' where id = ${p.id}`
      expect(((await call('GET', '/v1/me', p.jwt)).body as MeView).customer).toMatchObject({ stampMode: 'paper', card: null, points: 12 })
    })
  })

  describe('rename', () => {
    it('renames; 41 characters or a blank name is 400; no card is 404 NOT_JOINED', async () => {
      const p = await person()
      const none = await call('PATCH', '/v1/me', p.jwt, { displayName: 'Ana' })
      expect(none.status).toBe(404)
      expect(none.body.code).toBe('NOT_JOINED')
      await join(p.jwt)
      const r = await call('PATCH', '/v1/me', p.jwt, { displayName: '  Ana B  ' })
      expect(r.status).toBe(200)
      expect((r.body as MeView).customer!.displayName).toBe('Ana B')
      expect((await call('PATCH', '/v1/me', p.jwt, { displayName: 'x'.repeat(41) })).status).toBe(400)
      expect((await call('PATCH', '/v1/me', p.jwt, { displayName: '   ' })).status).toBe(400)
      expect((await call('PATCH', '/v1/me', p.jwt, {})).status).toBe(400)
    })
  })

  async function counterOrder(customerId: string | null) {
    ticket += 1
    const [o] = await db.sql`
      insert into orders (channel, fulfilment, business_day, ticket_series, ticket_number, customer_name,
        prep_status, payment_status, subtotal_centavos, discount_centavos, delivery_fee_centavos, total_centavos,
        device_id, shift_id, customer_id)
      values ('counter', 'dine_in', '2026-11-21', 'C', ${ticket}, 'Walk-in', 'completed', 'paid',
        12000, 0, 0, 12000, ${DEVICE}, ${SHIFT}, ${customerId})
      returning id`
    return o!.id as string
  }

  let onlineSeq = 0
  async function onlineOrder(o: { userId?: string | null; customerId?: string | null; email: string; createdAt: string }) {
    onlineSeq += 1
    const [row] = await db.sql`
      insert into orders (channel, order_code, fulfilment, prep_status, payment_status, business_day,
        ticket_series, ticket_number, customer_name, customer_phone, customer_email, customer_user_id, customer_id,
        fulfil_at, subtotal_centavos, total_centavos, created_at, updated_at)
      values ('online', ${`KNK-ME${String(onlineSeq).padStart(3, '0')}`}, 'pickup', 'completed', 'paid', '2026-11-21',
        'W', ${500 + onlineSeq}, 'Ana', '09170000000', ${o.email}, ${o.userId ?? null}, ${o.customerId ?? null},
        ${o.createdAt}, 15000, 15000, ${o.createdAt}, ${o.createdAt})
      returning id, order_code`
    return { id: row!.id as string, code: row!.order_code as string }
  }

  /** Two cards (one full, one open), 9 stamps, ledger rows, a counter and an online order, and a push subscription. */
  async function seedMember() {
    const p = await person()
    await join(p.jwt)
    const counter = await counterOrder(p.id)
    const online = await onlineOrder({ userId: p.id, customerId: p.id, email: p.email, createdAt: '2026-11-20T00:00:00Z' })
    const [full] = await db.sql`insert into stamp_cards (customer_id, started_at, filled_at) values (${p.id}, ${NOW}, ${NOW}) returning id`
    const [open] = await db.sql`insert into stamp_cards (customer_id, started_at) values (${p.id}, ${NOW}) returning id`
    for (let i = 0; i < 9; i++) {
      const orderId = i === 0 ? counter : i === 1 ? online.id : await counterOrder(p.id)
      await db.sql`insert into stamps (id, customer_id, card_id, order_id, stamped_at, received_at)
        values (${randomUUID()}, ${p.id}, ${i < 8 ? full!.id : open!.id}, ${orderId}, ${NOW}, ${NOW})`
    }
    await db.sql`insert into points_ledger (customer_id, delta, reason, order_id, created_at)
      values (${p.id}, 12, 'order', ${counter}, ${NOW}), (${p.id}, 15, 'order', ${online.id}, ${NOW})`
    await db.sql`insert into points_ledger (customer_id, delta, reason, note, created_by_staff, created_at)
      values (${p.id}, 3, 'adjustment', 'Welcome', ${STAFF}, ${NOW})`
    const [sub] = await db.sql`insert into push_subscriptions (endpoint, p256dh, auth, kind, customer_user_id)
      values (${`https://push.test/${p.id}`}, 'p', 'a', 'customer', ${p.id}) returning id`
    await db.sql`insert into push_order_watch (order_id, subscription_id) values (${online.id}, ${sub!.id})`
    return { ...p, counter, online: online.id }
  }

  async function leftovers(id: string) {
    const [r] = await db.sql`
      select
        (select count(*)::int from customers where id = ${id}) as customers,
        (select count(*)::int from stamp_cards where customer_id = ${id}) as cards,
        (select count(*)::int from stamps where customer_id = ${id}) as stamps,
        (select count(*)::int from points_ledger where customer_id = ${id}) as ledger,
        (select count(*)::int from orders where customer_id = ${id} or customer_user_id = ${id}) as orders,
        (select count(*)::int from push_subscriptions where customer_user_id = ${id}) as subs,
        (select count(*)::int from cats where customer_id = ${id}) as cats,
        (select count(*)::int from customer_cosmetics where customer_id = ${id}) as cosmetics,
        (select count(*)::int from visits where customer_id = ${id}) as visits`
    return r
  }

  const NONE_LEFT = { customers: 0, cards: 0, stamps: 0, ledger: 0, orders: 0, subs: 0, cats: 0, cosmetics: 0, visits: 0 }

  describe('account deletion', () => {
    it('account deletion leaving no row that points to the person', async () => {
      const m = await seedMember()
      expect(await leftovers(m.id)).toEqual({ customers: 1, cards: 2, stamps: 9, ledger: 3, orders: 9, subs: 1, cats: 1, cosmetics: 0, visits: 0 })

      const r = await call('DELETE', '/v1/me', m.jwt, { confirm: 'DELETE' })
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ deleted: true })
      expect(await leftovers(m.id)).toEqual(NONE_LEFT)
      expect(auth.deleted).toEqual([m.id])

      // The sales stay, with their totals.
      const kept = await db.sql`select id, total_centavos from orders where id in ${db.sql([m.counter, m.online])} order by total_centavos`
      expect(kept.map((o) => o.total_centavos)).toEqual([12000, 15000])
    })

    it('a cat, a bought and worn cosmetic and a visit leave no row either', async () => {
      const m = await seedMember()
      // 30 points in the ledger: 12 + 15 + 3. The bandana costs 30.
      const [bandana] = await db.sql`select id from cosmetics where key = 'bandana'`
      expect((await call('POST', `/v1/me/cosmetics/${bandana!.id}/buy`, m.jwt)).status).toBe(200)
      const worn = await call('PUT', '/v1/me/cat', m.jwt, { name: 'Biko', look: { coat: 'black', neck: 'bandana' }, showOnWall: true })
      expect(worn.status).toBe(200)
      await db.sql`insert into visits (customer_id, visit_key, source, started_at, ends_at)
        values (${m.id}, ${randomUUID()}, 'checkin', ${NOW}, '2026-11-21T03:30:00Z')`
      expect(await leftovers(m.id)).toEqual({ customers: 1, cards: 2, stamps: 9, ledger: 4, orders: 9, subs: 1, cats: 1, cosmetics: 1, visits: 1 })

      expect((await call('DELETE', '/v1/me', m.jwt, { confirm: 'DELETE' })).status).toBe(200)
      expect(await leftovers(m.id)).toEqual(NONE_LEFT)
      // The catalogue item stays.
      const [still] = await db.sql`select count(*)::int as n from cosmetics where key = 'bandana'`
      expect(still!.n).toBe(1)
    })

    it('a person without a card can delete their login too', async () => {
      const p = await person()
      const guest = await onlineOrder({ userId: p.id, email: p.email, createdAt: '2026-11-20T00:00:00Z' })
      const r = await call('DELETE', '/v1/me', p.jwt, { confirm: 'DELETE' })
      expect(r.status).toBe(200)
      expect(auth.deleted).toEqual([p.id])
      const [o] = await db.sql`select customer_user_id from orders where id = ${guest.id}`
      expect(o!.customer_user_id).toBeNull()
    })

    it('needs { confirm: "DELETE" }', async () => {
      const m = await seedMember()
      expect((await call('DELETE', '/v1/me', m.jwt)).status).toBe(400)
      expect((await call('DELETE', '/v1/me', m.jwt, { confirm: 'delete' })).status).toBe(400)
      expect((await call('DELETE', '/v1/me', m.jwt, {})).status).toBe(400)
      expect((await leftovers(m.id))!.customers).toBe(1)
      expect(auth.deleted).toEqual([])
    })

    it('Auth failing: 502 AUTH_DELETE_FAILED with the card data already gone; a retry is 200', async () => {
      const m = await seedMember()
      auth.failDelete = true
      const r = await call('DELETE', '/v1/me', m.jwt, { confirm: 'DELETE' })
      expect(r.status).toBe(502)
      expect(r.body.code).toBe('AUTH_DELETE_FAILED')
      expect(await leftovers(m.id)).toEqual(NONE_LEFT)

      auth.failDelete = false
      const retry = await call('DELETE', '/v1/me', m.jwt, { confirm: 'DELETE' })
      expect(retry.status).toBe(200)
      expect(auth.deleted).toEqual([m.id, m.id])
    })

    it('a staff login is refused with 409 IS_STAFF and nothing is deleted', async () => {
      const staffJwt = await sign(STAFF)
      await join(staffJwt)
      const r = await call('DELETE', '/v1/me', staffJwt, { confirm: 'DELETE' })
      expect(r.status).toBe(409)
      expect(r.body.code).toBe('IS_STAFF')
      expect((await leftovers(STAFF))!.customers).toBe(1)
      expect(auth.deleted).toEqual([])
    })
  })

  describe('history only after sign-up (Ruling 1)', () => {
    it('re-signup never re-attaches: a guest order from before the login was created is not listed', async () => {
      const p = await person({ email: 'ana@x.test', createdAt: '2026-11-15T00:00:00Z' })
      const before = await onlineOrder({ email: 'ana@x.test', createdAt: '2026-11-14T23:59:59Z' })
      const after = await onlineOrder({ email: 'ANA@x.test', createdAt: '2026-11-15T00:00:01Z' })
      const r = await call('GET', '/v1/me/orders', p.jwt)
      expect(r.status).toBe(200)
      const orders = r.body.orders as { orderCode: string; claimedByEmail: boolean }[]
      expect(orders.map((o) => o.orderCode)).toEqual([after.code])
      expect(orders[0]!.claimedByEmail).toBe(true)
      expect(orders.map((o) => o.orderCode)).not.toContain(before.code)
    })

    it('no created_at from Auth: only orders placed while signed in', async () => {
      const p = await person({ email: 'cy@x.test' })
      auth.users[p.id] = { ...auth.users[p.id]!, createdAt: null }
      const own = await onlineOrder({ userId: p.id, email: 'cy@x.test', createdAt: '2026-11-20T00:00:00Z' })
      await onlineOrder({ email: 'cy@x.test', createdAt: '2026-11-20T00:00:01Z' })
      const orders = (await call('GET', '/v1/me/orders', p.jwt)).body.orders as { orderCode: string }[]
      expect(orders.map((o) => o.orderCode)).toEqual([own.code])
    })
  })

  describe('checkout links the card (Ruling 9)', () => {
    const order = () => ({
      name: 'Ana Cruz',
      email: 'ana.checkout@x.test',
      phone: '09171234567',
      fulfilment: 'pickup',
      address: '',
      barangay: '',
      fulfilAt: '2026-11-21T04:00:00.000Z',
      gcashReference: 'abc123456',
      note: '',
      lines: [{ menuItemId: latteId, size: 'M', quantity: 1, modifierIds: [], iceLevel: 'regular', iceServe: 'mixed', note: '' }],
      claimedTotalCentavos: 12000,
    })
    const checkout = async (jwt?: string) => {
      const fd = new FormData()
      fd.set('order', JSON.stringify(order()))
      const proof = new Uint8Array(64)
      proof.set([0xff, 0xd8, 0xff, 0xe0])
      fd.set('proof', new File([proof], 'proof.jpg', { type: 'image/jpeg' }))
      const res = await app.request('/v1/orders', { method: 'POST', body: fd, headers: jwt ? { Authorization: `Bearer ${jwt}` } : {} })
      const text = await res.text()
      expect(res.status, text).toBe(201)
      const id = (JSON.parse(text) as { orderId: string }).orderId
      const [o] = await db.sql`select customer_id, customer_user_id from orders where id = ${id}`
      return o!
    }

    it('signed in with a card: customer_id set; without a card: null; a guest: null', async () => {
      const member = await person()
      await join(member.jwt)
      expect(await checkout(member.jwt)).toEqual({ customer_id: member.id, customer_user_id: member.id })
      const plain = await person()
      expect(await checkout(plain.jwt)).toEqual({ customer_id: null, customer_user_id: plain.id })
      expect(await checkout()).toEqual({ customer_id: null, customer_user_id: null })
    })
  })
})

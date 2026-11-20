import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import type { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/create-app.js'
import { verifierFromJwks, type AppEnv } from '../src/auth.js'
import { fakeAuthAdmin, fakeProofs, inlineDefer, type FakeAuthAdmin } from './fakes.js'
import { startTestDb, type TestDb } from './pg.js'

const ISSUER = 'http://supabase.test/auth/v1'
const STAFF = '00000000-0000-4000-8000-0000000000b1'
const ANA = '00000000-0000-4000-8000-0000000000c1'
const BO = '00000000-0000-4000-8000-0000000000c2'
const MANY = '00000000-0000-4000-8000-0000000000c3'
const GHOST = '00000000-0000-4000-8000-0000000000c4'
const DEVICE = '00000000-0000-4000-8000-0000000000f1'

// Seeded on every order: none of these may ever appear in a public response.
const EMAIL = 'secret.customer@x.test'
const PHONE = '09179998877'
const PROOF = 'proofs/KNK-LEAK/proof-path.jpg'
const STAFF_NOTE = 'STAFF-ONLY-NOTE'
const GCASH_REF = 'GCASHREF-777'

const PUBLIC_KEYS = [
  'cancelled', 'deliveryAddress', 'fulfilAt', 'fulfilment', 'lines', 'orderCode', 'paymentStatus',
  'prepStatus', 'ticket', 'totalCentavos',
]
const PUBLIC_LINE_KEYS = ['iceLevel', 'iceServe', 'name', 'quantity', 'variantLabel']
const RECEIPT_ORDER_KEYS = [
  'cancelledAt', 'customerName', 'deliveryAddress', 'deliveryBarangay', 'deliveryFeeCentavos',
  'discountCentavos', 'fulfilment', 'lines', 'orderCode', 'payment', 'paymentStatus', 'prepStatus',
  'subtotalCentavos', 'ticket', 'totalCentavos',
]
const RECEIPT_LINE_KEYS = ['itemName', 'lineTotalCentavos', 'options', 'quantity', 'unitPriceCentavos', 'variantLabel']
const SHOP_KEYS = ['address', 'displayName', 'facebookUrl', 'phone', 'receiptFooter', 'registeredName', 'tin']
const HISTORY_KEYS = [
  'cancelled', 'claimedByEmail', 'createdAt', 'deliveryAddress', 'deliveryFeeCentavos', 'fulfilAt', 'fulfilment',
  'id', 'lines', 'orderCode', 'paymentStatus', 'prepStatus', 'subtotalCentavos', 'ticket', 'totalCentavos',
]
const HISTORY_LINE_KEYS = ['iceLevel', 'iceServe', 'name', 'note', 'options', 'quantity', 'variantCode', 'variantLabel']

type Json = Record<string, unknown>
type Lines = Json[]

describe('order page, receipt and customer history reads', () => {
  let db: TestDb
  let app: Hono<AppEnv>
  let auth: FakeAuthAdmin
  let tokens: Record<string, string>
  let seq = 0
  let zoneId: string

  beforeAll(async () => {
    db = await startTestDb()
    await db.sql
      .unsafe(
        `insert into auth.users (id, email) values ('${STAFF}', 's@x.test'), ('${ANA}', 'ana@x.test'),
           ('${BO}', 'bo@x.test'), ('${MANY}', 'many@x.test');
         insert into staff (id, user_id, email, full_name, role, is_active) values
           ('${STAFF}', '${STAFF}', 's@x.test', 'Verifier', 'barista', true);`,
      )
      .simple()
    await db.sql`insert into devices (id, name) values (${DEVICE}, 'Front till')`
    const [zone] = await db.sql`insert into delivery_zones (barangay, fee_centavos, latitude, longitude)
      values ('Libertad', 3000, 8.942, 125.529) returning id`
    zoneId = zone!.id as string

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
    tokens = { ana: await sign(ANA), many: await sign(MANY), ghost: await sign(GHOST) }
    auth = fakeAuthAdmin({
      [ANA]: { email: 'ana@x.test', emailConfirmed: true },
      [MANY]: { email: 'many@x.test', emailConfirmed: true },
    })
    app = createApp({
      sql: db.sql,
      verifyUser: verifierFromJwks(createLocalJWKSet({ keys: [jwk] }), ISSUER),
      proofs: fakeProofs(),
      authAdmin: auth,
      push: null,
      defer: inlineDefer,
      now: () => new Date('2026-11-21T02:00:00Z'),
    })
  })
  afterAll(async () => {
    await db.stop()
  })

  type Seed = {
    userId?: string | null
    email?: string
    createdAt?: string
    delivery?: boolean
    prep?: string
    payment?: string
    cancelledAt?: string | null
  }

  /** An online order with every private field filled, one line with an option, and a verified payment. */
  async function seedOnline(s: Seed = {}) {
    seq += 1
    const code = `KNK-R${String(seq).padStart(3, '0')}`
    const delivery = s.delivery ?? false
    const created = s.createdAt ?? new Date(Date.UTC(2026, 10, 1, 0, seq)).toISOString()
    const [o] = await db.sql`
      insert into orders (channel, order_code, fulfilment, prep_status, payment_status, business_day,
        ticket_series, ticket_number, customer_name, customer_phone, customer_email, customer_user_id, fulfil_at,
        subtotal_centavos, delivery_fee_centavos, total_centavos, delivery_address, delivery_barangay,
        delivery_zone_id, staff_note, cancelled_at, created_at, updated_at)
      values ('online', ${code}, ${delivery ? 'delivery' : 'pickup'}, ${s.prep ?? 'preparing'}, ${s.payment ?? 'paid'},
        '2026-11-21', 'W', ${seq}, 'Ana Cruz', ${PHONE}, ${s.email ?? EMAIL}, ${s.userId ?? null},
        '2026-11-21T04:00:00Z', 12000, ${delivery ? 3000 : 0}, ${delivery ? 15000 : 12000},
        ${delivery ? '1 Gate St' : null}, ${delivery ? 'Libertad' : null}, ${delivery ? zoneId : null}, ${STAFF_NOTE}, ${s.cancelledAt ?? null},
        ${created}, ${created})
      returning id`
    const id = o!.id as string
    const [l] = await db.sql`
      insert into order_lines (order_id, item_name, variant_code, variant_label, unit_price_centavos, quantity,
        line_total_centavos, ice_level, ice_serve, note)
      values (${id}, 'Latte', 'M', 'Medium', 10000, 1, 12000, 'less', 'side', 'extra hot') returning id`
    await db.sql`insert into order_line_options (line_id, group_name, option_name, price_centavos)
      values (${l!.id}, 'Milk of Choice', 'Oat milk', 2000)`
    await db.sql`
      insert into payments (order_id, method, amount_centavos, reference, proof_path, status, verified_by, verified_at)
      values (${id}, 'gcash', ${delivery ? 15000 : 12000}, ${GCASH_REF}, ${PROOF}, 'verified', ${STAFF}, '2026-11-21T03:00:00Z')`
    return { id, code }
  }

  const get = async (path: string, token?: string) => {
    const res = await app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    const text = await res.text()
    return { status: res.status, text, headers: res.headers, body: JSON.parse(text) as Json }
  }
  const sortedKeys = (o: unknown) => Object.keys(o as Json).sort()

  describe('GET /v1/orders/by-code/:code', () => {
    it('returns exactly the order page fields, with no-store', async () => {
      const { code } = await seedOnline({ delivery: true })
      const r = await get(`/v1/orders/by-code/${code}`)
      expect(r.status).toBe(200)
      expect(r.headers.get('cache-control')).toBe('no-store')
      expect(sortedKeys(r.body)).toEqual(PUBLIC_KEYS)
      const lines = r.body.lines as Lines
      expect(lines).toHaveLength(1)
      expect(sortedKeys(lines[0])).toEqual(PUBLIC_LINE_KEYS)
      expect(r.body).toMatchObject({
        orderCode: code,
        ticket: `W${seq}`,
        prepStatus: 'preparing',
        paymentStatus: 'paid',
        cancelled: false,
        fulfilment: 'delivery',
        totalCentavos: 15000,
        deliveryAddress: '1 Gate St',
        lines: [{ name: 'Latte', variantLabel: 'Medium', quantity: 1, iceLevel: 'less', iceServe: 'side' }],
      })
      expect(new Date(r.body.fulfilAt as string).toISOString()).toBe('2026-11-21T04:00:00.000Z')
    })

    it('never carries the email, phone, proof path, staff note, GCash reference or verifier', async () => {
      const { code } = await seedOnline()
      const r = await get(`/v1/orders/by-code/${code}`)
      for (const secret of [EMAIL, PHONE, PROOF, STAFF_NOTE, GCASH_REF, STAFF]) expect(r.text).not.toContain(secret)
    })

    it('reads a lower-case code and reports a cancelled order', async () => {
      const { code } = await seedOnline({ prep: 'cancelled', cancelledAt: '2026-11-21T03:30:00Z' })
      const r = await get(`/v1/orders/by-code/${code.toLowerCase()}`)
      expect(r.status).toBe(200)
      expect(r.body).toMatchObject({ orderCode: code, cancelled: true, prepStatus: 'cancelled' })
    })

    it('answers 404 NOT_FOUND for an unknown code', async () => {
      const r = await get('/v1/orders/by-code/KNK-NOPE99')
      expect(r.status).toBe(404)
      expect(r.body.code).toBe('NOT_FOUND')
    })

    it('never reaches a counter order, by id or otherwise', async () => {
      seq += 1
      const [o] = await db.sql`
        insert into orders (channel, fulfilment, customer_name, prep_status, payment_status, business_day,
          ticket_series, ticket_number, subtotal_centavos, total_centavos, device_id)
        values ('counter', 'dine_in', 'Walk-in', 'preparing', 'paid', '2026-11-21', 'C', ${seq}, 5000, 5000, ${DEVICE})
        returning id`
      expect((await get(`/v1/orders/by-code/${o!.id as string}`)).status).toBe(404)
      expect((await get(`/v1/orders/by-code/${o!.id as string}/receipt`)).status).toBe(404)
    })
  })

  describe('GET /v1/orders/by-code/:code/receipt', () => {
    it('pins every key list and carries the shop_settings row', async () => {
      const { code } = await seedOnline({ delivery: true })
      const r = await get(`/v1/orders/by-code/${code}/receipt`)
      expect(r.status).toBe(200)
      expect(r.headers.get('cache-control')).toBe('no-store')
      expect(sortedKeys(r.body)).toEqual(['order', 'shop'])
      const order = r.body.order as Json
      expect(sortedKeys(order)).toEqual(RECEIPT_ORDER_KEYS)
      const lines = order.lines as Lines
      expect(sortedKeys(lines[0])).toEqual(RECEIPT_LINE_KEYS)
      expect(sortedKeys((lines[0]!.options as Lines)[0])).toEqual(['name', 'priceCentavos'])
      expect(sortedKeys(order.payment)).toEqual(['reference', 'verifiedAt'])
      expect(order).toMatchObject({
        orderCode: code,
        customerName: 'Ana Cruz',
        deliveryBarangay: 'Libertad',
        subtotalCentavos: 12000,
        discountCentavos: 0,
        deliveryFeeCentavos: 3000,
        totalCentavos: 15000,
        cancelledAt: null,
        payment: { reference: GCASH_REF },
        lines: [{ itemName: 'Latte', unitPriceCentavos: 10000, lineTotalCentavos: 12000, options: [{ name: 'Oat milk', priceCentavos: 2000 }] }],
      })

      const shop = r.body.shop as Json
      expect(sortedKeys(shop)).toEqual(SHOP_KEYS)
      const [row] = await db.sql`select display_name, address, receipt_footer from shop_settings where id = 1`
      expect(shop).toMatchObject({ displayName: row!.display_name, address: row!.address, receiptFooter: row!.receipt_footer })
    })

    it('never carries the email, phone, proof path, staff note or verifier', async () => {
      const { code } = await seedOnline()
      const r = await get(`/v1/orders/by-code/${code}/receipt`)
      for (const secret of [EMAIL, PHONE, PROOF, STAFF_NOTE, STAFF]) expect(r.text).not.toContain(secret)
    })

    it('shows the verified payment when an earlier one was rejected', async () => {
      const { id, code } = await seedOnline()
      await db.sql`update payments set status = 'rejected', reference = 'REJECTED-REF', verified_at = null,
        verified_by = null, recorded_at = '2026-11-21T01:00:00Z' where order_id = ${id}`
      await db.sql`insert into payments (order_id, method, amount_centavos, reference, status, verified_at, recorded_at)
        values (${id}, 'gcash', 12000, 'VERIFIED-REF', 'verified', '2026-11-21T03:00:00Z', '2026-11-21T02:00:00Z')`
      const r = await get(`/v1/orders/by-code/${code}/receipt`)
      const payment = (r.body.order as Json).payment as Json
      expect(payment.reference).toBe('VERIFIED-REF')
      expect(new Date(payment.verifiedAt as string).toISOString()).toBe('2026-11-21T03:00:00.000Z')
    })

    it('falls back to the newest non-rejected payment, and is null with none', async () => {
      const { id, code } = await seedOnline({ payment: 'pending_verification' })
      await db.sql`update payments set status = 'pending_verification', verified_at = null, verified_by = null where order_id = ${id}`
      let payment = ((await get(`/v1/orders/by-code/${code}/receipt`)).body.order as Json).payment as Json
      expect(payment).toEqual({ reference: GCASH_REF, verifiedAt: null })

      const other = await seedOnline({ payment: 'unpaid' })
      await db.sql`delete from payments where order_id = ${other.id}`
      payment = ((await get(`/v1/orders/by-code/${other.code}/receipt`)).body.order as Json).payment as Json
      expect(payment).toBeNull()
    })

    it('lists lines in the order they were rung up', async () => {
      const { id, code } = await seedOnline()
      // Later timestamps, names out of alphabetical order, so neither id nor name order can pass by luck.
      for (const [name, at] of [['Zebra cake', '2030-01-01T00:00:01Z'], ['Americano', '2030-01-01T00:00:02Z'], ['Mocha', '2030-01-01T00:00:03Z']]) {
        await db.sql`insert into order_lines (order_id, item_name, variant_code, variant_label, unit_price_centavos,
          quantity, line_total_centavos, created_at) values (${id}, ${name!}, 'M', 'Medium', 0, 1, 0, ${at!})`
      }
      const lines = ((await get(`/v1/orders/by-code/${code}/receipt`)).body.order as Json).lines as Lines
      expect(lines.map((l) => l.itemName)).toEqual(['Latte', 'Zebra cake', 'Americano', 'Mocha'])
    })

    it('answers 404 for an unknown code and shop null when the settings row is missing', async () => {
      expect((await get('/v1/orders/by-code/KNK-NOPE99/receipt')).status).toBe(404)
      const { code } = await seedOnline()
      await db.sql`delete from shop_settings where id = 1`
      try {
        const r = await get(`/v1/orders/by-code/${code}/receipt`)
        expect(r.status).toBe(200)
        expect(r.body.shop).toBeNull()
      } finally {
        await db.sql`insert into shop_settings (display_name, address) values ('Kennko Coffee', 'Butuan City')`
      }
    })
  })

  describe('GET /v1/me/orders', () => {
    it('returns her own order and her confirmed guest order (claimed by email), never someone else’s', async () => {
      const own = await seedOnline({ userId: ANA, email: 'ana@x.test' })
      const guest = await seedOnline({ userId: null, email: 'ANA@x.test' })
      const theirs = await seedOnline({ userId: BO, email: 'bo@x.test' })
      const r = await get('/v1/me/orders', tokens.ana)
      expect(r.status).toBe(200)
      expect(sortedKeys(r.body)).toEqual(['orders'])
      const orders = r.body.orders as Json[]
      const ids = orders.map((o) => o.id)
      expect(ids).toEqual([guest.id, own.id])
      expect(ids).not.toContain(theirs.id)
      expect(orders[0]!.claimedByEmail).toBe(true)
      expect(orders[1]!.claimedByEmail).toBe(false)
      expect(auth.lookups).toContain(ANA)

      expect(sortedKeys(orders[0])).toEqual(HISTORY_KEYS)
      const line = (orders[0]!.lines as Lines)[0]
      expect(sortedKeys(line)).toEqual(HISTORY_LINE_KEYS)
      expect(line).toEqual({
        name: 'Latte', variantCode: 'M', variantLabel: 'Medium', quantity: 1,
        iceLevel: 'less', iceServe: 'side', note: 'extra hot', options: ['Oat milk'],
      })
      for (const secret of [PHONE, PROOF, STAFF_NOTE, GCASH_REF, STAFF]) expect(r.text).not.toContain(secret)
    })

    it('returns only her own order while the address is unconfirmed', async () => {
      auth.users[ANA] = { email: 'ana@x.test', emailConfirmed: false }
      try {
        const r = await get('/v1/me/orders', tokens.ana)
        const orders = r.body.orders as Json[]
        expect(orders.length).toBeGreaterThan(0)
        expect(orders.every((o) => o.claimedByEmail === false)).toBe(true)
      } finally {
        auth.users[ANA] = { email: 'ana@x.test', emailConfirmed: true }
      }
    })

    it('caps at the newest 50', async () => {
      const seeded: string[] = []
      for (let i = 0; i < 51; i += 1) {
        const { id } = await seedOnline({ userId: MANY, email: 'many@x.test', createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() })
        seeded.push(id)
      }
      const orders = (await get('/v1/me/orders', tokens.many)).body.orders as Json[]
      expect(orders.map((o) => o.id)).toEqual(seeded.slice(1).reverse())
    })

    it('answers 401 without a valid token, 401 for an unknown user, 503 when Auth is down', async () => {
      const none = await get('/v1/me/orders')
      expect([none.status, none.body.code]).toEqual([401, 'UNAUTHENTICATED'])
      expect((await get('/v1/me/orders', 'not-a-jwt')).status).toBe(401)

      const ghost = await get('/v1/me/orders', tokens.ghost)
      expect([ghost.status, ghost.body.code]).toEqual([401, 'UNAUTHENTICATED'])

      auth.failGetUser = true
      try {
        const down = await get('/v1/me/orders', tokens.ana)
        expect([down.status, down.body.code]).toEqual([503, 'AUTH_UNAVAILABLE'])
      } finally {
        auth.failGetUser = false
      }
    })
  })
})

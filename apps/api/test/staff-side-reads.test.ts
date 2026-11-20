import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import type { Hono } from 'hono'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaymentNotice } from '@kennko/core'
import { createApp, type AppDeps } from '../src/create-app.js'
import { verifierFromJwks, type AppEnv } from '../src/auth.js'
import { fakeAuthAdmin, fakeProofs, inlineDefer, type FakeAuthAdmin } from './fakes.js'
import { startTestDb, type TestDb } from './pg.js'

const ISSUER = 'http://supabase.test/auth/v1'
const OWNER = '00000000-0000-4000-8000-0000000000b1'
const BARISTA = '00000000-0000-4000-8000-0000000000b2'
const OLD_OWNER = '00000000-0000-4000-8000-0000000000b3'
const NO_EMAIL = '00000000-0000-4000-8000-0000000000b4'
const UNCONFIRMED = '00000000-0000-4000-8000-0000000000b5'
const MIA = '00000000-0000-4000-8000-0000000000b6'
const WEB_KEY = 'k'.repeat(40)
const AT = '2026-11-21T02:00:00.000Z'

describe('staff-side reads: proofs, customer-email data, alert list, invites', () => {
  let db: TestDb
  let auth: FakeAuthAdmin
  let base: Omit<AppDeps, 'webKey'>
  let app: Hono<AppEnv>
  let ownerJwt: string
  let baristaJwt: string
  let paidPayment: string
  let rejectedPayment: string
  let noProofPayment: string
  let guestPayment: string

  beforeAll(async () => {
    db = await startTestDb()
    const { publicKey, privateKey } = await generateKeyPair('ES256')
    const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' }
    const sign = (sub: string) =>
      new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
        .setSubject(sub)
        .setIssuer(ISSUER)
        .setAudience('authenticated')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(privateKey)
    ownerJwt = await sign(OWNER)
    baristaJwt = await sign(BARISTA)
    auth = fakeAuthAdmin()
    base = {
      sql: db.sql,
      verifyUser: verifierFromJwks(createLocalJWKSet({ keys: [jwk] }), ISSUER),
      proofs: fakeProofs(),
      authAdmin: auth,
      push: null,
      defer: inlineDefer,
      now: () => new Date(AT),
    }
    app = createApp({ ...base, webKey: WEB_KEY })

    await db.sql
      .unsafe(
        `insert into auth.users (id, email) values
           ('${OWNER}', 'o@x.test'), ('${BARISTA}', 'b@x.test'), ('${OLD_OWNER}', 'old@x.test'),
           ('${NO_EMAIL}', null), ('${UNCONFIRMED}', 'u@x.test');
         insert into staff (id, user_id, email, full_name, role, is_active, created_at) values
           ('${OWNER}', '${OWNER}', 'o@x.test', 'Owner', 'owner', true, '2026-01-01T00:00:00Z'),
           ('${BARISTA}', '${BARISTA}', null, 'Barista', 'barista', true, '2026-01-02T00:00:00Z'),
           ('${OLD_OWNER}', '${OLD_OWNER}', 'old@x.test', 'Old Owner', 'owner', false, '2026-01-03T00:00:00Z'),
           ('${MIA}', null, 'mia@x.test', 'Mia', 'manager', true, '2026-01-04T00:00:00Z');`,
      )
      .simple()

    const [cat] = await db.sql`insert into menu_categories (name, sort_order) values ('Coffee', 0) returning id`
    const [item] = await db.sql`insert into menu_items (category_id, name) values (${cat!.id}, 'Latte') returning id`

    const [zone] = await db.sql`insert into delivery_zones (barangay, fee_centavos, latitude, longitude)
      values ('Libertad', 5000, 8.942, 125.529) returning id`
    // A delivery order: a rejected first payment, then a verified one (the receipt's live payment).
    const [o] = await db.sql`
      insert into orders (channel, order_code, fulfilment, prep_status, payment_status, business_day,
        ticket_series, ticket_number, customer_name, customer_phone, customer_email, fulfil_at,
        delivery_address, delivery_barangay, delivery_zone_id, subtotal_centavos, delivery_fee_centavos, total_centavos, created_at, updated_at)
      values ('online', 'KNK-NOTE1', 'delivery', 'preparing', 'paid', '2026-11-21', 'W', 960, 'Ana Cruz', '09171234567',
        'ana@x.test', '2026-11-21T04:00:00Z', '1 Gate St, Libertad', 'Libertad', ${zone!.id}, 24000, 5000, 29000, ${AT}, ${AT})
      returning id`
    await db.sql`
      insert into order_lines (order_id, item_id, item_name, variant_code, variant_label, unit_price_centavos,
        quantity, line_total_centavos, created_at)
      values
        (${o!.id}, ${item!.id}, 'Latte', 'M', 'Medium', 12000, 1, 12000, '2026-11-21T01:00:00Z'),
        (${o!.id}, ${item!.id}, 'Latte', 'L', 'Large', 6000, 2, 12000, '2026-11-21T01:00:01Z')`
    const [rej] = await db.sql`
      insert into payments (order_id, method, amount_centavos, reference, proof_path, status, recorded_at)
      values (${o!.id}, 'gcash', 29000, 'GC-OLD-1111', 'proofs/KNK-NOTE1/a.jpg', 'rejected', '2026-11-21T01:00:00Z')
      returning id`
    const [paid] = await db.sql`
      insert into payments (order_id, method, amount_centavos, reference, proof_path, status, verified_by, verified_at, recorded_at)
      values (${o!.id}, 'gcash', 29000, 'GC-FULL-98765', 'proofs/KNK-NOTE1/b.jpg', 'verified', ${OWNER},
        '2026-11-21T01:30:00Z', '2026-11-21T01:10:00Z')
      returning id`
    rejectedPayment = rej!.id
    paidPayment = paid!.id

    // A counter sale: cash, no proof, no email.
    const [dev] = await db.sql`insert into devices (name) values ('Front till') returning id`
    const [c] = await db.sql`
      insert into orders (channel, fulfilment, prep_status, payment_status, business_day, ticket_series, ticket_number,
        customer_name, subtotal_centavos, total_centavos, device_id, created_at, updated_at)
      values ('counter', 'takeout', 'preparing', 'paid', '2026-11-21', 'C', 12, 'Walk-in', 12000, 12000, ${dev!.id}, ${AT}, ${AT})
      returning id`
    const [cash] = await db.sql`
      insert into payments (order_id, method, amount_centavos, status) values (${c!.id}, 'cash', 12000, 'recorded') returning id`
    noProofPayment = cash!.id

    // An online order still awaiting verification: the reference stays out until it is confirmed.
    const [g] = await db.sql`
      insert into orders (channel, order_code, fulfilment, prep_status, payment_status, business_day,
        ticket_series, ticket_number, customer_name, customer_phone, customer_email, fulfil_at,
        subtotal_centavos, total_centavos, created_at, updated_at)
      values ('online', 'KNK-NOTE2', 'pickup', 'placed', 'pending_verification', '2026-11-21', 'W', 961, 'Ben', '09170000000',
        'ben@x.test', '2026-11-21T05:00:00Z', 12000, 12000, ${AT}, ${AT})
      returning id`
    const [gp] = await db.sql`
      insert into payments (order_id, method, amount_centavos, reference, proof_path, status)
      values (${g!.id}, 'gcash', 12000, 'GC-PEND-5555', 'proofs/KNK-NOTE2/c.jpg', 'pending_verification') returning id`
    guestPayment = gp!.id
  })
  afterAll(async () => {
    await db.stop()
  })

  beforeEach(async () => {
    auth.failInvite = false
    auth.inviteAs = null
    auth.onInvite = null
    auth.invited.length = 0
    auth.deleted.length = 0
    await db.sql
      .unsafe(
        `delete from staff where id not in ('${OWNER}', '${BARISTA}', '${OLD_OWNER}', '${MIA}');
         delete from auth.users where id not in ('${OWNER}', '${BARISTA}', '${OLD_OWNER}', '${NO_EMAIL}', '${UNCONFIRMED}');`,
      )
      .simple()
  })

  const req = (path: string, method = 'GET', headers: Record<string, string> = {}, body?: unknown, on = app) =>
    on.request(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const bearer = (jwt: string) => ({ Authorization: `Bearer ${jwt}` })

  describe('GET /v1/payments/:id/proof', () => {
    it('a staff member gets a 300 s signed link to the proof', async () => {
      const res = await req(`/v1/payments/${paidPayment}/proof`, 'GET', bearer(ownerJwt))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ url: 'https://storage.test/proofs/KNK-NOTE1/b.jpg?expires=300' })
    })

    it('a barista may view a proof too, including a rejected payment', async () => {
      const res = await req(`/v1/payments/${rejectedPayment}/proof`, 'GET', bearer(baristaJwt))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ url: 'https://storage.test/proofs/KNK-NOTE1/a.jpg?expires=300' })
    })

    it('no token -> 401', async () => {
      expect((await req(`/v1/payments/${paidPayment}/proof`)).status).toBe(401)
    })

    it('a payment without a proof, an unknown id or a non-uuid -> 404', async () => {
      for (const id of [noProofPayment, '00000000-0000-4000-8000-00000000ffff', 'nope']) {
        const res = await req(`/v1/payments/${id}/proof`, 'GET', bearer(ownerJwt))
        expect(res.status, id).toBe(404)
        expect(await res.json()).toMatchObject({ code: 'NOT_FOUND' })
      }
    })
  })

  describe('GET /v1/payments/:id/notice', () => {
    it('gives the full order data for the customer email, with the full GCash reference once confirmed', async () => {
      const res = await req(`/v1/payments/${paidPayment}/notice`, 'GET', bearer(baristaJwt))
      expect(res.status).toBe(200)
      const notice = (await res.json()) as PaymentNotice
      expect(notice).toEqual({
        to: 'ana@x.test',
        orderCode: 'KNK-NOTE1',
        ticket: 'W960',
        customerName: 'Ana Cruz',
        fulfilment: 'delivery',
        fulfilAt: '2026-11-21T04:00:00.000Z',
        totalCentavos: 29000,
        deliveryAddress: '1 Gate St, Libertad',
        reference: 'GC-FULL-98765',
        items: [
          { name: 'Latte', variantLabel: 'Medium', quantity: 1 },
          { name: 'Latte', variantLabel: 'Large', quantity: 2 },
        ],
      })
    })

    it('the same order data for a rejected payment (the rejection email)', async () => {
      const res = await req(`/v1/payments/${rejectedPayment}/notice`, 'GET', bearer(ownerJwt))
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ to: 'ana@x.test', orderCode: 'KNK-NOTE1' })
    })

    it('no reference before the payment is confirmed', async () => {
      const res = await req(`/v1/payments/${guestPayment}/notice`, 'GET', bearer(ownerJwt))
      expect(res.status).toBe(200)
      const notice = (await res.json()) as PaymentNotice
      expect(notice).toMatchObject({ to: 'ben@x.test', fulfilment: 'pickup', deliveryAddress: null, reference: null })
      expect(JSON.stringify(notice)).not.toContain('GC-PEND')
    })

    it('an order without an email -> 404 NO_EMAIL; an unknown payment -> 404 NOT_FOUND', async () => {
      const none = await req(`/v1/payments/${noProofPayment}/notice`, 'GET', bearer(ownerJwt))
      expect(none.status).toBe(404)
      expect(await none.json()).toMatchObject({ code: 'NO_EMAIL' })
      for (const id of ['00000000-0000-4000-8000-00000000ffff', 'nope']) {
        const res = await req(`/v1/payments/${id}/notice`, 'GET', bearer(ownerJwt))
        expect(res.status, id).toBe(404)
        expect(await res.json()).toMatchObject({ code: 'NOT_FOUND' })
      }
    })

    it('no token -> 401', async () => {
      expect((await req(`/v1/payments/${paidPayment}/notice`)).status).toBe(401)
    })
  })

  describe('GET /v1/staff/alert-emails', () => {
    const key = (k: string) => ({ 'X-Kennko-Web-Key': k })

    it('the right key -> the active staff emails only', async () => {
      const res = await req('/v1/staff/alert-emails', 'GET', key(WEB_KEY))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { emails: string[] }
      // Not the inactive owner, and the barista has no email.
      expect(body.emails.sort()).toEqual(['mia@x.test', 'o@x.test'])
    })

    it('a wrong key, a key of another length, or no header -> 401', async () => {
      for (const headers of [key('x'.repeat(40)), key(WEB_KEY + 'x'), key(''), {}]) {
        const res = await req('/v1/staff/alert-emails', 'GET', headers)
        expect(res.status).toBe(401)
        expect(await res.json()).toMatchObject({ code: 'UNAUTHENTICATED' })
      }
    })

    it('a staff login without the key -> 401: no other auth opens it', async () => {
      const res = await req('/v1/staff/alert-emails', 'GET', bearer(ownerJwt))
      expect(res.status).toBe(401)
    })

    it('webKey null -> 503 NOT_CONFIGURED, whatever the header', async () => {
      const off = createApp({ ...base, webKey: null })
      for (const headers of [key(WEB_KEY), {}]) {
        const res = await req('/v1/staff/alert-emails', 'GET', headers, undefined, off)
        expect(res.status).toBe(503)
        expect(await res.json()).toMatchObject({ code: 'NOT_CONFIGURED' })
      }
    })

    it('the key opens nothing else', async () => {
      for (const [method, path] of [
        ['GET', '/v1/staff'],
        ['POST', '/v1/staff'],
        ['GET', `/v1/payments/${paidPayment}/notice`],
        ['GET', `/v1/payments/${paidPayment}/proof`],
        ['GET', '/v1/attention'],
        ['GET', '/v1/reports/day/2026-11-21'],
      ] as const) {
        const res = await req(path, method, key(WEB_KEY), method === 'POST' ? { fullName: 'X', role: 'barista' } : undefined)
        expect(res.status, `${method} ${path}`).toBe(401)
      }
    })
  })

  describe('POST /v1/staff invites', () => {
    const post = (body: unknown) => req('/v1/staff', 'POST', bearer(ownerJwt), body)
    /** What GoTrue's invite does: the auth user exists afterwards. */
    const createsLogin = async (email: string, id: string) => {
      await db.sql`insert into auth.users (id, email) values (${id}, ${email}) on conflict (id) do nothing`
    }

    it('a manager with an email is invited once, and the row carries the invited login', async () => {
      auth.onInvite = createsLogin
      const res = await post({ fullName: 'Lia', role: 'manager', email: 'lia@x.test' })
      expect(res.status).toBe(201)
      expect(await res.json()).toMatchObject({ role: 'manager', hasLogin: true, email: 'lia@x.test' })
      expect(auth.invited).toEqual(['lia@x.test'])
      const [row] = await db.sql`select s.user_id, u.email from staff s join auth.users u on u.id = s.user_id where s.email = 'lia@x.test'`
      expect(row!.email).toBe('lia@x.test')
      expect(auth.deleted).toEqual([])
    })

    it('an owner with an email is invited too', async () => {
      auth.onInvite = createsLogin
      const res = await post({ fullName: 'Co Owner', role: 'owner', email: 'co@x.test' })
      expect(res.status).toBe(201)
      expect(await res.json()).toMatchObject({ role: 'owner', hasLogin: true })
      expect(auth.invited).toEqual(['co@x.test'])
    })

    it('the invite throws -> 502 INVITE_FAILED and no row', async () => {
      auth.failInvite = true
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const res = await post({ fullName: 'Lia', role: 'manager', email: 'lia@x.test' })
      expect(res.status).toBe(502)
      expect(await res.json()).toEqual({ code: 'INVITE_FAILED', message: 'Could not send the invite. Try again.' })
      expect(await db.sql`select 1 from staff where full_name = 'Lia'`).toHaveLength(0)
      vi.restoreAllMocks()
    })

    it('the insert fails (no such login: FK) -> the invited login is deleted and the original error answered', async () => {
      const res = await post({ fullName: 'Lia', role: 'manager', email: 'lia@x.test' })
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ code: 'INVALID' })
      expect(auth.deleted).toHaveLength(1)
      expect(auth.deleted[0]).toMatch(/^[0-9a-f-]{36}$/)
    })

    it('a failing deleteUser is logged and the original error still answered', async () => {
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      auth.deleteUser = async () => {
        throw new Error('Auth deleteUser failed (500)')
      }
      try {
        const res = await post({ fullName: 'Lia', role: 'manager', email: 'lia@x.test' })
        expect(res.status).toBe(400)
        expect(await res.json()).toMatchObject({ code: 'INVALID' })
        expect(err).toHaveBeenCalled()
        expect(JSON.stringify(err.mock.calls)).not.toContain('lia@x.test')
      } finally {
        auth.deleteUser = async (id) => {
          auth.deleted.push(id)
        }
        vi.restoreAllMocks()
      }
    })

    it('EMAIL_TAKEN -> the login is kept', async () => {
      auth.onInvite = createsLogin
      const res = await post({ fullName: 'Mia Two', role: 'manager', email: 'mia@x.test' })
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ code: 'EMAIL_TAKEN' })
      expect(auth.invited).toEqual(['mia@x.test'])
      expect(auth.deleted).toEqual([])
    })

    it('ALREADY_STAFF (a re-invite returns an existing staff login) -> the login is kept', async () => {
      auth.inviteAs = OWNER
      const res = await post({ fullName: 'Owner Again', role: 'manager', email: 'new@x.test' })
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ code: 'ALREADY_STAFF' })
      expect(auth.deleted).toEqual([])
    })

    it('a barista with an email is not invited', async () => {
      const res = await post({ fullName: 'Ana', role: 'barista', email: 'ana@x.test' })
      expect(res.status).toBe(201)
      expect(await res.json()).toMatchObject({ role: 'barista', hasLogin: false, email: 'ana@x.test' })
      expect(auth.invited).toEqual([])
    })

    it('a body with userId is not invited (the old website path)', async () => {
      const res = await post({ fullName: 'Una', role: 'manager', userId: UNCONFIRMED, email: 'u@x.test' })
      expect(res.status).toBe(201)
      expect(await res.json()).toMatchObject({ hasLogin: true, email: 'u@x.test' })
      expect(auth.invited).toEqual([])
    })

    it('an owner with neither email nor userId -> 409 NEEDS_LOGIN, nobody invited', async () => {
      const res = await post({ fullName: 'Nobody', role: 'owner' })
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ code: 'NEEDS_LOGIN' })
      expect(auth.invited).toEqual([])
    })
  })
})

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import type { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/create-app.js'
import { verifierFromJwks, type AppEnv } from '../src/auth.js'
import { fakeProofs } from './fakes.js'
import { startTestDb, type TestDb } from './pg.js'

const ISSUER = 'http://supabase.test/auth/v1'
const OWNER = '00000000-0000-4000-8000-000000000001'
const BARISTA = '00000000-0000-4000-8000-000000000002'
const NOBODY = '00000000-0000-4000-8000-000000000003'
const MISSING = '00000000-0000-4000-8000-0000000000ff'

type Body = { code?: string; message?: string; errors?: string[]; prepStatus?: string; paymentStatus?: string }

describe('staff order and payment actions', () => {
  let db: TestDb
  let app: Hono<AppEnv>
  let tokens: Record<string, string>
  let zoneId: string
  let seq = 0

  const sign = (privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'], sub: string) =>
    new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setSubject(sub)
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)

  beforeAll(async () => {
    db = await startTestDb()
    await db.sql
      .unsafe(
        `insert into auth.users (id, email) values ('${OWNER}', 'o@x.test'), ('${BARISTA}', 'b@x.test'), ('${NOBODY}', 'n@x.test');
         insert into staff (id, email, full_name, role, is_active) values
           ('${OWNER}', 'o@x.test', 'Owner', 'owner', true),
           ('${BARISTA}', 'b@x.test', 'Barista', 'barista', true);`,
      )
      .simple()
    const [zone] = await db.sql`insert into delivery_zones (barangay, fee_centavos, latitude, longitude)
      values ('Libertad', 0, 8.942, 125.529) returning id`
    zoneId = zone!.id
    const pair = await generateKeyPair('ES256')
    const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' }
    tokens = {
      owner: await sign(pair.privateKey, OWNER),
      barista: await sign(pair.privateKey, BARISTA),
      nobody: await sign(pair.privateKey, NOBODY),
    }
    app = createApp({
      sql: db.sql,
      verifyUser: verifierFromJwks(createLocalJWKSet({ keys: [jwk] }), ISSUER),
      proofs: fakeProofs(),
      now: () => new Date('2026-11-21T02:00:00Z'),
    })
  })
  afterAll(async () => {
    await db.stop()
  })

  /** An online order awaiting verification, with its live payment. */
  async function seedOnline(fulfilment: 'pickup' | 'delivery' = 'pickup') {
    seq += 1
    const delivery = fulfilment === 'delivery'
    const [o] = await db.sql`
      insert into orders (channel, order_code, fulfilment, prep_status, payment_status, business_day,
        ticket_series, ticket_number, customer_name, customer_phone, customer_email, fulfil_at,
        subtotal_centavos, total_centavos, delivery_address, delivery_barangay, delivery_zone_id)
      values ('online', ${'KNK-T' + seq}, ${fulfilment}, 'placed', 'pending_verification', '2026-11-21',
        'W', ${seq}, 'Ana', '09171234567', 'a@x.test', now(), 10000, 10000,
        ${delivery ? '1 Gate St' : null}, ${delivery ? 'Libertad' : null}, ${delivery ? zoneId : null})
      returning id`
    const [p] = await db.sql`
      insert into payments (order_id, method, amount_centavos, reference, status)
      values (${o!.id}, 'gcash', 10000, 'REF', 'pending_verification') returning id`
    return { orderId: o!.id as string, paymentId: p!.id as string }
  }

  async function seedCounter() {
    seq += 1
    const [o] = await db.sql`
      insert into orders (channel, fulfilment, customer_name, prep_status, payment_status, business_day,
        ticket_series, ticket_number, subtotal_centavos, total_centavos)
      values ('counter', 'dine_in', 'Walk-in', 'preparing', 'paid', '2026-11-21', 'C', ${seq}, 5000, 5000)
      returning id`
    return o!.id as string
  }

  const call = async (who: keyof typeof tokens | null, method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (who) headers.Authorization = `Bearer ${tokens[who]}`
    const res = await app.request(path, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
    return { status: res.status, body: (await res.json()) as Body }
  }
  const patch = (id: string, body: unknown, who: keyof typeof tokens = 'barista') =>
    call(who, 'PATCH', `/v1/orders/${id}`, body)
  const verify = (id: string, who: keyof typeof tokens = 'barista') => call(who, 'POST', `/v1/payments/${id}/verify`)
  const reject = (id: string, reason = 'wrong amount', who: keyof typeof tokens = 'barista') =>
    call(who, 'POST', `/v1/payments/${id}/reject`, { reason })
  const cancel = (id: string, reason = 'out of beans', who: keyof typeof tokens = 'owner') =>
    call(who, 'POST', `/v1/orders/${id}/cancel`, { reason })

  const expectError = (r: { status: number; body: Body }, status: number, code: string) => {
    expect(r.status).toBe(status)
    expect(r.body.code).toBe(code)
    expect(Array.isArray(r.body.errors) && r.body.errors.length > 0).toBe(true)
    expect(r.body.message).toBe(r.body.errors![0])
  }

  const events = async (orderId: string, kind: string) =>
    db.sql`select * from order_events where order_id = ${orderId} and kind = ${kind} order by occurred_at, id`
  const orderRow = async (id: string) => (await db.sql`select * from orders where id = ${id}`)[0]!
  const paymentRow = async (id: string) => (await db.sql`select * from payments where id = ${id}`)[0]!

  it('rejects missing, non-staff and wrong-role callers', async () => {
    const { orderId, paymentId } = await seedOnline()
    expect((await call(null, 'PATCH', `/v1/orders/${orderId}`, { staffNote: 'x' })).status).toBe(401)
    expect((await patch(orderId, { staffNote: 'x' }, 'nobody')).status).toBe(403)
    expect((await call(null, 'POST', `/v1/payments/${paymentId}/verify`)).status).toBe(401)
    expect((await reject(paymentId, 'x', 'nobody')).status).toBe(403)
  })

  it('pickup: verify then preparing -> ready -> completed, one event per step with the staff id', async () => {
    const { orderId, paymentId } = await seedOnline('pickup')
    const v = await verify(paymentId)
    expect(v.status).toBe(200)
    expect(v.body).toMatchObject({ prepStatus: 'placed', paymentStatus: 'paid' })
    const p = await paymentRow(paymentId)
    expect(p.status).toBe('verified')
    expect(p.verified_by).toBe(BARISTA)
    expect(p.verified_at).not.toBeNull()

    for (const step of ['preparing', 'ready', 'completed']) {
      const r = await patch(orderId, { prepStatus: step })
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ prepStatus: step, paymentStatus: 'paid' })
    }
    const prep = await events(orderId, 'prep_status')
    expect(prep.map((e) => [e.from_value, e.to_value, e.staff_id, e.result])).toEqual([
      ['placed', 'preparing', BARISTA, 'applied'],
      ['preparing', 'ready', BARISTA, 'applied'],
      ['ready', 'completed', BARISTA, 'applied'],
    ])
    const pay = await events(orderId, 'payment')
    expect(pay.map((e) => [e.from_value, e.to_value, e.staff_id])).toEqual([['pending_verification', 'paid', BARISTA]])
  })

  it('delivery: preparing -> out_for_delivery -> completed; ready is refused', async () => {
    const { orderId, paymentId } = await seedOnline('delivery')
    await verify(paymentId)
    expect((await patch(orderId, { prepStatus: 'preparing' })).status).toBe(200)
    expectError(await patch(orderId, { prepStatus: 'ready' }), 409, 'BAD_TRANSITION')
    expect((await patch(orderId, { prepStatus: 'out_for_delivery' })).status).toBe(200)
    expect((await patch(orderId, { prepStatus: 'completed' })).status).toBe(200)
    expect(await events(orderId, 'prep_status')).toHaveLength(3)
  })

  it('verify bumps updated_at', async () => {
    const { orderId, paymentId } = await seedOnline()
    await db.sql`update orders set updated_at = '2020-01-01' where id = ${orderId}`
    await verify(paymentId)
    expect((await orderRow(orderId)).updated_at.getFullYear()).toBeGreaterThan(2020)
  })

  it('verify twice -> second 409 STATUS_CHANGED, one payment event', async () => {
    const { orderId, paymentId } = await seedOnline()
    expect((await verify(paymentId)).status).toBe(200)
    const again = await verify(paymentId)
    expectError(again, 409, 'STATUS_CHANGED')
    expect(again.body.errors![0]).toContain('payment is paid')
    expect(await events(orderId, 'payment')).toHaveLength(1)
  })

  it('reject after verify -> 409; verify after reject -> 409', async () => {
    const a = await seedOnline()
    await verify(a.paymentId)
    expectError(await reject(a.paymentId), 409, 'STATUS_CHANGED')
    expect((await orderRow(a.orderId)).payment_status).toBe('paid')

    const b = await seedOnline()
    expect((await reject(b.paymentId, 'blurry proof')).status).toBe(200)
    expectError(await verify(b.paymentId), 409, 'STATUS_CHANGED')
    expect(await events(b.orderId, 'payment')).toHaveLength(1)
  })

  it('reject cancels the order, stores the reason as the staff note', async () => {
    const { orderId, paymentId } = await seedOnline()
    const r = await reject(paymentId, 'blurry proof')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ prepStatus: 'cancelled', paymentStatus: 'rejected' })
    expect(await paymentRow(paymentId)).toMatchObject({ status: 'rejected' })
    expect(await orderRow(orderId)).toMatchObject({
      prep_status: 'cancelled',
      payment_status: 'rejected',
      staff_note: 'blurry proof',
    })
    const [e] = await events(orderId, 'payment')
    expect(e).toMatchObject({ from_value: 'pending_verification', to_value: 'rejected', staff_id: BARISTA, reason: 'blurry proof' })
  })

  it('reject keeps an existing staff note and appends the reason on a new line', async () => {
    const { orderId, paymentId } = await seedOnline()
    expect((await patch(orderId, { staffNote: 'call before delivery' })).status).toBe(200)
    expect((await reject(paymentId, 'blurry proof')).status).toBe(200)
    expect((await orderRow(orderId)).staff_note).toBe('call before delivery\nblurry proof')
  })

  it('reject validates the reason', async () => {
    const { paymentId } = await seedOnline()
    expectError(await reject(paymentId, ''), 400, 'INVALID')
    expectError(await reject(paymentId, 'x'.repeat(301)), 400, 'INVALID')
    expectError(await call('barista', 'POST', `/v1/payments/${paymentId}/reject`, {}), 400, 'INVALID')
  })

  it('placed -> completed is BAD_TRANSITION', async () => {
    const { orderId, paymentId } = await seedOnline()
    await verify(paymentId)
    expectError(await patch(orderId, { prepStatus: 'completed' }), 409, 'BAD_TRANSITION')
    expect((await orderRow(orderId)).prep_status).toBe('placed')
  })

  it('preparing while payment is pending is BAD_TRANSITION', async () => {
    const { orderId } = await seedOnline()
    expectError(await patch(orderId, { prepStatus: 'preparing' }), 409, 'BAD_TRANSITION')
    expect((await orderRow(orderId)).prep_status).toBe('placed')
    expect(await events(orderId, 'prep_status')).toHaveLength(0)
  })

  it('staff note only -> 200 with a note event; note plus prep move writes both events', async () => {
    const { orderId, paymentId } = await seedOnline()
    const r = await patch(orderId, { staffNote: 'call before delivery' })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ prepStatus: 'placed', paymentStatus: 'pending_verification' })
    expect((await orderRow(orderId)).staff_note).toBe('call before delivery')
    const [e] = await events(orderId, 'note')
    expect(e).toMatchObject({ staff_id: BARISTA, result: 'applied', to_value: 'call before delivery' })

    await verify(paymentId)
    const both = await patch(orderId, { staffNote: 'rush', prepStatus: 'preparing' })
    expect(both.status).toBe(200)
    expect(await events(orderId, 'note')).toHaveLength(2)
    expect(await events(orderId, 'prep_status')).toHaveLength(1)
  })

  it('PATCH validation: empty body, long note, bad status, malformed JSON -> 400', async () => {
    const { orderId } = await seedOnline()
    expectError(await patch(orderId, {}), 400, 'INVALID')
    expectError(await patch(orderId, { staffNote: 'x'.repeat(501) }), 400, 'INVALID')
    expectError(await patch(orderId, { prepStatus: 'flying' }), 400, 'INVALID')
    expectError(await patch(orderId, 'not json'), 400, 'INVALID')
  })

  it('unknown ids -> 404 NOT_FOUND', async () => {
    expectError(await patch(MISSING, { staffNote: 'x' }), 404, 'NOT_FOUND')
    expectError(await cancel(MISSING), 404, 'NOT_FOUND')
    expectError(await verify(MISSING), 404, 'NOT_FOUND')
    expectError(await reject(MISSING), 404, 'NOT_FOUND')
    expectError(await patch('not-a-uuid', { staffNote: 'x' }), 404, 'NOT_FOUND')
  })

  it('barista cancel -> 403', async () => {
    const { orderId } = await seedOnline()
    expect((await cancel(orderId, 'nope', 'barista')).status).toBe(403)
    expect((await orderRow(orderId)).prep_status).toBe('placed')
  })

  it('cancel a paid order -> cancelled + refunded, payment refunded', async () => {
    const { orderId, paymentId } = await seedOnline()
    await verify(paymentId)
    await patch(orderId, { prepStatus: 'preparing' })
    const r = await cancel(orderId, 'out of beans')
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ prepStatus: 'cancelled', paymentStatus: 'refunded' })
    expect((await paymentRow(paymentId)).status).toBe('refunded')
    expect(await orderRow(orderId)).toMatchObject({
      prep_status: 'cancelled',
      payment_status: 'refunded',
      cancelled_by_staff: OWNER,
      cancel_reason: 'out of beans',
    })
    expect((await orderRow(orderId)).cancelled_at).not.toBeNull()
    const [e] = await events(orderId, 'cancelled')
    expect(e).toMatchObject({ from_value: 'preparing', to_value: 'cancelled', staff_id: OWNER, reason: 'out of beans (payment refunded)' })
  })

  it('cancel a pending order -> cancelled + rejected, payment rejected', async () => {
    const { orderId, paymentId } = await seedOnline()
    const r = await cancel(orderId)
    expect(r.body).toEqual({ prepStatus: 'cancelled', paymentStatus: 'rejected' })
    expect((await paymentRow(paymentId)).status).toBe('rejected')
    expect((await orderRow(orderId)).payment_status).toBe('rejected')
    expect((await events(orderId, 'cancelled'))[0]!.reason).toBe('out of beans (payment rejected)')
  })

  it('cancel twice / a completed order -> 409 BAD_TRANSITION', async () => {
    const { orderId, paymentId } = await seedOnline()
    await verify(paymentId)
    for (const s of ['preparing', 'ready', 'completed']) await patch(orderId, { prepStatus: s })
    expectError(await cancel(orderId), 409, 'BAD_TRANSITION')
    expect((await orderRow(orderId)).payment_status).toBe('paid')

    const b = await seedOnline()
    await cancel(b.orderId)
    expectError(await cancel(b.orderId), 409, 'BAD_TRANSITION')
    expect(await events(b.orderId, 'cancelled')).toHaveLength(1)
  })

  it('cancel validates the reason; counter orders -> 409 COUNTER_ORDER', async () => {
    const { orderId } = await seedOnline()
    expectError(await cancel(orderId, ''), 400, 'INVALID')
    expectError(await cancel(orderId, 'x'.repeat(301)), 400, 'INVALID')
    expectError(await cancel(await seedCounter()), 409, 'COUNTER_ORDER')
  })

  it('cancelled orders accept no prep move', async () => {
    const { orderId } = await seedOnline()
    await cancel(orderId)
    expectError(await patch(orderId, { prepStatus: 'preparing' }), 409, 'BAD_TRANSITION')
  })
})

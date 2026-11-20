import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import type { Hono } from 'hono'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { deliveryFeeCentavos, ridingDistanceKm } from '@kennko/core'

// Lets one test make pricing throw something that is not an OrderError.
const pricing = vi.hoisted(() => ({ explode: false }))
vi.mock('@kennko/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@kennko/core')>()
  return {
    ...real,
    priceOnlineOrder: (...args: Parameters<typeof real.priceOnlineOrder>) => {
      if (pricing.explode) throw new TypeError('cannot read properties of undefined')
      return real.priceOnlineOrder(...args)
    },
  }
})
import { createApp } from '../src/create-app.js'
import { verifierFromJwks, type AppEnv } from '../src/auth.js'
import { generateOrderCode } from '../src/orders/create.js'
import { publishMenu } from '../src/menu/snapshot.js'
import { fakeProofs, type FakeProofStore } from './fakes.js'
import { startTestDb, type TestDb } from './pg.js'

const ISSUER = 'http://supabase.test/auth/v1'
const CUSTOMER = '00000000-0000-4000-8000-0000000000c5'
const NOW = new Date('2026-11-21T02:00:00Z') // 10:00 in Manila
const CODE = /^KNK-[ACDEFHJKLMNPRTUVWXY34679]{6}$/

const jpeg = (size = 64) => {
  const b = new Uint8Array(size)
  b.set([0xff, 0xd8, 0xff, 0xe0])
  return b
}
const heic = () => {
  const b = new Uint8Array(64)
  b.set([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, ...'heic'.split('').map((c) => c.charCodeAt(0))])
  return b
}
const pdf = () => new TextEncoder().encode('%PDF-1.7 not an image')

type Body = {
  code?: string
  message?: string
  errors?: string[]
  orderId?: string
  orderCode?: string
  ticket?: string
  items?: unknown[]
  subtotalCentavos?: number
  deliveryFeeCentavos?: number
  totalCentavos?: number
}

describe('POST /v1/orders', () => {
  let db: TestDb
  let app: Hono<AppEnv>
  let proofs: FakeProofStore
  let codes: string[]
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey']
  let latteId: string
  let boomId: string
  let shotId: string

  const sign = (sub: string, expiresAt: number | string = '5m') =>
    new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setSubject(sub)
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(expiresAt)
      .sign(privateKey)

  beforeAll(async () => {
    db = await startTestDb()
    await db.sql.unsafe(`insert into auth.users (id, email) values ('${CUSTOMER}', 'c@x.test')`).simple()

    const [cat] = await db.sql`insert into menu_categories (name, sort_order) values ('Test Coffee', 0) returning id`
    const [latte] = await db.sql`insert into menu_items (category_id, name) values (${cat!.id}, 'Iced Latte') returning id`
    const [boom] = await db.sql`insert into menu_items (category_id, name) values (${cat!.id}, 'Boom Latte') returning id`
    latteId = latte!.id
    boomId = boom!.id
    await db.sql`insert into menu_variants (item_id, code, label, price_centavos, temperature)
      values (${latteId}, 'M', 'Medium', 12000, 'iced'), (${latteId}, 'HOT', 'Hot', 11000, 'hot'),
             (${boomId}, 'M', 'Medium', 10000, 'iced')`
    const [group] = await db.sql`insert into option_groups (name) values ('Test Add-ons') returning id`
    const [shot] = await db.sql`insert into options (group_id, name, price_centavos) values (${group!.id}, 'Extra shot', 3000) returning id`
    shotId = shot!.id
    await db.sql`insert into item_option_groups (item_id, group_id) values (${latteId}, ${group!.id}), (${boomId}, ${group!.id})`
    await db.sql`insert into delivery_zones (barangay, fee_centavos, latitude, longitude) values ('Libertad', 0, 8.942, 125.529)`

    const pair = await generateKeyPair('ES256')
    privateKey = pair.privateKey
    const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' }
    proofs = fakeProofs()
    codes = []
    app = createApp({
      sql: db.sql,
      verifyUser: verifierFromJwks(createLocalJWKSet({ keys: [jwk] }), ISSUER),
      proofs,
      push: null,
      now: () => NOW,
      orderCode: () => codes.shift() ?? generateOrderCode(),
    })
  })
  afterAll(async () => {
    await db.stop()
  })
  beforeEach(() => {
    proofs.uploads.length = 0
    proofs.removed.length = 0
    proofs.failUpload = false
    codes.length = 0
    pricing.explode = false
  })

  const pickup = (over: Record<string, unknown> = {}) => ({
    name: '  Ana Cruz ',
    email: ' Ana@X.test ',
    phone: '0917 123-4567',
    fulfilment: 'pickup',
    address: '',
    barangay: '',
    fulfilAt: '2026-11-21T04:00:00.000Z',
    gcashReference: ' abc123456 ',
    note: ' ring twice ',
    lines: [
      { menuItemId: latteId, size: 'M', quantity: 2, modifierIds: [shotId], iceLevel: 'less', iceServe: 'side', note: ' less sweet ' },
    ],
    claimedTotalCentavos: 30000,
    ...over,
  })

  const libertadFee = () => deliveryFeeCentavos(ridingDistanceKm({ lat: 8.942, lng: 125.529 }), false)
  const delivery = (over: Record<string, unknown> = {}) =>
    pickup({ fulfilment: 'delivery', address: '1 Gate St', barangay: 'Libertad', claimedTotalCentavos: 30000 + libertadFee(), ...over })

  const post = async (
    order: unknown,
    proof: Uint8Array | null = jpeg(),
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: Body }> => {
    const fd = new FormData()
    if (order !== undefined) fd.set('order', typeof order === 'string' ? order : JSON.stringify(order))
    if (proof) fd.set('proof', new File([proof as Uint8Array<ArrayBuffer>], 'proof.jpg', { type: 'image/jpeg' }))
    const res = await app.request('/v1/orders', { method: 'POST', body: fd, headers })
    return { status: res.status, body: (await res.json()) as Body }
  }

  const expectError = (r: { status: number; body: Body }, status: number, code: string) => {
    expect(r.status).toBe(status)
    expect(r.body.code).toBe(code)
    expect(Array.isArray(r.body.errors) && r.body.errors.length > 0).toBe(true)
    expect(r.body.message).toBe(r.body.errors![0])
  }

  const count = async (table: string) => {
    const [row] = await db.sql.unsafe(`select count(*)::int as n from ${table}`)
    return row!.n as number
  }

  it('no published menu -> 503 MENU_UNAVAILABLE', async () => {
    expectError(await post(pickup()), 503, 'MENU_UNAVAILABLE')
    expect(proofs.uploads).toHaveLength(0)
  })

  describe('with a published menu', () => {
    beforeAll(async () => {
      await publishMenu(db.sql, null)
    })

    it('happy pickup -> 201 W1, rows in all five tables, proof uploaded once', async () => {
      const r = await post(pickup())
      expect(r.status).toBe(201)
      expect(r.body.ticket).toBe('W1')
      expect(r.body.orderCode).toMatch(CODE)
      expect(r.body.items).toEqual([
        { name: 'Iced Latte', variantLabel: 'Medium', quantity: 2, ice: 'Less ice, on the side', note: 'less sweet' },
      ])
      expect(r.body).toMatchObject({ subtotalCentavos: 30000, deliveryFeeCentavos: 0, totalCentavos: 30000 })
      expect(r.body).not.toHaveProperty('ok')

      const [o] = await db.sql`select * from orders where id = ${r.body.orderId!}`
      expect(o).toMatchObject({
        order_code: r.body.orderCode,
        channel: 'online',
        fulfilment: 'pickup',
        prep_status: 'placed',
        payment_status: 'pending_verification',
        ticket_series: 'W',
        ticket_number: 1,
        customer_name: 'Ana Cruz',
        customer_phone: '09171234567',
        customer_email: 'ana@x.test',
        customer_note: 'ring twice',
        customer_user_id: null,
        subtotal_centavos: 30000,
        delivery_fee_centavos: 0,
        total_centavos: 30000,
        delivery_address: null,
        delivery_zone_id: null,
      })
      expect(Number(o!.menu_version)).toBe(1)
      expect((await db.sql`select business_day::text as d from orders where id = ${o!.id}`)[0]!.d).toBe('2026-11-21')
      expect(new Date(o!.fulfil_at).toISOString()).toBe('2026-11-21T04:00:00.000Z')

      const lines = await db.sql`select * from order_lines where order_id = ${o!.id}`
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatchObject({
        item_id: latteId,
        item_name: 'Iced Latte',
        variant_code: 'M',
        variant_label: 'Medium',
        unit_price_centavos: 12000,
        quantity: 2,
        line_total_centavos: 30000,
        ice_level: 'less',
        ice_serve: 'side',
        note: 'less sweet',
      })
      const opts = await db.sql`select * from order_line_options where line_id = ${lines[0]!.id}`
      expect(opts).toHaveLength(1)
      expect(opts[0]).toMatchObject({ option_id: shotId, group_name: 'Test Add-ons', option_name: 'Extra shot', price_centavos: 3000 })

      const pays = await db.sql`select * from payments where order_id = ${o!.id}`
      expect(pays).toHaveLength(1)
      expect(pays[0]).toMatchObject({
        method: 'gcash',
        status: 'pending_verification',
        amount_centavos: o!.total_centavos,
        reference: 'ABC123456',
      })

      const events = await db.sql`select * from order_events where order_id = ${o!.id}`
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ kind: 'created', to_value: 'placed' })

      expect(proofs.uploads).toHaveLength(1)
      expect(proofs.uploads[0]!.path).toMatch(new RegExp(`^proofs/${r.body.orderCode}/[0-9a-f-]{36}\\.jpg$`))
      expect(proofs.uploads[0]!.contentType).toBe('image/jpeg')
      expect(pays[0]!.proof_path).toBe(proofs.uploads[0]!.path)
      expect(proofs.removed).toHaveLength(0)
    })

    it('second order the same day -> W2', async () => {
      const r = await post(pickup())
      expect(r.status).toBe(201)
      expect(r.body.ticket).toBe('W2')
      const [c] = await db.sql`select last_number from ticket_counters where business_day = '2026-11-21' and series = 'W'`
      expect(c!.last_number).toBe(2)
    })

    it('a fulfilAt without an offset is Manila time, stored as the right UTC instant', async () => {
      const r = await post(pickup({ fulfilAt: '2026-11-21T12:00' }))
      expect(r.status).toBe(201)
      const [o] = await db.sql`select fulfil_at from orders where id = ${r.body.orderId!}`
      expect(new Date(o!.fulfil_at).toISOString()).toBe('2026-11-21T04:00:00.000Z')
    })

    it('delivery -> fee from the zone, delivery columns stored', async () => {
      const r = await post(delivery())
      expect(r.status).toBe(201)
      expect(r.body.deliveryFeeCentavos).toBe(libertadFee())
      expect(r.body.totalCentavos).toBe(30000 + libertadFee())
      const [o] = await db.sql`select * from orders where id = ${r.body.orderId!}`
      expect(o).toMatchObject({ fulfilment: 'delivery', delivery_address: '1 Gate St', delivery_barangay: 'Libertad' })
      expect(o!.delivery_zone_id).not.toBeNull()
      expect(Number(o!.delivery_distance_km)).toBeGreaterThan(0)
    })

    it('MALFORMED: missing order, missing proof, bad JSON, missing fields', async () => {
      expectError(await post(undefined), 400, 'MALFORMED')
      expectError(await post(pickup(), null), 400, 'MALFORMED')
      expectError(await post('{not json'), 400, 'MALFORMED')
      const { lines: _lines, ...noLines } = pickup()
      expectError(await post(noLines), 400, 'MALFORMED')
      expectError(await post(pickup({ claimedTotalCentavos: 'lots' })), 400, 'MALFORMED')
      const res = await app.request('/v1/orders', { method: 'POST', body: 'x', headers: { 'Content-Type': 'text/plain' } })
      expect(res.status).toBe(400)
      expect(((await res.json()) as Body).code).toBe('MALFORMED')
      expect(proofs.uploads).toHaveLength(0)
    })

    it('INVALID: validateCheckout problems -> 400 with every error', async () => {
      const r = await post(pickup({ email: 'nope', phone: '123' }))
      expectError(r, 400, 'INVALID')
      expect(r.body.errors).toEqual(['Enter a valid email address.', 'Enter a Philippine mobile number, like 0912 345 6789.'])
    })

    it('INVALID: a time in the past against the pinned clock', async () => {
      const r = await post(pickup({ fulfilAt: '2026-11-21T01:59:00.000Z' }))
      expectError(r, 400, 'INVALID')
      expect(r.body.errors).toEqual(['Choose a time in the future.'])
    })

    it('EMPTY_CART -> 400', async () => {
      expectError(await post(pickup({ lines: [] })), 400, 'EMPTY_CART')
    })

    it('BAD_PROOF: not an image, HEIC, over 5 MB -> 400', async () => {
      const notImage = await post(pickup(), pdf())
      expectError(notImage, 400, 'BAD_PROOF')
      expect(notImage.body.errors).toEqual(['That file is not a JPEG, PNG, or WebP image.'])
      const heicR = await post(pickup(), heic())
      expectError(heicR, 400, 'BAD_PROOF')
      expect(heicR.body.errors![0]).toMatch(/HEIC/)
      const big = await post(pickup(), jpeg(5 * 1024 * 1024 + 1))
      expectError(big, 400, 'BAD_PROOF')
      expect(big.body.errors).toEqual(['That image is larger than 5MB. Try a smaller photo.'])
      expect(proofs.uploads).toHaveLength(0)
    })

    it('accepts PNG and WebP proofs with their extensions', async () => {
      const png = new Uint8Array(32)
      png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      expect((await post(pickup(), png)).status).toBe(201)
      const webp = new Uint8Array(32)
      webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
      expect((await post(pickup(), webp)).status).toBe(201)
      expect(proofs.uploads.map((u) => [u.path.split('.').pop(), u.contentType])).toEqual([
        ['png', 'image/png'],
        ['webp', 'image/webp'],
      ])
    })

    it('ITEM_UNAVAILABLE: a live sold-out mark without a republish -> 409', async () => {
      await db.sql`update menu_items set is_available = false where id = ${latteId}`
      try {
        expectError(await post(pickup()), 409, 'ITEM_UNAVAILABLE')
      } finally {
        await db.sql`update menu_items set is_available = true where id = ${latteId}`
      }
    })

    it('SIZE_UNAVAILABLE -> 409', async () => {
      const line = { menuItemId: latteId, size: 'XL', quantity: 1, modifierIds: [], iceLevel: null, iceServe: null }
      expectError(await post(pickup({ lines: [line] })), 409, 'SIZE_UNAVAILABLE')
    })

    it('MODIFIER_UNAVAILABLE -> 409', async () => {
      const line = { menuItemId: latteId, size: 'M', quantity: 1, modifierIds: ['00000000-0000-4000-8000-00000000dead'], iceLevel: null, iceServe: null }
      expectError(await post(pickup({ lines: [line] })), 409, 'MODIFIER_UNAVAILABLE')
    })

    it('BAD_QUANTITY -> 400', async () => {
      const line = { menuItemId: latteId, size: 'M', quantity: 0, modifierIds: [], iceLevel: null, iceServe: null }
      expectError(await post(pickup({ lines: [line] })), 400, 'BAD_QUANTITY')
    })

    it('OUTSIDE_SERVICE_AREA -> 409', async () => {
      const r = await post(delivery({ barangay: 'Nowhere' }))
      expectError(r, 409, 'OUTSIDE_SERVICE_AREA')
      expect(r.body.errors).toEqual(['Sorry, Kennko does not deliver to Nowhere yet.'])
    })

    it('ZONE_NOT_LOCATED -> 409', async () => {
      // The table's own check forbids such a zone today; drop it to reach the branch.
      await db.sql`alter table delivery_zones drop constraint delivery_zones_needs_coordinates`
      await db.sql`insert into delivery_zones (barangay, fee_centavos) values ('Unmapped', 0)`
      expectError(await post(delivery({ barangay: 'Unmapped' })), 409, 'ZONE_NOT_LOCATED')
    })

    it('PIN_MISMATCH -> 409', async () => {
      expectError(await post(delivery({ pin: { lat: 9.2, lng: 125.9, accuracyM: 10 } })), 409, 'PIN_MISMATCH')
    })

    it('PRICE_CHANGED when the claimed total is off by one centavo -> 409', async () => {
      expectError(await post(pickup({ claimedTotalCentavos: 30001 })), 409, 'PRICE_CHANGED')
      expect(proofs.uploads).toHaveLength(0)
    })

    it('UPLOAD_FAILED -> 500, nothing written, the maybe-landed proof removed', async () => {
      const before = await count('orders')
      proofs.failUpload = true
      expectError(await post(pickup()), 500, 'UPLOAD_FAILED')
      expect(await count('orders')).toBe(before)
      expect(proofs.removed).toHaveLength(1)
      expect(proofs.removed[0]).toMatch(/^proofs\/KNK-[A-Z0-9]{6}\/[0-9a-f-]{36}\.jpg$/)
    })

    it('a body over 5 MB + 64 KB -> 413 BAD_PROOF, nothing uploaded', async () => {
      const r = await post(pickup(), jpeg(5 * 1024 * 1024 + 70 * 1024))
      expect(r.status).toBe(413)
      expect(r.body).toEqual({
        code: 'BAD_PROOF',
        message: 'That photo is too large. Use one under 5 MB.',
        errors: ['That photo is too large. Use one under 5 MB.'],
      })
      expect(proofs.uploads).toHaveLength(0)
    })

    it('an unexpected pricing failure -> 500 ORDER_FAILED in the order error shape', async () => {
      pricing.explode = true
      expectError(await post(pickup()), 500, 'ORDER_FAILED')
      expect(proofs.uploads).toHaveLength(0)
    })

    it('a zone lookup failure -> 503 ORDERING_UNAVAILABLE in the order error shape', async () => {
      await db.sql`alter table delivery_zones rename to delivery_zones_gone`
      try {
        const r = await post(delivery())
        expectError(r, 503, 'ORDERING_UNAVAILABLE')
        expect(r.body.errors).toEqual(['Ordering is unavailable right now. Please try again in a few minutes.'])
      } finally {
        await db.sql`alter table delivery_zones_gone rename to delivery_zones`
      }
      expect(proofs.uploads).toHaveLength(0)
    })

    it('fields over their length bounds -> 400 INVALID naming each field', async () => {
      const long = (n: number) => 'a'.repeat(n)
      const line = { menuItemId: latteId, size: 'M', quantity: 1, modifierIds: [], iceLevel: null, iceServe: null, note: long(201) }
      const r = await post(
        delivery({
          name: long(101),
          email: `${long(195)}@x.test`,
          phone: `0917 ${long(26)}`,
          address: long(301),
          barangay: long(101),
          note: long(501),
          gcashReference: long(41),
          lines: [line],
        }),
      )
      expectError(r, 400, 'INVALID')
      for (const field of ['Name', 'Email', 'Mobile number', 'Delivery address', 'Barangay', 'Order note', 'GCash reference', 'Drink note']) {
        expect(r.body.errors!.some((e) => e.startsWith(`${field} must be`))).toBe(true)
      }
      // At the bound is fine.
      const ok = await post(pickup({ name: long(100), note: long(500) }))
      expect(ok.status).toBe(201)
    })

    it('Review Focus 1: proof stored, then the database write fails -> rolled back, proof removed', async () => {
      await db.sql.unsafe(`
        create function boom() returns trigger language plpgsql as $$
        begin
          if new.item_name = 'Boom Latte' then raise exception 'boom'; end if;
          return new;
        end $$;
        create trigger boom before insert on order_lines for each row execute function boom();`).simple()
      const before = {
        orders: await count('orders'),
        payments: await count('payments'),
        events: await count('order_events'),
        lines: await count('order_lines'),
      }
      const [counter] = await db.sql`select last_number from ticket_counters where business_day = '2026-11-21'`
      const line = { menuItemId: boomId, size: 'M', quantity: 1, modifierIds: [], iceLevel: null, iceServe: null }
      const r = await post(pickup({ lines: [line], claimedTotalCentavos: 10000 }))
      expectError(r, 500, 'ORDER_FAILED')
      expect(await count('orders')).toBe(before.orders)
      expect(await count('payments')).toBe(before.payments)
      expect(await count('order_events')).toBe(before.events)
      expect(await count('order_lines')).toBe(before.lines)
      const [after] = await db.sql`select last_number from ticket_counters where business_day = '2026-11-21'`
      expect(after!.last_number).toBe(counter!.last_number)
      expect(proofs.uploads).toHaveLength(1)
      expect(proofs.removed).toEqual([proofs.uploads[0]!.path])
      await db.sql.unsafe('drop trigger boom on order_lines; drop function boom();').simple()
    })

    it('Review Focus 5: an expired customer token -> guest order, not refused', async () => {
      const expired = await sign(CUSTOMER, Math.floor(Date.now() / 1000) - 60)
      const r = await post(pickup(), jpeg(), { Authorization: `Bearer ${expired}` })
      expect(r.status).toBe(201)
      const [o] = await db.sql`select customer_user_id from orders where id = ${r.body.orderId!}`
      expect(o!.customer_user_id).toBeNull()
    })

    it('a garbage bearer token -> guest order', async () => {
      const r = await post(pickup(), jpeg(), { Authorization: 'Bearer not-a-jwt' })
      expect(r.status).toBe(201)
      const [o] = await db.sql`select customer_user_id from orders where id = ${r.body.orderId!}`
      expect(o!.customer_user_id).toBeNull()
    })

    it('a valid customer token -> customer_user_id is its sub', async () => {
      const r = await post(pickup(), jpeg(), { Authorization: `Bearer ${await sign(CUSTOMER)}` })
      expect(r.status).toBe(201)
      const [o] = await db.sql`select customer_user_id from orders where id = ${r.body.orderId!}`
      expect(o!.customer_user_id).toBe(CUSTOMER)
    })

    it('order code collision -> retried with a new code, proof moved under it', async () => {
      codes.push('KNK-CCCCCC')
      expect((await post(pickup())).status).toBe(201)
      proofs.uploads.length = 0

      codes.push('KNK-CCCCCC', 'KNK-DDDDDD')
      const r = await post(pickup())
      expect(r.status).toBe(201)
      expect(r.body.orderCode).toBe('KNK-DDDDDD')
      expect(proofs.uploads).toHaveLength(2)
      expect(proofs.uploads[0]!.path).toMatch(/^proofs\/KNK-CCCCCC\//)
      expect(proofs.uploads[1]!.path).toMatch(/^proofs\/KNK-DDDDDD\//)
      expect(proofs.removed).toEqual([proofs.uploads[0]!.path])
      const [p] = await db.sql`select proof_path from payments where order_id = ${r.body.orderId!}`
      expect(p!.proof_path).toBe(proofs.uploads[1]!.path)
      expect(await count(`orders where order_code = 'KNK-CCCCCC'`)).toBe(1)
    })

    it('three collisions in a row -> 500 ORDER_FAILED, every proof removed', async () => {
      const before = await count('orders')
      codes.push('KNK-CCCCCC', 'KNK-CCCCCC', 'KNK-CCCCCC', 'KNK-EEEEEE')
      expectError(await post(pickup()), 500, 'ORDER_FAILED')
      expect(await count('orders')).toBe(before)
      expect(proofs.uploads).toHaveLength(3)
      expect(proofs.removed).toEqual(proofs.uploads.map((u) => u.path))
      expect(codes).toEqual(['KNK-EEEEEE'])
    })

    it('the default generator makes KNK- plus six unambiguous characters', () => {
      for (let i = 0; i < 50; i++) expect(generateOrderCode()).toMatch(CODE)
    })
  })
})

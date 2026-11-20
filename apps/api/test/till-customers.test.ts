import { randomInt, randomUUID } from 'node:crypto'
import { formatPublicCode, LOOKUPS_PER_MINUTE, makePublicCode, type PullState, type TillCustomer } from '@kennko/core'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { publishMenu } from '../src/menu/snapshot.js'
import { hit } from '../src/rate-limit.js'
import { startTestDb, type TestDb } from './pg.js'
import { customerLinked, orderCreated, rewardUsed, seedDevice, seedStaff, shiftOpened, stampAdded, syncApp } from './sync-helpers.js'

const NOW = new Date('2026-11-21T02:00:00Z')
const TILL_KEYS = ['catName', 'code', 'fullCards', 'stampMode', 'stamps']
const PRIVATE_KEYS = ['points', 'balance', 'email', 'displayName', 'name', 'phone']

let db: TestDb
let api: ReturnType<typeof syncApp>
let token: string
let deviceId: string
let otherToken: string
let bea: string
let shiftId: string
let latteId: string
let version: number
let ticket = 0

/** A customer with a card code; `stamps` live stamps laid on cards of 8 (full cards first). */
async function customer(o: { name?: string; email?: string; mode?: 'none' | 'digital' | 'paper'; stamps?: number } = {}) {
  const id = randomUUID()
  const bare = makePublicCode(randomInt)
  await db.sql`insert into auth.users (id, email) values (${id}, ${o.email ?? `${id}@x.test`})`
  await db.sql`insert into customers (id, public_code, display_name, stamp_mode, age_confirmed_at, privacy_accepted_at,
      privacy_version, created_at)
    values (${id}, ${bare}, ${o.name ?? 'Kim'}, ${o.mode ?? 'digital'}, ${NOW}, ${NOW}, '2026-11', ${NOW})`
  const n = o.stamps ?? 0
  for (let first = 0; first < n; first += 8) {
    const count = Math.min(8, n - first)
    const [card] = await db.sql`insert into stamp_cards (customer_id, started_at, filled_at)
      values (${id}, ${NOW}, ${count === 8 ? NOW : null}) returning id`
    for (let i = 0; i < count; i++) {
      ticket += 1
      const [ord] = await db.sql`
        insert into orders (channel, fulfilment, prep_status, payment_status, business_day, ticket_series, ticket_number,
          customer_name, subtotal_centavos, total_centavos, device_id, customer_id)
        values ('counter', 'dine_in', 'completed', 'paid', '2026-11-20', 'C', ${ticket}, 'Walk-in', 14000, 14000,
          ${deviceId}, ${id})
        returning id`
      await db.sql`insert into stamps (id, customer_id, card_id, order_id, stamped_at, received_at)
        values (${randomUUID()}, ${id}, ${card!.id}, ${ord!.id}, ${new Date(NOW.getTime() - (n - first - i) * 60_000)}, ${NOW})`
    }
  }
  return { id, bare, code: formatPublicCode(bare) }
}

/** A paid online pickup order for `customerId` (linked at checkout), with a drink line. */
async function onlineOrder(customerId: string | null, name = 'Jo') {
  ticket += 1
  const [o] = await db.sql`
    insert into orders (channel, order_code, fulfilment, prep_status, payment_status, business_day,
      ticket_series, ticket_number, customer_name, customer_phone, customer_email, fulfil_at,
      subtotal_centavos, total_centavos, created_at, updated_at, customer_id)
    values ('online', ${'KNK-TC' + ticket}, 'pickup', 'placed', 'paid', '2026-11-21', 'W', ${ticket}, ${name},
      '09170000000', 'jo@x.test', ${NOW}, 18000, 18000, ${NOW}, ${NOW}, ${customerId})
    returning id`
  await db.sql`insert into order_lines (order_id, item_id, item_name, variant_code, variant_label, unit_price_centavos,
      quantity, line_total_centavos)
    values (${o!.id}, ${latteId}, 'Spanish Latte', 'M', 'Medium', 18000, 1, 18000)`
  await db.sql`insert into payments (order_id, method, amount_centavos, reference, status)
    values (${o!.id}, 'gcash', 18000, ${'GC-TC' + ticket}, 'verified')`
  return o!.id as string
}

/** A ₱180 counter sale on this till's open shift. */
function sale() {
  ticket += 1
  return orderCreated(
    {
      shiftId,
      ticketNumber: ticket,
      menuVersion: version,
      lines: [
        {
          menuItemId: latteId,
          name: 'Spanish Latte',
          size: 'M',
          basePriceCentavos: 18000,
          modifiers: [],
          quantity: 1,
          iceLevel: 'regular',
          iceServe: 'mixed',
          note: '',
          lineTotalCentavos: 18000,
        },
      ],
      subtotalCentavos: 18000,
      totalCentavos: 18000,
      payment: { id: randomUUID(), method: 'cash', tenderedCentavos: 18000, changeCentavos: 0, reference: null },
    },
    { staffId: bea },
  )
}

/** Pushes a sale and a link of it to `code` from this till; both must apply. */
async function linkOnTill(code: string, t = token) {
  const s = sale()
  const res = await api.push(t, [s, customerLinked({ orderId: s.payload.orderId, publicCode: code }, { staffId: bea })])
  expect(res.results.map((r) => r.result)).toEqual(['applied', 'applied'])
  return s.payload.orderId
}

const req = async (method: string, path: string, t: string | null, body?: unknown) =>
  api.app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
const lookup = (code: string, t: string | null = token) => req('GET', `/v1/customers/by-code/${encodeURIComponent(code)}`, t)
const claim = (body: unknown, t = token) => req('POST', '/v1/stamp-cards/claim', t, body)
const release = (claimId: string, t = token) => req('POST', '/v1/stamp-cards/release', t, { claimId })
const pull = async (t = token) => {
  const res = await req('GET', '/v1/sync/pull', t)
  expect(res.status).toBe(200)
  const raw = await res.text()
  return { state: JSON.parse(raw) as PullState, raw }
}
const cardsOf = (customerId: string) =>
  db.sql<{ filled_at: Date | null; claimed_at: Date | null; claim_id: string | null; claimed_by_staff: string | null; claimed_device_id: string | null }[]>`
    select filled_at, claimed_at, claim_id, claimed_by_staff, claimed_device_id from stamp_cards
    where customer_id = ${customerId} order by filled_at nulls last, started_at`
const keysDeep = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out))
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      out.push(k)
      keysDeep(x, out)
    }
  return out
}

beforeAll(async () => {
  db = await startTestDb()
  api = syncApp(db.sql, NOW)
  ;({ token, deviceId } = await seedDevice(db.sql, 'Front till'))
  ;({ token: otherToken } = await seedDevice(db.sql, 'Back till'))
  bea = await seedStaff(db.sql, { fullName: 'Bea' })
  const [coffee] = await db.sql`insert into menu_categories (name, kind, sort_order) values ('Coffee', 'drink', 0) returning id`
  const [l] = await db.sql`insert into menu_items (category_id, name) values (${coffee!.id}, 'Spanish Latte') returning id`
  latteId = l!.id as string
  await db.sql`insert into menu_variants (item_id, code, label, price_centavos, temperature)
    values (${latteId}, 'M', 'Medium', 18000, 'iced')`
  version = (await publishMenu(db.sql, null)).version
  const open = shiftOpened({}, { staffId: bea })
  shiftId = open.payload.shiftId
  await api.push(token, [open])
})
afterAll(async () => {
  await db.stop()
})

describe('the till allowlist', () => {
  test('nothing beyond the allowed fields sent to the till', async () => {
    const ana = await customer({ name: 'Ana Reyes', email: 'ana@x.test', stamps: 3 })
    const owner = await seedStaff(db.sql, { fullName: 'Olive', role: 'owner' })
    await db.sql`insert into points_ledger (customer_id, delta, reason, note, created_at, created_by_staff)
      values (${ana.id}, 37, 'adjustment', 'Welcome', ${NOW}, ${owner})`
    await onlineOrder(ana.id, 'Pickup Jo')
    await onlineOrder(null, 'Guest Lu')

    const res = await lookup(ana.code)
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const lookupRaw = await res.text()
    const found = JSON.parse(lookupRaw) as TillCustomer
    expect(Object.keys(found).sort()).toEqual(TILL_KEYS)
    expect(found).toEqual({ code: ana.code, catName: null, stampMode: 'digital', stamps: 3, fullCards: 0 })

    await linkOnTill(ana.code)
    const { state, raw } = await pull()
    expect(state.customers![0]).toBeDefined()
    expect(Object.keys(state.customers![0]!).sort()).toEqual(TILL_KEYS)
    expect(state.customers!.find((c) => c.code === ana.code)).toEqual(found)

    for (const text of [raw, lookupRaw]) {
      expect(text).not.toContain('Ana Reyes')
      expect(text).not.toContain('ana@x.test')
    }
    const leaked = [...keysDeep(state.customers), ...keysDeep(found)].filter((k) => PRIVATE_KEYS.includes(k))
    expect(leaked).toEqual([])
    expect(state.onlineOrders!.length).toBeGreaterThan(0)
    for (const o of state.onlineOrders!) expect(['stamp', 'stamped', 'paper', null]).toContain(o.card)
  })
})

describe('GET /v1/customers/by-code/:code', () => {
  test('a lower-case code with spaces works', async () => {
    const c = await customer({ stamps: 9 })
    const typed = `kc ${c.bare.slice(0, 3)} ${c.bare.slice(3)}`.toLowerCase()
    const res = await lookup(typed)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ code: c.code, catName: null, stampMode: 'digital', stamps: 1, fullCards: 1 })
  })

  test('a typo is 400 BAD_CODE; a valid code nobody holds is 404 UNKNOWN_CUSTOMER', async () => {
    const c = await customer()
    const swapped = c.bare[1] + c.bare[0] + c.bare.slice(2)
    const typo = await lookup(c.bare[0] === c.bare[1] ? c.bare.slice(0, 8) : swapped)
    expect(typo.status).toBe(400)
    expect(await typo.json()).toMatchObject({ code: 'BAD_CODE' })
    const nobody = await lookup(makePublicCode(randomInt))
    expect(nobody.status).toBe(404)
    expect(await nobody.json()).toMatchObject({ code: 'UNKNOWN_CUSTOMER' })
  })

  test(`the ${LOOKUPS_PER_MINUTE + 1}st lookup in a minute is 429; the next minute answers again`, async () => {
    const { token: busy } = await seedDevice(db.sql, 'Busy till')
    const c = await customer()
    for (let i = 0; i < LOOKUPS_PER_MINUTE; i++) expect((await lookup(c.code, busy)).status).toBe(200)
    const over = await lookup(c.code, busy)
    expect(over.status).toBe(429)
    expect(await over.json()).toMatchObject({ code: 'RATE_LIMITED' })
    // Another till has its own count.
    expect((await lookup(c.code)).status).toBe(200)
    api.setNow(new Date(NOW.getTime() + 60_000))
    try {
      expect((await lookup(c.code, busy)).status).toBe(200)
    } finally {
      api.setNow(NOW)
    }
  })

  test('no device token is 401; a revoked device is 401', async () => {
    const c = await customer()
    expect((await lookup(c.code, null)).status).toBe(401)
    const gone = await seedDevice(db.sql, 'Old till')
    await db.sql`update devices set revoked_at = now() where id = ${gone.deviceId}`
    expect((await lookup(c.code, gone.token)).status).toBe(401)
  })
})

describe('hit()', () => {
  test('counts per key and minute, and deletes the key’s windows older than 10 minutes', async () => {
    const t0 = new Date('2026-11-21T03:00:10Z')
    expect(await hit(db.sql, 'test:a', 2, t0)).toBe(true)
    expect(await hit(db.sql, 'test:a', 2, new Date(t0.getTime() + 30_000))).toBe(true)
    expect(await hit(db.sql, 'test:a', 2, new Date(t0.getTime() + 40_000))).toBe(false)
    expect(await hit(db.sql, 'test:b', 2, t0)).toBe(true)
    expect(await hit(db.sql, 'test:a', 2, new Date(t0.getTime() + 11 * 60_000))).toBe(true)
    const rows = await db.sql<{ key: string; hits: number }[]>`
      select key, hits from rate_limits where key like 'test:%' order by key, window_start`
    expect(rows.map((r) => [r.key, r.hits])).toEqual([
      ['test:a', 1],
      ['test:b', 1],
    ])
  })
})

describe('POST /v1/stamp-cards/claim', () => {
  test('one successful claim when two arrive at once', async () => {
    const c = await customer({ stamps: 8 })
    const [a, b] = await Promise.all([
      claim({ claimId: randomUUID(), code: c.code, staffId: bea }),
      claim({ claimId: randomUUID(), code: c.code, staffId: bea }),
    ])
    expect([a!.status, b!.status].sort()).toEqual([200, 409])
    const loser = a!.status === 409 ? a! : b!
    expect(await loser.json()).toMatchObject({ code: 'NO_FREE_DRINK' })
    const cards = await cardsOf(c.id)
    expect(cards.filter((x) => x.claimed_at !== null)).toHaveLength(1)
  })

  test('a claim answers the customer after it; the same claimId twice is 200 both times and claims one card', async () => {
    const c = await customer({ stamps: 17 })
    const claimId = randomUUID()
    const first = await claim({ claimId, code: c.code, staffId: bea })
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({
      customer: { code: c.code, catName: null, stampMode: 'digital', stamps: 1, fullCards: 1 },
    })
    const again = await claim({ claimId, code: c.code, staffId: bea })
    expect(again.status).toBe(200)
    expect(((await again.json()) as { customer: TillCustomer }).customer.fullCards).toBe(1)
    const claimed = (await cardsOf(c.id)).filter((x) => x.claimed_at !== null)
    expect(claimed).toEqual([
      expect.objectContaining({ claim_id: claimId, claimed_by_staff: bea, claimed_device_id: deviceId }),
    ])
  })

  test('a staffId that matches no staff is stored as null', async () => {
    const c = await customer({ stamps: 8 })
    expect((await claim({ claimId: randomUUID(), code: c.code, staffId: randomUUID() })).status).toBe(200)
    expect((await cardsOf(c.id))[0]).toMatchObject({ claimed_by_staff: null, claimed_device_id: deviceId })
  })

  test('paper is 409 PAPER_CARD; no full card is 409 NO_FREE_DRINK; unknown is 404; a bad code is 400', async () => {
    const paper = await customer({ mode: 'paper' })
    const p = await claim({ claimId: randomUUID(), code: paper.code, staffId: null })
    expect(p.status).toBe(409)
    expect(await p.json()).toMatchObject({ code: 'PAPER_CARD' })
    const short = await customer({ stamps: 7 })
    const s = await claim({ claimId: randomUUID(), code: short.code, staffId: null })
    expect(s.status).toBe(409)
    expect(await s.json()).toMatchObject({ code: 'NO_FREE_DRINK' })
    const u = await claim({ claimId: randomUUID(), code: makePublicCode(randomInt), staffId: null })
    expect(u.status).toBe(404)
    expect(await u.json()).toMatchObject({ code: 'UNKNOWN_CUSTOMER' })
    const bad = await claim({ claimId: randomUUID(), code: 'KC-123', staffId: null })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ code: 'BAD_CODE' })
  })

  test('a malformed body is 400 INVALID; no device token is 401', async () => {
    const c = await customer({ stamps: 8 })
    const r = await claim({ claimId: 'nope', code: c.code, staffId: null })
    expect(r.status).toBe(400)
    expect(await r.json()).toMatchObject({ code: 'INVALID' })
    expect((await req('POST', '/v1/stamp-cards/claim', null, { claimId: randomUUID(), code: c.code, staffId: null })).status).toBe(401)
    expect((await cardsOf(c.id))[0]!.claimed_at).toBeNull()
  })
})

describe('POST /v1/stamp-cards/release', () => {
  test('release leaves the card unclaimed and full', async () => {
    const c = await customer({ stamps: 8 })
    const claimId = randomUUID()
    expect((await claim({ claimId, code: c.code, staffId: bea })).status).toBe(200)
    const r = await release(claimId)
    expect(r.status).toBe(200)
    expect(r.headers.get('Cache-Control')).toBe('no-store')
    expect(await r.json()).toEqual({ released: true })
    const cards = await cardsOf(c.id)
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ claimed_at: null, claim_id: null, claimed_device_id: null })
    expect(cards[0]!.filled_at).not.toBeNull()
    expect(await release(claimId).then((x) => x.json())).toEqual({ released: false })
  })

  test('after reward.used the claim stays: released false', async () => {
    const c = await customer({ stamps: 8 })
    const claimId = randomUUID()
    expect((await claim({ claimId, code: c.code, staffId: bea })).status).toBe(200)
    const s = sale()
    const res = await api.push(token, [
      s,
      customerLinked({ orderId: s.payload.orderId, publicCode: c.code }, { staffId: bea }),
      rewardUsed({ claimId, orderId: s.payload.orderId }, { staffId: bea }),
    ])
    expect(res.results.map((r) => r.result)).toEqual(['applied', 'applied', 'applied'])
    expect(await release(claimId).then((x) => x.json())).toEqual({ released: false })
    expect((await cardsOf(c.id))[0]).toMatchObject({ claim_id: claimId })
  })

  test("another device's release is released false", async () => {
    const c = await customer({ stamps: 8 })
    const claimId = randomUUID()
    expect((await claim({ claimId, code: c.code, staffId: bea })).status).toBe(200)
    expect(await release(claimId, otherToken).then((x) => x.json())).toEqual({ released: false })
    expect((await cardsOf(c.id))[0]).toMatchObject({ claim_id: claimId })
  })

  test('an unknown claim is released false; a malformed body is 400', async () => {
    expect(await release(randomUUID()).then((x) => x.json())).toEqual({ released: false })
    expect((await req('POST', '/v1/stamp-cards/release', token, { claimId: 'x' })).status).toBe(400)
  })
})

describe('the pull', () => {
  test('customers linked on this till in the last 30 minutes; not 31 minutes ago, not another till', async () => {
    const recent = await customer({ stamps: 2 })
    const old = await customer()
    const elsewhere = await customer()
    api.setNow(new Date(NOW.getTime() - 31 * 60_000))
    try {
      await linkOnTill(old.code)
    } finally {
      api.setNow(NOW)
    }
    await linkOnTill(recent.code)
    await linkOnTill(elsewhere.code, otherToken)
    const codes = (await pull()).state.customers!.map((c) => c.code)
    expect(codes).toContain(recent.code)
    expect(codes).not.toContain(old.code)
    expect(codes).not.toContain(elsewhere.code)
    expect((await pull(otherToken)).state.customers!.map((c) => c.code)).toContain(elsewhere.code)
    expect((await pull()).state.customers!.find((c) => c.code === recent.code)).toMatchObject({ stamps: 2 })
  })

  test('the same customer linked twice appears once', async () => {
    const c = await customer()
    await linkOnTill(c.code)
    await linkOnTill(c.code)
    expect((await pull()).state.customers!.filter((x) => x.code === c.code)).toHaveLength(1)
  })

  test('a deleted customer drops out of customers on the next pull', async () => {
    const c = await customer()
    await linkOnTill(c.code)
    expect((await pull()).state.customers!.map((x) => x.code)).toContain(c.code)
    await db.sql`delete from customers where id = ${c.id}`
    expect((await pull()).state.customers!.map((x) => x.code)).not.toContain(c.code)
  })

  test("an online order linked at checkout shows card 'stamp', then 'stamped' after a pushed stamp.added", async () => {
    const c = await customer()
    const orderId = await onlineOrder(c.id)
    const cardOf = async () => (await pull()).state.onlineOrders!.find((o) => o.id === orderId)!.card
    expect(await cardOf()).toBe('stamp')
    const res = await api.push(token, [stampAdded({ orderId }, { staffId: bea })])
    expect(res.results.map((r) => [r.result, r.reason])).toEqual([['applied', null]])
    expect(await cardOf()).toBe('stamped')
  })

  test("online cards: 'paper' for a paper customer, null for a guest", async () => {
    const paper = await customer({ mode: 'paper' })
    const paperOrder = await onlineOrder(paper.id)
    const guestOrder = await onlineOrder(null)
    const { state } = await pull()
    expect(state.onlineOrders!.find((o) => o.id === paperOrder)!.card).toBe('paper')
    expect(state.onlineOrders!.find((o) => o.id === guestOrder)!.card).toBeNull()
  })
})

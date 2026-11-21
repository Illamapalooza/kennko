import { randomUUID } from 'node:crypto'
import type postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addStamp, claimFreeDrink, removeOrderStamp, repackCards, unclaim } from '../src/loyalty/cards.js'
import { cardSummary, customerByCode, lockCustomer, tillCustomer } from '../src/loyalty/customers.js'
import { adjustPoints, balance, creditOrderPoints, dropOrderPoints, reverseOrderPoints } from '../src/loyalty/points.js'
import { startTestDb, type TestDb } from './pg.js'

const OWNER = '22222222-2222-4222-8222-222222222222'
const DEVICE = '33333333-3333-4333-8333-333333333333'
const SHIFT = '55555555-5555-4555-8555-555555555551'
const T0 = Date.parse('2026-11-21T01:00:00Z')
const NOW = new Date('2026-11-21T09:00:00Z')

let db: TestDb
let ticket = 0
let codeSeq = 100

type Tx = postgres.TransactionSql
const tx = <T>(fn: (t: Tx) => Promise<T>) => db.sql.begin(fn) as Promise<T>

/** A unique 9-symbol code from the alphabet (the check symbol is not exercised here). */
function code(): string {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
  let n = ++codeSeq
  let out = ''
  for (let i = 0; i < 9; i++) {
    out += alphabet[n % alphabet.length]
    n = Math.floor(n / alphabet.length)
  }
  return out
}

async function customer(mode: 'none' | 'digital' | 'paper' = 'none') {
  const id = randomUUID()
  const c = code()
  await db.sql`insert into auth.users (id, email) values (${id}, ${`${id}@x.test`})`
  await db.sql`insert into customers (id, public_code, display_name, stamp_mode, age_confirmed_at, privacy_accepted_at,
      privacy_version, created_at)
    values (${id}, ${c}, 'Ana Real-Name', ${mode}, ${NOW}, ${NOW}, '2026-11', ${NOW})`
  return { id, code: c }
}

type OrderOpts = {
  customerId?: string | null
  paid?: boolean
  cancelled?: boolean
  subtotal?: number
  discount?: number
  rewardLine?: number
}

async function counterOrder(o: OrderOpts = {}) {
  ticket += 1
  const subtotal = o.subtotal ?? 12000
  const discount = o.discount ?? 0
  const [row] = await db.sql`
    insert into orders (channel, fulfilment, business_day, ticket_series, ticket_number, customer_name,
      prep_status, payment_status, subtotal_centavos, discount_centavos, delivery_fee_centavos, total_centavos,
      device_id, shift_id, customer_id)
    values ('counter', 'dine_in', '2026-11-21', 'C', ${ticket}, 'Walk-in',
      ${o.cancelled ? 'cancelled' : 'completed'}, ${o.paid === false ? 'unpaid' : 'paid'},
      ${subtotal}, ${discount}, 0, ${subtotal - discount}, ${DEVICE}, ${SHIFT}, ${o.customerId ?? null})
    returning id`
  const id = row!.id as string
  if (o.rewardLine !== undefined) {
    await db.sql`insert into order_lines (order_id, item_name, variant_code, variant_label, unit_price_centavos,
        quantity, line_total_centavos, is_reward)
      values (${id}, 'Latte', 'M', 'Medium', 0, 1, ${o.rewardLine}, true)`
  }
  return id
}

let stampSeq = 0
/** Stamps an order for the customer; stamp times increase so card order is predictable. */
async function stamp(customerId: string, orderId?: string) {
  const oid = orderId ?? (await counterOrder({ customerId }))
  const stampId = randomUUID()
  stampSeq += 1
  const r = await tx((t) =>
    addStamp(t, {
      customerId,
      stampId,
      orderId: oid,
      staffId: OWNER,
      deviceId: DEVICE,
      stampedAt: new Date(T0 + stampSeq * 60_000).toISOString(),
      now: NOW,
    }),
  )
  return { result: r, stampId, orderId: oid }
}

type CardRow = { id: string; filled_at: Date | null; claimed_at: Date | null; claim_id: string | null; n: number }
async function cards(customerId: string): Promise<CardRow[]> {
  return db.sql<CardRow[]>`
    select c.id, c.filled_at, c.claimed_at, c.claim_id,
      (select count(*)::int from stamps s where s.card_id = c.id and not ('forgiven' = any(s.flags))) as n
    from stamp_cards c where c.customer_id = ${customerId}
    order by c.filled_at nulls last, c.started_at, c.id`
}

beforeAll(async () => {
  db = await startTestDb()
  await db.sql
    .unsafe(
      `insert into auth.users (id, email) values ('${OWNER}', 'o@x.test');
       insert into staff (id, user_id, email, full_name, role) values ('${OWNER}', '${OWNER}', 'o@x.test', 'Olive', 'owner');
       insert into devices (id, name) values ('${DEVICE}', 'Front till');
       insert into shifts (id, device_id, opened_at, opened_by_staff, opening_float_centavos)
         values ('${SHIFT}', '${DEVICE}', '2026-11-21T00:00:00Z', '${OWNER}', 100000);
       insert into delivery_zones (barangay, fee_centavos, latitude, longitude) values ('Libertad', 5000, 8.942, 125.529);`,
    )
    .simple()
})
afterAll(async () => {
  await db.stop()
})

describe('customers', () => {
  it('lockCustomer returns the id and mode, or null', async () => {
    const c = await customer('digital')
    expect(await tx((t) => lockCustomer(t, c.id))).toEqual({ id: c.id, stamp_mode: 'digital' })
    expect(await tx((t) => lockCustomer(t, randomUUID()))).toBeNull()
  })

  it('customerByCode finds the bare code', async () => {
    const c = await customer()
    expect(await tx((t) => customerByCode(t, c.code))).toMatchObject({ id: c.id, stamp_mode: 'none' })
    expect(await tx((t) => customerByCode(t, 'ZZZZZZZZZ'))).toBeNull()
  })

  it('tillCustomer carries only the allowlisted keys, with catName null and the code formatted', async () => {
    const c = await customer()
    await stamp(c.id)
    const view = await tx((t) => tillCustomer(t, c.id))
    expect(Object.keys(view).sort()).toEqual(['catName', 'code', 'fullCards', 'stampMode', 'stamps'])
    expect(view).toEqual({
      code: `KC-${c.code.slice(0, 3)}-${c.code.slice(3, 6)}-${c.code.slice(6)}`,
      catName: null,
      stampMode: 'digital',
      stamps: 1,
      fullCards: 0,
    })
  })
})

describe('stamps', () => {
  it('one stamp per order', async () => {
    const c = await customer()
    const first = await stamp(c.id)
    expect(first.result).toBe('added')
    const again = await tx((t) =>
      addStamp(t, { customerId: c.id, stampId: first.stampId, orderId: first.orderId, staffId: null, deviceId: null, stampedAt: NOW.toISOString(), now: NOW }),
    )
    expect(again).toBe('already_recorded')
    expect((await stamp(c.id, first.orderId)).result).toBe('already_stamped')
    const rows = await db.sql`select id from stamps where order_id = ${first.orderId}`
    expect(rows.map((r) => r.id)).toEqual([first.stampId])
  })

  it('the first stamp moves a customer from none to digital', async () => {
    const c = await customer('none')
    await stamp(c.id)
    const [row] = await db.sql`select stamp_mode from customers where id = ${c.id}`
    expect(row!.stamp_mode).toBe('digital')
  })

  it('a 9th stamp rolling onto a fresh card', async () => {
    const c = await customer()
    for (let i = 0; i < 8; i++) await stamp(c.id)
    let cs = await cards(c.id)
    expect(cs).toHaveLength(1)
    expect(cs[0]!.n).toBe(8)
    expect(cs[0]!.filled_at).not.toBeNull()
    const cardA = cs[0]!.id

    await stamp(c.id)
    cs = await cards(c.id)
    expect(cs.map((x) => [x.id === cardA, x.n, x.filled_at === null, x.claimed_at])).toEqual([
      [true, 8, false, null],
      [false, 1, true, null],
    ])

    for (let i = 0; i < 8; i++) await stamp(c.id)
    cs = await cards(c.id)
    expect(cs.map((x) => [x.n, x.filled_at === null])).toEqual([
      [8, false],
      [8, false],
      [1, true],
    ])
    expect(await tx((t) => cardSummary(t, c.id))).toMatchObject({ fullCards: 2, stamps: [{ stampedAt: expect.any(String) }] })
  })

  it('removing stamp 3 of 9 pulls the 9th onto the full card and deletes the empty one', async () => {
    const c = await customer()
    const made: Awaited<ReturnType<typeof stamp>>[] = []
    for (let i = 0; i < 9; i++) made.push(await stamp(c.id))
    const [cardA, cardB] = (await cards(c.id)).map((x) => x.id)
    expect(await tx((t) => removeOrderStamp(t, made[2]!.orderId, NOW))).toBe('removed')
    const cs = await cards(c.id)
    expect(cs).toHaveLength(1)
    expect(cs[0]).toMatchObject({ id: cardA, n: 8 })
    expect(cs[0]!.filled_at).not.toBeNull()
    const [moved] = await db.sql`select card_id from stamps where id = ${made[8]!.stampId}`
    expect(moved!.card_id).toBe(cardA)
    expect(await db.sql`select id from stamp_cards where id = ${cardB!}`).toHaveLength(0)
    expect(await tx((t) => removeOrderStamp(t, made[2]!.orderId, NOW))).toBe('none')
  })

  it('removing a stamp on a claimed card forgives it and changes no counts', async () => {
    const c = await customer()
    const made: Awaited<ReturnType<typeof stamp>>[] = []
    for (let i = 0; i < 9; i++) made.push(await stamp(c.id))
    expect(await tx((t) => claimFreeDrink(t, { customerId: c.id, claimId: randomUUID(), staffId: OWNER, deviceId: DEVICE, now: NOW }))).toBe('claimed')
    const before = await cards(c.id)
    expect(await tx((t) => removeOrderStamp(t, made[0]!.orderId, NOW))).toBe('forgiven')
    const [row] = await db.sql`select flags, card_id from stamps where id = ${made[0]!.stampId}`
    expect(row!.flags).toEqual(['forgiven'])
    expect(row!.card_id).toBe(before[0]!.id)
    const after = await db.sql`select id, filled_at, claimed_at,
      (select count(*)::int from stamps s where s.card_id = c.id) as n from stamp_cards c where customer_id = ${c.id}
      order by started_at, id`
    expect(after.map((x) => x.n).sort()).toEqual([1, 8])
    expect((await tx((t) => cardSummary(t, c.id))).stamps).toHaveLength(1)
    // The forgiven stamp no longer blocks stamping that order again (for instance for the right customer).
    const other = await customer()
    expect((await stamp(other.id, made[0]!.orderId)).result).toBe('added')
  })

  it('a stamp for a paper customer has no card and the mode_was_paper flag', async () => {
    const c = await customer('paper')
    const s = await stamp(c.id)
    expect(s.result).toBe('paper')
    const [row] = await db.sql`select card_id, flags from stamps where id = ${s.stampId}`
    expect(row).toEqual({ card_id: null, flags: ['mode_was_paper'] })
    expect(await cards(c.id)).toEqual([])
    const [m] = await db.sql`select stamp_mode from customers where id = ${c.id}`
    expect(m!.stamp_mode).toBe('paper')
  })

  it('repackCards with nothing to do leaves the cards as they are', async () => {
    const c = await customer()
    for (let i = 0; i < 3; i++) await stamp(c.id)
    const before = await cards(c.id)
    await tx((t) => repackCards(t, c.id, NOW))
    expect(await cards(c.id)).toEqual(before)
  })
})

describe('claims', () => {
  it('two full cards: two claims take the oldest first; a third finds none; a repeat is already_claimed', async () => {
    const c = await customer()
    for (let i = 0; i < 16; i++) await stamp(c.id)
    const [oldest, newer] = await cards(c.id)
    const claim = (claimId: string) => tx((t) => claimFreeDrink(t, { customerId: c.id, claimId, staffId: OWNER, deviceId: DEVICE, now: NOW }))
    const k1 = randomUUID()
    const k2 = randomUUID()
    expect(await claim(k1)).toBe('claimed')
    expect((await db.sql`select claim_id from stamp_cards where id = ${oldest!.id}`)[0]!.claim_id).toBe(k1)
    expect(await claim(k2)).toBe('claimed')
    expect((await db.sql`select claim_id from stamp_cards where id = ${newer!.id}`)[0]!.claim_id).toBe(k2)
    expect(await claim(randomUUID())).toBe('none_full')
    expect(await claim(k1)).toBe('already_claimed')

    expect(await tx((t) => unclaim(t, { claimId: k1 }, NOW))).toBe('unclaimed')
    const [row] = await db.sql`select claimed_at, claim_id, filled_at from stamp_cards where id = ${oldest!.id}`
    expect(row).toMatchObject({ claimed_at: null, claim_id: null })
    expect(row!.filled_at).not.toBeNull()
    expect((await tx((t) => cardSummary(t, c.id))).fullCards).toBe(1)
  })

  it('one successful claim when two arrive at once', async () => {
    const c = await customer()
    for (let i = 0; i < 8; i++) await stamp(c.id)
    const results = await Promise.all(
      [randomUUID(), randomUUID()].map((claimId) =>
        tx((t) => claimFreeDrink(t, { customerId: c.id, claimId, staffId: OWNER, deviceId: DEVICE, now: NOW })),
      ),
    )
    expect(results.sort()).toEqual(['claimed', 'none_full'])
    expect((await db.sql`select count(*)::int as n from stamp_cards where customer_id = ${c.id} and claimed_at is not null`)[0]!.n).toBe(1)
  })

  it('unclaim by order clears the claim, drops forgiven stamps and repacks', async () => {
    const c = await customer()
    const made: Awaited<ReturnType<typeof stamp>>[] = []
    for (let i = 0; i < 8; i++) made.push(await stamp(c.id))
    const claimId = randomUUID()
    await tx((t) => claimFreeDrink(t, { customerId: c.id, claimId, staffId: OWNER, deviceId: DEVICE, now: NOW }))
    const freeOrder = await counterOrder({ customerId: c.id, rewardLine: 0 })
    await db.sql`update stamp_cards set claimed_order_id = ${freeOrder} where claim_id = ${claimId}`
    await tx((t) => removeOrderStamp(t, made[0]!.orderId, NOW))
    expect(await tx((t) => unclaim(t, { orderId: freeOrder }, NOW))).toBe('unclaimed')
    const cs = await cards(c.id)
    expect(cs).toHaveLength(1)
    expect(cs[0]).toMatchObject({ n: 7, filled_at: null, claimed_at: null })
    expect(await db.sql`select id from stamps where id = ${made[0]!.stampId}`).toHaveLength(0)
    expect(await tx((t) => unclaim(t, { orderId: freeOrder }, NOW))).toBe('none')
  })
})

describe('points', () => {
  it('reversal after the points were spent', async () => {
    const c = await customer()
    const orderId = await counterOrder({ customerId: c.id, subtotal: 24000 })
    expect(await tx((t) => creditOrderPoints(t, orderId, NOW))).toBe(24)
    await db.sql`insert into points_ledger (customer_id, delta, reason, cosmetic_id, created_at)
      values (${c.id}, -20, 'cosmetic', (select id from cosmetics where key = 'kennko-cup'), ${NOW})`
    expect(await tx((t) => balance(t, c.id))).toBe(4)
    expect(await tx((t) => reverseOrderPoints(t, orderId, NOW))).toBe(-24)
    const [rev] = await db.sql`select delta from points_ledger where order_id = ${orderId} and reason = 'order_reversed'`
    expect(rev!.delta).toBe(-24)
    expect(await tx((t) => balance(t, c.id))).toBe(-20)
    expect(await tx((t) => reverseOrderPoints(t, orderId, NOW))).toBe(0)
    expect((await db.sql`select count(*)::int as n from points_ledger where customer_id = ${c.id}`)[0]!.n).toBe(3)
  })

  it('no credit for an unpaid, cancelled or unlinked order', async () => {
    const c = await customer()
    for (const o of [{ paid: false }, { cancelled: true }, { customerId: null }] as OrderOpts[]) {
      const id = await counterOrder({ customerId: c.id, ...o })
      expect(await tx((t) => creditOrderPoints(t, id, NOW))).toBe(0)
    }
    expect(await tx((t) => balance(t, c.id))).toBe(0)
  })

  it('a second credit still writes one row', async () => {
    const c = await customer()
    const id = await counterOrder({ customerId: c.id })
    expect(await tx((t) => creditOrderPoints(t, id, NOW))).toBe(12)
    expect(await tx((t) => creditOrderPoints(t, id, NOW))).toBe(0)
    expect((await db.sql`select count(*)::int as n from points_ledger where order_id = ${id}`)[0]!.n).toBe(1)
  })

  it('₱300 with a ₱40 free line earns 26 points; under ₱10 earns nothing and writes no row', async () => {
    const c = await customer()
    const id = await counterOrder({ customerId: c.id, subtotal: 30000, rewardLine: 4000 })
    expect(await tx((t) => creditOrderPoints(t, id, NOW))).toBe(26)
    const small = await counterOrder({ customerId: c.id, subtotal: 900 })
    expect(await tx((t) => creditOrderPoints(t, small, NOW))).toBe(0)
    expect(await db.sql`select id from points_ledger where order_id = ${small}`).toHaveLength(0)
  })

  it("an online order's delivery fee earns nothing", async () => {
    const c = await customer()
    const [zone] = await db.sql`select id from delivery_zones limit 1`
    const [o] = await db.sql`
      insert into orders (channel, order_code, fulfilment, prep_status, payment_status, business_day, ticket_series,
        ticket_number, customer_name, customer_phone, customer_email, fulfil_at, delivery_address, delivery_barangay,
        delivery_zone_id, subtotal_centavos, delivery_fee_centavos, total_centavos, customer_id)
      values ('online', 'KNK-PTS1', 'delivery', 'completed', 'paid', '2026-11-21', 'W', 1, 'Ana', '09170000000',
        'a@x.test', ${NOW}, '1 Street', 'Libertad', ${zone!.id}, 12000, 5000, 17000, ${c.id})
      returning id`
    expect(await tx((t) => creditOrderPoints(t, o!.id as string, NOW))).toBe(12)
  })

  it('dropOrderPoints deletes the order rows for that customer, so the right customer can be credited', async () => {
    const wrong = await customer()
    const right = await customer()
    const id = await counterOrder({ customerId: wrong.id })
    await tx((t) => creditOrderPoints(t, id, NOW))
    expect(await tx((t) => dropOrderPoints(t, id, wrong.id))).toBe(1)
    expect(await tx((t) => balance(t, wrong.id))).toBe(0)
    await db.sql`update orders set customer_id = ${right.id} where id = ${id}`
    expect(await tx((t) => creditOrderPoints(t, id, NOW))).toBe(12)
  })

  it('adjustPoints writes an adjustment row by staff with a note', async () => {
    const c = await customer()
    await tx((t) => adjustPoints(t, { customerId: c.id, delta: 5, note: 'Missed stamp day', staffId: OWNER, now: NOW }))
    const [row] = await db.sql`select reason, note, created_by_staff, delta from points_ledger where customer_id = ${c.id}`
    expect(row).toEqual({ reason: 'adjustment', note: 'Missed stamp day', created_by_staff: OWNER, delta: 5 })
    expect(await tx((t) => balance(t, c.id))).toBe(5)
  })
})

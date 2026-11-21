import { randomInt, randomUUID } from 'node:crypto'
import { CODE_ALPHABET, formatPublicCode, makePublicCode, type AttentionView, type CounterOrderPayload, type PushResponse } from '@kennko/core'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { AppDeps } from '../src/create-app.js'
import { claimFreeDrink } from '../src/loyalty/cards.js'
import { publishMenu } from '../src/menu/snapshot.js'
import { cancelOrder, decidePayment } from '../src/orders/actions.js'
import { envelopeSchema, payloadSchemas } from '../src/sync/schema.js'
import { fakeAuthAdmin, fakeProofs, inlineDefer } from './fakes.js'
import { startTestDb, type TestDb } from './pg.js'
import {
  customerLinked,
  customerUnlinked,
  orderCancelled,
  orderCreated,
  rewardUsed,
  seedDevice,
  seedStaff,
  shiftOpened,
  stampAdded,
  syncApp,
} from './sync-helpers.js'

const NOW = new Date('2026-11-21T02:00:00Z')

let db: TestDb
let api: ReturnType<typeof syncApp>
let deps: AppDeps
let token: string
let deviceId: string
let bea: string
let ownerLogin: string
let version: number
let shiftId: string
let latteId: string
let oatId: string
let ensaymadaId: string
let ticket = 0

type Line = CounterOrderPayload['lines'][number]

const latte = (over: Partial<Line> = {}): Line => ({
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
  ...over,
})
const ensaymada = (): Line => ({
  menuItemId: ensaymadaId,
  name: 'Ensaymada',
  size: 'M',
  basePriceCentavos: 6500,
  modifiers: [],
  quantity: 1,
  iceLevel: null,
  iceServe: null,
  note: '',
  lineTotalCentavos: 6500,
})

/** A counter sale at the published prices: ₱180 latte + ₱65 ensaymada = ₱245 unless lines are given. */
function sale(lines: Line[] = [latte(), ensaymada()]) {
  ticket += 1
  const subtotal = lines.reduce((s, l) => s + l.lineTotalCentavos, 0)
  return orderCreated(
    {
      shiftId,
      ticketNumber: ticket,
      menuVersion: version,
      lines,
      subtotalCentavos: subtotal,
      totalCentavos: subtotal,
      payment: { id: randomUUID(), method: 'cash', tenderedCentavos: subtotal, changeCentavos: 0, reference: null },
    },
    { staffId: bea },
  )
}

async function customer(mode: 'none' | 'digital' | 'paper' = 'none') {
  const id = randomUUID()
  const bare = makePublicCode(randomInt)
  await db.sql`insert into auth.users (id, email) values (${id}, ${`${id}@x.test`})`
  await db.sql`insert into customers (id, public_code, display_name, stamp_mode, age_confirmed_at, privacy_accepted_at,
      privacy_version, created_at)
    values (${id}, ${bare}, 'Ana', ${mode}, ${NOW}, ${NOW}, '2026-11', ${NOW})`
  return { id, code: formatPublicCode(bare), bare }
}

/** An online order linked at checkout. Lines are food or drink by item. */
async function onlineOrder(o: { customerId: string; items: string[]; pay: 'paid' | 'pending_verification'; subtotal?: number }) {
  ticket += 1
  const subtotal = o.subtotal ?? 24500
  const [row] = await db.sql`
    insert into orders (channel, order_code, fulfilment, prep_status, payment_status, business_day,
      ticket_series, ticket_number, customer_name, customer_phone, customer_email, fulfil_at,
      subtotal_centavos, total_centavos, customer_id)
    values ('online', ${'KNK-L' + ticket}, 'pickup', 'placed', ${o.pay}, '2026-11-21', 'W', ${ticket}, 'Ana',
      '09170000000', 'a@x.test', ${NOW}, ${subtotal}, ${subtotal}, ${o.customerId})
    returning id`
  const orderId = row!.id as string
  for (const itemId of o.items) {
    await db.sql`insert into order_lines (order_id, item_id, item_name, variant_code, variant_label, unit_price_centavos,
        quantity, line_total_centavos)
      values (${orderId}, ${itemId}, 'x', 'M', 'Medium', 100, 1, 100)`
  }
  const [pay] = await db.sql`insert into payments (order_id, method, amount_centavos, reference, status)
    values (${orderId}, 'gcash', ${subtotal}, ${'GC-' + ticket}, ${o.pay === 'paid' ? 'verified' : 'pending_verification'})
    returning id`
  return { orderId, paymentId: pay!.id as string }
}

const answers = (res: PushResponse) => res.results.map((r) => [r.result, r.reason])
const stampsOf = (orderId: string) =>
  db.sql<{ id: string; customer_id: string; card_id: string | null; flags: string[] }[]>`
    select id, customer_id, card_id, flags from stamps where order_id = ${orderId}`
const ledgerOf = (orderId: string) =>
  db.sql<{ customer_id: string; delta: number; reason: string }[]>`
    select customer_id, delta, reason from points_ledger where order_id = ${orderId} order by created_at, reason`
const balanceOf = async (customerId: string) =>
  (await db.sql<{ n: number }[]>`select coalesce(sum(delta), 0)::int as n from points_ledger where customer_id = ${customerId}`)[0]!.n
const orderRow = async (orderId: string) =>
  (await db.sql<{ customer_id: string | null; flags: string[] }[]>`select customer_id, flags from orders where id = ${orderId}`)[0]!
const receipt = async (id: string) =>
  (await db.sql<{ result: string; reason: string | null }[]>`select result, reason from sync_events where id = ${id}`)[0]

beforeAll(async () => {
  db = await startTestDb()
  api = syncApp(db.sql, NOW, { verifyUser: async (t) => ({ userId: t }) })
  deps = {
    sql: db.sql,
    verifyUser: async () => ({ userId: 'x' }),
    proofs: fakeProofs(),
    authAdmin: fakeAuthAdmin(),
    now: () => NOW,
    push: null,
    defer: inlineDefer,
    webKey: null,
  }
  ;({ token, deviceId } = await seedDevice(db.sql))
  bea = await seedStaff(db.sql, { fullName: 'Bea' })
  const owner = await seedStaff(db.sql, { fullName: 'Olive', role: 'owner' })
  ownerLogin = (await db.sql`select user_id from staff where id = ${owner}`)[0]!.user_id as string

  const [coffee] = await db.sql`insert into menu_categories (name, kind, sort_order) values ('Coffee', 'drink', 0) returning id`
  const [food] = await db.sql`insert into menu_categories (name, kind, sort_order) values ('Pastries', 'food', 1) returning id`
  const [l] = await db.sql`insert into menu_items (category_id, name) values (${coffee!.id}, 'Spanish Latte') returning id`
  latteId = l!.id as string
  await db.sql`insert into menu_variants (item_id, code, label, price_centavos, temperature)
    values (${latteId}, 'M', 'Medium', 18000, 'iced')`
  const [e] = await db.sql`insert into menu_items (category_id, name) values (${food!.id}, 'Ensaymada') returning id`
  ensaymadaId = e!.id as string
  await db.sql`insert into menu_variants (item_id, code, label, price_centavos, temperature)
    values (${ensaymadaId}, 'M', 'Piece', 6500, 'none')`
  const [group] = await db.sql`insert into option_groups (name) values ('Milk of Choice') returning id`
  const [oat] = await db.sql`insert into options (group_id, name, price_centavos) values (${group!.id}, 'Oat milk', 3500) returning id`
  oatId = oat!.id as string
  await db.sql`insert into item_option_groups (item_id, group_id) values (${latteId}, ${group!.id})`
  version = (await publishMenu(db.sql, null)).version
})
afterAll(async () => {
  await db.stop()
})

describe('the push engine knows every kind', () => {
  test('the envelope accepts every kind that has a payload schema', () => {
    expect([...envelopeSchema.shape.kind.options].sort()).toEqual(Object.keys(payloadSchemas).sort())
  })

  test('every loyalty kind has a real handler: an unknown order is held order_unknown, never a placeholder', async () => {
    const orderId = randomUUID()
    const c = await customer()
    const res = await api.push(token, [
      customerLinked({ orderId, publicCode: c.code }),
      customerUnlinked({ orderId }),
      stampAdded({ orderId }),
      rewardUsed({ orderId, claimId: randomUUID() }),
    ])
    // The first is held order_unknown; the others wait behind it on the same order.
    expect(answers(res)).toEqual([
      ['held', 'order_unknown'],
      ['held', 'waits_for_earlier'],
      ['held', 'waits_for_earlier'],
      ['held', 'waits_for_earlier'],
    ])
  })
})

describe('linking and stamping counter sales', () => {
  test('offline batch in till order: shift, sale (₱245), link, stamp in one push all apply; 24 points, one stamp', async () => {
    const c = await customer()
    const open = shiftOpened({}, { staffId: bea })
    shiftId = open.payload.shiftId
    const s = sale()
    const link = customerLinked({ orderId: s.payload.orderId, publicCode: c.code }, { staffId: bea })
    const stamp = stampAdded({ orderId: s.payload.orderId }, { staffId: bea })
    const res = await api.push(token, [open, s, link, stamp])
    expect(answers(res)).toEqual([
      ['applied', null],
      ['applied', null],
      ['applied', null],
      ['applied', null],
    ])
    expect((await orderRow(s.payload.orderId)).customer_id).toBe(c.id)
    expect(await ledgerOf(s.payload.orderId)).toEqual([{ customer_id: c.id, delta: 24, reason: 'order' }])
    const stamps = await stampsOf(s.payload.orderId)
    expect(stamps).toHaveLength(1)
    expect(stamps[0]).toMatchObject({ id: stamp.payload.stampId, customer_id: c.id })
    expect(stamps[0]!.card_id).not.toBeNull()

    // "one stamp per order": a second stamp with a new id is answered already_stamped and writes nothing.
    const again = await api.push(token, [stampAdded({ orderId: s.payload.orderId })])
    expect(answers(again)).toEqual([['applied', 'already_stamped']])
    expect(await stampsOf(s.payload.orderId)).toHaveLength(1)

    // Linking the same customer again is a no-op; another customer is flagged.
    const other = await customer()
    const relink = await api.push(token, [
      customerLinked({ orderId: s.payload.orderId, publicCode: c.code }),
      customerLinked({ orderId: s.payload.orderId, publicCode: other.code }),
    ])
    expect(answers(relink)).toEqual([
      ['applied', 'already_linked'],
      ['flagged', 'linked_other'],
    ])
    expect((await orderRow(s.payload.orderId)).customer_id).toBe(c.id)
    expect(await ledgerOf(s.payload.orderId)).toHaveLength(1)
  })

  test('out of order: a link before its sale is held, then applies with the sale; the stamp waits, then applies', async () => {
    const c = await customer()
    const s = sale()
    const link = customerLinked({ orderId: s.payload.orderId, publicCode: c.code })
    const stamp = stampAdded({ orderId: s.payload.orderId })
    expect(answers(await api.push(token, [link]))).toEqual([['held', 'order_unknown']])

    const res = await api.push(token, [s, stamp])
    expect(answers(res)).toEqual([
      ['applied', null],
      ['held', 'waits_for_earlier'],
    ])
    expect(await receipt(link.id)).toEqual({ result: 'applied', reason: null })
    expect(await receipt(stamp.id)).toEqual({ result: 'applied', reason: null })
    expect((await orderRow(s.payload.orderId)).customer_id).toBe(c.id)
    expect(await stampsOf(s.payload.orderId)).toHaveLength(1)
    expect(await balanceOf(c.id)).toBe(24)
  })

  test('online orders cannot be linked from the till', async () => {
    const c = await customer()
    const { orderId } = await onlineOrder({ customerId: c.id, items: [latteId], pay: 'paid' })
    const res = await api.push(token, [customerLinked({ orderId, publicCode: (await customer()).code })])
    expect(answers(res)).toEqual([['flagged', 'online_order']])
    expect((await orderRow(orderId)).customer_id).toBe(c.id)
  })
})

describe('stamps need a drink', () => {
  test('none on food-only orders: an online paid food-only order linked at checkout is flagged no_drink', async () => {
    const c = await customer()
    const { orderId } = await onlineOrder({ customerId: c.id, items: [ensaymadaId], pay: 'paid' })
    const res = await api.push(token, [stampAdded({ orderId })])
    expect(answers(res)).toEqual([['flagged', 'no_drink']])
    expect(await stampsOf(orderId)).toHaveLength(0)
  })

  test('a mixed food and drink online order is stamped', async () => {
    const c = await customer()
    const { orderId } = await onlineOrder({ customerId: c.id, items: [ensaymadaId, latteId], pay: 'paid' })
    const res = await api.push(token, [stampAdded({ orderId })])
    expect(answers(res)).toEqual([['applied', null]])
    expect(await stampsOf(orderId)).toHaveLength(1)
  })

  test('a food-only counter sale earns points but no stamp', async () => {
    const c = await customer()
    const s = sale([ensaymada()])
    const res = await api.push(token, [s, customerLinked({ orderId: s.payload.orderId, publicCode: c.code }), stampAdded({ orderId: s.payload.orderId })])
    expect(answers(res)).toEqual([
      ['applied', null],
      ['applied', null],
      ['flagged', 'no_drink'],
    ])
    expect(await stampsOf(s.payload.orderId)).toHaveLength(0)
    expect(await balanceOf(c.id)).toBe(6)
  })

  test('an online order not yet paid is flagged not_paid', async () => {
    const c = await customer()
    const { orderId } = await onlineOrder({ customerId: c.id, items: [latteId], pay: 'pending_verification' })
    expect(answers(await api.push(token, [stampAdded({ orderId })]))).toEqual([['flagged', 'not_paid']])
    expect(await stampsOf(orderId)).toHaveLength(0)
  })
})

describe('paper customers (Ruling 13)', () => {
  test('a stamp for a customer on paper is stored with no card and flagged mode_was_paper, not listed as a receipt', async () => {
    const c = await customer('paper')
    const s = sale()
    const stamp = stampAdded({ orderId: s.payload.orderId })
    const res = await api.push(token, [s, customerLinked({ orderId: s.payload.orderId, publicCode: c.code }), stamp])
    expect(answers(res)).toEqual([
      ['applied', null],
      ['applied', null],
      ['flagged', 'mode_was_paper'],
    ])
    const stamps = await stampsOf(s.payload.orderId)
    expect(stamps).toHaveLength(1)
    expect(stamps[0]).toMatchObject({ card_id: null, flags: ['mode_was_paper'] })
    // Paper customers still earn points.
    expect(await balanceOf(c.id)).toBe(24)

    const r = await api.app.request('/v1/attention?show=open', { headers: { Authorization: `Bearer ${ownerLogin}` } })
    expect(r.status).toBe(200)
    const view = (await r.json()) as AttentionView
    expect(view.events.map((e) => e.id)).not.toContain(stamp.id)
    // It is listed under "Stamps to check" instead.
    expect(view.stamps.map((x) => x.id)).toContain(stamp.payload.stampId)
  })
})

describe('flagged, never refused', () => {
  test('an unknown code (valid check symbol) is flagged unknown_customer; then the stamp is flagged not_linked', async () => {
    let bare = makePublicCode(randomInt)
    const [taken] = await db.sql`select 1 from customers where public_code = ${bare}`
    if (taken) bare = makePublicCode(randomInt)
    const s = sale()
    const res = await api.push(token, [
      s,
      customerLinked({ orderId: s.payload.orderId, publicCode: formatPublicCode(bare) }),
      stampAdded({ orderId: s.payload.orderId }),
    ])
    expect(answers(res)).toEqual([
      ['applied', null],
      ['flagged', 'unknown_customer'],
      ['flagged', 'not_linked'],
    ])
    expect((await orderRow(s.payload.orderId)).customer_id).toBeNull()
  })

  test('a bad check symbol is held invalid: publicCode…, and the receipt is kept', async () => {
    const c = await customer()
    const last = c.bare[8]!
    const wrong = c.bare.slice(0, 8) + CODE_ALPHABET[(CODE_ALPHABET.indexOf(last) + 1) % CODE_ALPHABET.length]
    const s = sale()
    const link = customerLinked({ orderId: s.payload.orderId, publicCode: wrong })
    const res = await api.push(token, [s, link])
    expect(res.results[0]!.result).toBe('applied')
    expect(res.results[1]).toMatchObject({ result: 'held', reason: expect.stringMatching(/^invalid: publicCode: /) })
    expect(await receipt(link.id)).toMatchObject({ result: 'held', reason: expect.stringMatching(/^invalid: publicCode: /) })
    expect((await orderRow(s.payload.orderId)).customer_id).toBeNull()
  })
})

describe('unlink (Ruling 8)', () => {
  test('unlink removes the stamp, the ledger rows and the link; relinking to B gives B the stamp and points', async () => {
    const a = await customer()
    const b = await customer()
    const s = sale()
    const orderId = s.payload.orderId
    await api.push(token, [s, customerLinked({ orderId, publicCode: a.code }), stampAdded({ orderId })])
    expect(await balanceOf(a.id)).toBe(24)

    const res = await api.push(token, [customerUnlinked({ orderId })])
    expect(answers(res)).toEqual([['applied', null]])
    expect(await stampsOf(orderId)).toHaveLength(0)
    expect(await ledgerOf(orderId)).toHaveLength(0)
    expect((await orderRow(orderId)).customer_id).toBeNull()
    const [cards] = await db.sql`select count(*)::int as n from stamp_cards where customer_id = ${a.id}`
    expect(cards!.n).toBe(0)

    expect(answers(await api.push(token, [customerUnlinked({ orderId })]))).toEqual([['applied', 'not_linked']])

    const relink = await api.push(token, [customerLinked({ orderId, publicCode: b.code }), stampAdded({ orderId })])
    expect(answers(relink)).toEqual([
      ['applied', null],
      ['applied', null],
    ])
    expect((await stampsOf(orderId)).map((x) => x.customer_id)).toEqual([b.id])
    expect(await ledgerOf(orderId)).toEqual([{ customer_id: b.id, delta: 24, reason: 'order' }])
    expect(await balanceOf(a.id)).toBe(0)
  })
})

describe('void (order.cancelled)', () => {
  test('a linked, stamped sale voided: order_reversed, the stamp removed, cards repacked', async () => {
    const c = await customer()
    const first = sale()
    const second = sale()
    await api.push(token, [
      first,
      customerLinked({ orderId: first.payload.orderId, publicCode: c.code }),
      stampAdded({ orderId: first.payload.orderId }),
      second,
      customerLinked({ orderId: second.payload.orderId, publicCode: c.code }),
      stampAdded({ orderId: second.payload.orderId }),
    ])
    expect(await balanceOf(c.id)).toBe(48)

    const res = await api.push(token, [orderCancelled({ orderId: first.payload.orderId })])
    expect(answers(res)).toEqual([['applied', null]])
    expect(await ledgerOf(first.payload.orderId)).toEqual([
      { customer_id: c.id, delta: 24, reason: 'order' },
      { customer_id: c.id, delta: -24, reason: 'order_reversed' },
    ])
    expect(await stampsOf(first.payload.orderId)).toHaveLength(0)
    const cards = await db.sql<{ id: string; filled_at: Date | null; n: number }[]>`
      select c.id, c.filled_at, (select count(*)::int from stamps s where s.card_id = c.id) as n
      from stamp_cards c where c.customer_id = ${c.id}`
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ filled_at: null, n: 1 })
    expect(await balanceOf(c.id)).toBe(24)

    // A stamp or a link arriving after the void changes nothing.
    expect(answers(await api.push(token, [stampAdded({ orderId: first.payload.orderId })]))).toEqual([['applied', 'already_cancelled']])
  })
})

describe('free drink', () => {
  test('a claimed card is used by a reward line; the void unclaims it and the card is full again (Ruling 12)', async () => {
    const c = await customer()
    const events = []
    for (let i = 0; i < 8; i++) {
      const s = sale([latte()])
      events.push(s, customerLinked({ orderId: s.payload.orderId, publicCode: c.code }), stampAdded({ orderId: s.payload.orderId }))
    }
    const filled = await api.push(token, events)
    expect(filled.results.every((r) => r.result === 'applied')).toBe(true)

    const claimId = randomUUID()
    const claimed = await db.sql.begin((tx) => claimFreeDrink(tx, { customerId: c.id, claimId, staffId: bea, deviceId, now: NOW }))
    expect(claimed).toBe('claimed')

    const reward = latte({ basePriceCentavos: 0, modifiers: [{ id: oatId, name: 'Oat milk', priceCentavos: 3500 }], lineTotalCentavos: 3500, reward: true })
    const s = sale([latte(), reward])
    expect(s.payload.subtotalCentavos).toBe(21500)
    const orderId = s.payload.orderId
    const res = await api.push(token, [s, customerLinked({ orderId, publicCode: c.code }), rewardUsed({ claimId, orderId })])
    expect(answers(res)).toEqual([
      ['applied', null],
      ['applied', null],
      ['applied', null],
    ])
    const [card] = await db.sql<{ id: string; claimed_order_id: string | null }[]>`
      select id, claimed_order_id from stamp_cards where claim_id = ${claimId}`
    expect(card!.claimed_order_id).toBe(orderId)
    const lines = await db.sql<{ is_reward: boolean; line_total_centavos: number }[]>`
      select is_reward, line_total_centavos from order_lines where order_id = ${orderId} order by is_reward`
    expect(lines).toEqual([
      { is_reward: false, line_total_centavos: 18000 },
      { is_reward: true, line_total_centavos: 3500 },
    ])
    expect((await orderRow(orderId)).flags).not.toContain('reprice_mismatch')
    expect(await ledgerOf(orderId)).toEqual([{ customer_id: c.id, delta: 18, reason: 'order' }])

    // Used twice on another order: flagged claim_reused, the card stays with the first order.
    const other = sale([latte()])
    const reused = await api.push(token, [other, rewardUsed({ claimId, orderId: other.payload.orderId })])
    expect(answers(reused)).toEqual([
      ['applied', null],
      ['flagged', 'claim_reused'],
    ])

    const voided = await api.push(token, [orderCancelled({ orderId })])
    expect(answers(voided)).toEqual([['applied', null]])
    const [after] = await db.sql<{ claimed_at: Date | null; claim_id: string | null; filled_at: Date | null; n: number }[]>`
      select claimed_at, claim_id, filled_at, (select count(*)::int from stamps s where s.card_id = c.id) as n
      from stamp_cards c where c.id = ${card!.id}`
    expect(after).toMatchObject({ claimed_at: null, claim_id: null, n: 8 })
    expect(after!.filled_at).not.toBeNull()
    expect(await ledgerOf(orderId)).toEqual([
      { customer_id: c.id, delta: 18, reason: 'order' },
      { customer_id: c.id, delta: -18, reason: 'order_reversed' },
    ])
  })

  test('reward.used for an order already voided unclaims the card (applied already_cancelled)', async () => {
    const c = await customer()
    const events = []
    for (let i = 0; i < 8; i++) {
      const s = sale([latte()])
      events.push(s, customerLinked({ orderId: s.payload.orderId, publicCode: c.code }), stampAdded({ orderId: s.payload.orderId }))
    }
    await api.push(token, events)
    const claimId = randomUUID()
    await db.sql.begin((tx) => claimFreeDrink(tx, { customerId: c.id, claimId, staffId: bea, deviceId, now: NOW }))
    const reward = latte({ basePriceCentavos: 0, lineTotalCentavos: 0, reward: true })
    const s = sale([reward])
    const res = await api.push(token, [s, orderCancelled({ orderId: s.payload.orderId }), rewardUsed({ claimId, orderId: s.payload.orderId })])
    expect(answers(res)).toEqual([
      ['applied', null],
      ['applied', null],
      ['applied', 'already_cancelled'],
    ])
    const [card] = await db.sql`select claimed_at, claimed_order_id from stamp_cards where customer_id = ${c.id} and filled_at is not null`
    expect(card).toMatchObject({ claimed_at: null, claimed_order_id: null })
  })

  test('the free line earns no stamp: a sale whose only drink is free is no_drink; with a paid drink it is stamped (Ruling P7-5)', async () => {
    const c = await customer('digital')
    const free = () => latte({ basePriceCentavos: 0, lineTotalCentavos: 0, reward: true })
    const onlyFree = sale([free(), ensaymada()])
    const withPaid = sale([free(), latte()])
    const events = [onlyFree, withPaid].flatMap((s) => [
      s,
      customerLinked({ orderId: s.payload.orderId, publicCode: c.code }),
      stampAdded({ orderId: s.payload.orderId }),
    ])
    expect(answers(await api.push(token, events))).toEqual([
      ['applied', null],
      ['applied', null],
      ['flagged', 'no_drink'],
      ['applied', null],
      ['applied', null],
      ['applied', null],
    ])
    expect(await stampsOf(onlyFree.payload.orderId)).toHaveLength(0)
    expect(await stampsOf(withPaid.payload.orderId)).toHaveLength(1)
  })

  test('reward.used with an unknown claim is flagged unknown_claim', async () => {
    const s = sale([latte()])
    const res = await api.push(token, [s, rewardUsed({ claimId: randomUUID(), orderId: s.payload.orderId })])
    expect(answers(res)).toEqual([
      ['applied', null],
      ['flagged', 'unknown_claim'],
    ])
  })

  test('two reward lines, or a reward line of 2, are held invalid: lines: reward', async () => {
    const reward = latte({ basePriceCentavos: 0, lineTotalCentavos: 0, reward: true })
    const two = sale([latte(), reward, reward])
    const double = sale([latte({ basePriceCentavos: 0, lineTotalCentavos: 0, quantity: 2, reward: true })])
    const res = await api.push(token, [two, double])
    expect(answers(res)).toEqual([
      ['held', 'invalid: lines: reward'],
      ['held', 'invalid: lines: reward'],
    ])
  })
})

describe('online payments', () => {
  test('verified through decidePayment credits the points; refunded through cancelOrder reverses them', async () => {
    const c = await customer()
    const { orderId, paymentId } = await onlineOrder({ customerId: c.id, items: [latteId], pay: 'pending_verification' })
    expect(await ledgerOf(orderId)).toHaveLength(0)
    const staff = await seedStaff(db.sql, { fullName: 'Mia', role: 'manager' })
    expect((await decidePayment(deps, { paymentId, staffId: staff, decision: 'verify' })).ok).toBe(true)
    expect(await ledgerOf(orderId)).toEqual([{ customer_id: c.id, delta: 24, reason: 'order' }])

    expect((await cancelOrder(deps, { orderId, staffId: staff, reason: 'out of beans' })).ok).toBe(true)
    expect(await ledgerOf(orderId)).toEqual([
      { customer_id: c.id, delta: 24, reason: 'order' },
      { customer_id: c.id, delta: -24, reason: 'order_reversed' },
    ])
  })

  test('a stamped online order refunded through cancelOrder loses its stamp', async () => {
    const c = await customer()
    const { orderId } = await onlineOrder({ customerId: c.id, items: [latteId], pay: 'paid' })
    await api.push(token, [stampAdded({ orderId })])
    expect(await stampsOf(orderId)).toHaveLength(1)
    const staff = await seedStaff(db.sql, { fullName: 'Mo', role: 'owner' })
    expect((await cancelOrder(deps, { orderId, staffId: staff, reason: 'spilled' })).ok).toBe(true)
    expect(await stampsOf(orderId)).toHaveLength(0)
  })

  test('rejected while pending: no credit and no reversal', async () => {
    const c = await customer()
    const { orderId, paymentId } = await onlineOrder({ customerId: c.id, items: [latteId], pay: 'pending_verification' })
    const staff = await seedStaff(db.sql, { fullName: 'Rae', role: 'manager' })
    expect((await decidePayment(deps, { paymentId, staffId: staff, decision: 'reject', reason: 'wrong amount' })).ok).toBe(true)
    expect(await ledgerOf(orderId)).toHaveLength(0)
  })
})

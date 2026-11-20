import { randomInt, randomUUID } from 'node:crypto'
import { formatPublicCode, makePublicCode, type CustomerDetail, type CustomerListItem, type PaperStamp } from '@kennko/core'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { publishMenu } from '../src/menu/snapshot.js'
import { startTestDb, type TestDb } from './pg.js'
import { customerLinked, orderCreated, seedDevice, seedStaff, shiftOpened, stampAdded, syncApp } from './sync-helpers.js'

const NOW = new Date('2026-11-21T02:00:00Z')

let db: TestDb
let api: ReturnType<typeof syncApp>
let token: string
let deviceId: string
let bea: string
let shiftId: string
let latteId: string
let version: number
let ownerId: string
let managerId: string
let ownerLogin: string
let managerLogin: string
let baristaLogin: string
let ticket = 0

const loginOf = async (staffId: string) => {
  const [r] = await db.sql<{ user_id: string }[]>`select user_id from staff where id = ${staffId}`
  return r!.user_id
}

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
      values (${id}, ${new Date(NOW.getTime() - (n - first) * 60_000)}, ${count === 8 ? NOW : null}) returning id`
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

/** A sale, linked and stamped on the till: answered `flagged mode_was_paper` for a paper customer. */
async function stampOnTill(code: string) {
  const s = sale()
  const stamp = stampAdded({ orderId: s.payload.orderId }, { staffId: bea })
  const res = await api.push(token, [s, customerLinked({ orderId: s.payload.orderId, publicCode: code }, { staffId: bea }), stamp])
  return { orderId: s.payload.orderId, stampId: stamp.payload.stampId, receiptId: stamp.id, results: res.results }
}

async function call(method: string, path: string, t: string | null, body?: unknown) {
  const res = await api.app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, text, body: (text ? JSON.parse(text) : null) as Record<string, unknown> }
}
const search = async (q: string, t: string | null = managerLogin) => call('GET', `/v1/customers?q=${encodeURIComponent(q)}`, t)
const found = async (q: string) => {
  const r = await search(q)
  expect(r.status).toBe(200)
  return r.body as unknown as CustomerListItem[]
}
const detail = async (id: string, t = managerLogin) => {
  const r = await call('GET', `/v1/customers/${id}`, t)
  expect(r.status, r.text).toBe(200)
  return { view: r.body as unknown as CustomerDetail, raw: r.text }
}
const setMode = (id: string, mode: string, t: string | null = managerLogin) => call('POST', `/v1/customers/${id}/stamp-mode`, t, { mode })
const adjust = (id: string, body: unknown, t: string | null = ownerLogin) => call('POST', `/v1/customers/${id}/points`, t, body)
const toCheck = async () => {
  const r = await call('GET', '/v1/stamps/to-check', managerLogin)
  expect(r.status).toBe(200)
  return r.body as unknown as PaperStamp[]
}
const apply = (id: string, t: string | null = managerLogin) => call('POST', `/v1/stamps/${id}/apply`, t)
const discard = (id: string, t: string | null = managerLogin) => call('POST', `/v1/stamps/${id}/discard`, t)
const stampRow = async (id: string) => {
  const [s] = await db.sql<{ card_id: string | null; flags: string[]; resolved_at: Date | null; resolved_by: string | null }[]>`
    select card_id, flags, resolved_at, resolved_by from stamps where id = ${id}`
  return s!
}
const receipt = async (id: string) => {
  const [r] = await db.sql<{ result: string; reason: string; resolved_at: Date | null; resolved_by: string | null; resolve_note: string | null }[]>`
    select result, reason, resolved_at, resolved_by, resolve_note from sync_events where device_id = ${deviceId} and id = ${id}`
  return r!
}

beforeAll(async () => {
  db = await startTestDb()
  // A staff token here is the login's user id.
  api = syncApp(db.sql, NOW, { verifyUser: async (t) => ({ userId: t }) })
  ;({ token, deviceId } = await seedDevice(db.sql, 'Front till'))
  bea = await seedStaff(db.sql, { fullName: 'Bea' })
  ownerId = await seedStaff(db.sql, { fullName: 'Olive', role: 'owner' })
  managerId = await seedStaff(db.sql, { fullName: 'Mia', role: 'manager' })
  ownerLogin = await loginOf(ownerId)
  managerLogin = await loginOf(managerId)
  baristaLogin = await loginOf(bea)
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

describe('GET /v1/customers?q= (manager)', () => {
  test('by formatted code, by bare code and by name; one letter finds nothing', async () => {
    const ana = await customer({ name: 'Ana Reyes', stamps: 9 })
    await customer({ name: 'Mariana Cruz' })
    await customer({ name: 'Dana' })

    const byCode = await found(ana.code)
    expect(byCode).toEqual([
      {
        id: ana.id,
        publicCode: ana.code,
        displayName: 'Ana Reyes',
        stampMode: 'digital',
        stamps: 1,
        fullCards: 1,
        points: 0,
        joinedAt: NOW.toISOString(),
      },
    ])
    expect((await found(ana.bare.toLowerCase())).map((c) => c.id)).toEqual([ana.id])
    // A prefix of the name or of a later word; "Mariana" and "Dana" contain "ana" only mid-word.
    const names = (await found('ana')).map((c) => c.displayName)
    expect(names).toContain('Ana Reyes')
    expect(names).not.toContain('Mariana Cruz')
    expect(names).not.toContain('Dana')
    expect((await found('reY')).map((c) => c.id)).toEqual([ana.id])
    expect(await found('a')).toEqual([])
    expect(await found(' ')).toEqual([])
  })

  test('% and _ are matched literally', async () => {
    await customer({ name: 'Zed' })
    expect(await found('%%')).toEqual([])
    expect(await found('z%')).toEqual([])
    expect(await found('__')).toEqual([])
    const pct = await customer({ name: '50% Off' })
    expect((await found('50%')).map((c) => c.id)).toEqual([pct.id])
  })

  test('at most 20 results', async () => {
    for (let i = 0; i < 22; i++) await customer({ name: `Lotsa ${i}` })
    expect(await found('lotsa')).toHaveLength(20)
  })

  test('a barista is 403; no token is 401', async () => {
    expect((await search('ana', baristaLogin)).status).toBe(403)
    expect((await search('ana', null)).status).toBe(401)
  })
})

describe('GET /v1/customers/:id (manager)', () => {
  test('cards with stamps and tickets, ledger newest first with the staff name, and no email', async () => {
    const c = await customer({ name: 'Detail Dee', email: 'dee@private.test', stamps: 10 })
    const [claimOrder] = await db.sql`
      insert into orders (channel, fulfilment, prep_status, payment_status, business_day, ticket_series, ticket_number,
        customer_name, subtotal_centavos, total_centavos, device_id, customer_id)
      values ('counter', 'dine_in', 'completed', 'paid', '2026-11-21', 'C', 9001, 'Walk-in', 0, 0, ${deviceId}, ${c.id})
      returning id`
    await db.sql`update stamp_cards set claimed_at = ${NOW}, claim_id = ${randomUUID()}, claimed_order_id = ${claimOrder!.id}
      where customer_id = ${c.id} and filled_at is not null`
    const [credited] = await db.sql<{ ticket_number: number; id: string }[]>`
      select o.id, o.ticket_number from orders o where customer_id = ${c.id} and ticket_number <> 9001 limit 1`
    await db.sql`insert into points_ledger (customer_id, delta, reason, order_id, created_at)
      values (${c.id}, 14, 'order', ${credited!.id}, ${new Date(NOW.getTime() - 60_000)})`
    expect((await adjust(c.id, { delta: 5, note: 'Sorry for the wait' })).status).toBe(200)

    const { view, raw } = await detail(c.id)
    expect(view).toMatchObject({ id: c.id, publicCode: c.code, displayName: 'Detail Dee', stamps: 2, fullCards: 0, points: 19 })
    expect(view.stampModeSetBy).toBeNull()
    expect(view.cards).toHaveLength(2)
    const [open, claimed] = view.cards
    expect(open!.filledAt).toBeNull()
    expect(open!.stamps).toHaveLength(2)
    expect(claimed).toMatchObject({ claimedTicket: 'C9001' })
    expect(claimed!.claimedAt).toBe(NOW.toISOString())
    expect(claimed!.stamps).toHaveLength(8)
    expect(claimed!.stamps[0]!.ticket).toMatch(/^C\d+$/)
    expect(claimed!.stamps[0]!.flags).toEqual([])
    expect(view.ledger.map((r) => [r.delta, r.reason, r.byName, r.note])).toEqual([
      [5, 'adjustment', 'Olive', 'Sorry for the wait'],
      [14, 'order', null, null],
    ])
    expect(view.ledger[1]!.ticket).toBe(`C${credited!.ticket_number}`)
    expect(view.paperStamps).toEqual([])
    expect(raw).not.toContain('dee@private.test')
    expect(raw).not.toContain('private.test')
  })

  test('a non-uuid or unknown id is 404; a barista is 403', async () => {
    expect((await call('GET', '/v1/customers/not-a-uuid', managerLogin)).status).toBe(404)
    expect((await call('GET', `/v1/customers/${randomUUID()}`, managerLogin)).status).toBe(404)
    const c = await customer()
    expect((await call('GET', `/v1/customers/${c.id}`, baristaLogin)).status).toBe(403)
  })
})

describe('POST /v1/customers/:id/stamp-mode (manager, Ruling 14)', () => {
  test('none → paper → digital, recording the manager; the same mode again changes nothing', async () => {
    const c = await customer({ mode: 'none' })
    const r = await setMode(c.id, 'paper')
    expect(r.status, r.text).toBe(200)
    expect(r.body).toEqual({ stampMode: 'paper', changed: true })
    const [row] = await db.sql`select stamp_mode, stamp_mode_set_by, stamp_mode_set_at from customers where id = ${c.id}`
    expect(row).toMatchObject({ stamp_mode: 'paper', stamp_mode_set_by: managerId })
    expect(row!.stamp_mode_set_at.toISOString()).toBe(NOW.toISOString())

    const later = new Date(NOW.getTime() + 60_000)
    api.setNow(later)
    try {
      expect((await setMode(c.id, 'paper', ownerLogin)).body).toEqual({ stampMode: 'paper', changed: false })
      const [same] = await db.sql`select stamp_mode_set_by from customers where id = ${c.id}`
      expect(same!.stamp_mode_set_by).toBe(managerId)
      expect((await setMode(c.id, 'digital', ownerLogin)).body).toEqual({ stampMode: 'digital', changed: true })
    } finally {
      api.setNow(NOW)
    }
    const { view } = await detail(c.id)
    expect(view).toMatchObject({ stampMode: 'digital', stampModeSetBy: 'Olive', stampModeSetAt: later.toISOString() })
  })

  test('a full unclaimed card refuses paper with 409 FREE_DRINK_WAITING', async () => {
    const c = await customer({ stamps: 8 })
    const r = await setMode(c.id, 'paper')
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('FREE_DRINK_WAITING')
    const [row] = await db.sql`select stamp_mode from customers where id = ${c.id}`
    expect(row!.stamp_mode).toBe('digital')
  })

  test('paper → digital resumes the earlier digital stamps and adds no paper ones', async () => {
    const c = await customer({ stamps: 3 })
    expect((await setMode(c.id, 'paper')).status).toBe(200)
    const paper = await stampOnTill(c.code)
    expect(paper.results.map((r) => [r.result, r.reason])).toEqual([
      ['applied', null],
      ['applied', null],
      ['flagged', 'mode_was_paper'],
    ])
    expect((await setMode(c.id, 'digital')).status).toBe(200)
    const { view } = await detail(c.id)
    expect(view.stamps).toBe(3)
    expect((await stampRow(paper.stampId)).card_id).toBeNull()
    expect(view.paperStamps.map((s) => s.id)).toEqual([paper.stampId])
  })

  test('bad input is 400; an unknown customer 404; a barista 403', async () => {
    const c = await customer()
    expect((await setMode(c.id, 'none')).status).toBe(400)
    expect((await setMode(c.id, 'plastic')).status).toBe(400)
    expect((await setMode(randomUUID(), 'paper')).status).toBe(404)
    expect((await setMode('nope', 'paper')).status).toBe(404)
    expect((await setMode(c.id, 'paper', baristaLogin)).status).toBe(403)
  })
})

describe('POST /v1/customers/:id/points (owner)', () => {
  test('each adjustment is a new ledger row; the answer is the new balance', async () => {
    const c = await customer()
    const plus = await adjust(c.id, { delta: 50, note: 'Birthday' })
    expect(plus.status, plus.text).toBe(200)
    expect(plus.body).toEqual({ points: 50 })
    const minus = await adjust(c.id, { delta: -20, note: 'Typo fix' })
    expect(minus.body).toEqual({ points: 30 })
    const rows = await db.sql`select delta, reason, note, created_by_staff, created_at from points_ledger
      where customer_id = ${c.id} order by delta desc`
    expect(rows.map((r) => [r.delta, r.reason, r.note, r.created_by_staff])).toEqual([
      [50, 'adjustment', 'Birthday', ownerId],
      [-20, 'adjustment', 'Typo fix', ownerId],
    ])
    expect(rows[0]!.created_at.toISOString()).toBe(NOW.toISOString())
  })

  test('a manager is 403; delta 0, out of range or fractional, or no note is 400; an unknown customer 404', async () => {
    const c = await customer()
    expect((await adjust(c.id, { delta: 5, note: 'x' }, managerLogin)).status).toBe(403)
    expect((await adjust(c.id, { delta: 5, note: 'x' }, null)).status).toBe(401)
    expect((await adjust(c.id, { delta: 0, note: 'x' })).status).toBe(400)
    expect((await adjust(c.id, { delta: 10_001, note: 'x' })).status).toBe(400)
    expect((await adjust(c.id, { delta: 1.5, note: 'x' })).status).toBe(400)
    expect((await adjust(c.id, { delta: 5 })).status).toBe(400)
    expect((await adjust(c.id, { delta: 5, note: '   ' })).status).toBe(400)
    expect((await adjust(c.id, { delta: 5, note: 'x'.repeat(201) })).status).toBe(400)
    expect((await adjust(randomUUID(), { delta: 5, note: 'x' })).status).toBe(404)
    const [n] = await db.sql`select count(*)::int as n from points_ledger where customer_id = ${c.id}`
    expect(n!.n).toBe(0)
  })
})

describe('stamps to check (Ruling 13)', () => {
  test('listed; apply refused while paper; applied once digital, its receipt resolved; a second apply NOT_OPEN', async () => {
    const c = await customer({ name: 'Paper Pat', mode: 'paper' })
    const s = await stampOnTill(c.code)
    expect(s.results[2]).toMatchObject({ result: 'flagged', reason: 'mode_was_paper' })

    const listed = (await toCheck()).find((x) => x.id === s.stampId)
    expect(listed).toEqual({
      id: s.stampId,
      orderId: s.orderId,
      ticket: `C${ticket}`,
      customerId: c.id,
      customerCode: c.code,
      displayName: 'Paper Pat',
      customerMode: 'paper',
      stampedAt: expect.any(String),
      deviceName: 'Front till',
      staffName: 'Bea',
    })

    const still = await apply(s.stampId)
    expect(still.status).toBe(409)
    expect(still.body.code).toBe('STILL_PAPER')
    expect((await stampRow(s.stampId)).card_id).toBeNull()

    expect((await setMode(c.id, 'digital')).status).toBe(200)
    const ok = await apply(s.stampId)
    expect(ok.status, ok.text).toBe(200)
    const row = await stampRow(s.stampId)
    expect(row.card_id).not.toBeNull()
    expect(row.resolved_by).toBe(managerId)
    expect(row.resolved_at!.toISOString()).toBe(NOW.toISOString())
    const r = await receipt(s.receiptId)
    expect(r).toMatchObject({ result: 'flagged', reason: 'mode_was_paper', resolved_by: managerId, resolve_note: 'Stamp applied' })
    expect(r.resolved_at!.toISOString()).toBe(NOW.toISOString())
    expect((await detail(c.id)).view.stamps).toBe(1)
    expect((await toCheck()).map((x) => x.id)).not.toContain(s.stampId)

    const again = await apply(s.stampId)
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('NOT_OPEN')
  })

  test('discard flags it discarded, leaves it off any card and resolves its receipt', async () => {
    const c = await customer({ mode: 'paper' })
    const s = await stampOnTill(c.code)
    const r = await discard(s.stampId)
    expect(r.status, r.text).toBe(200)
    const row = await stampRow(s.stampId)
    expect(row.card_id).toBeNull()
    expect(row.flags).toEqual(['mode_was_paper', 'discarded'])
    expect(row.resolved_by).toBe(managerId)
    expect(await receipt(s.receiptId)).toMatchObject({ resolve_note: 'Stamp discarded', resolved_by: managerId })
    expect((await toCheck()).map((x) => x.id)).not.toContain(s.stampId)
    expect((await discard(s.stampId)).body.code).toBe('NOT_OPEN')
    expect((await apply(s.stampId)).body.code).toBe('NOT_OPEN')
  })

  test('applying for a customer back on `none` puts the stamp on a card and makes them digital', async () => {
    const c = await customer({ mode: 'paper' })
    const s = await stampOnTill(c.code)
    await db.sql`update customers set stamp_mode = 'none' where id = ${c.id}`
    expect((await apply(s.stampId)).status).toBe(200)
    expect((await stampRow(s.stampId)).card_id).not.toBeNull()
    const [row] = await db.sql`select stamp_mode from customers where id = ${c.id}`
    expect(row!.stamp_mode).toBe('digital')
  })

  test('applied in stamp order: an older paper stamp lands before newer digital ones', async () => {
    const c = await customer({ mode: 'paper' })
    const s = await stampOnTill(c.code)
    await setMode(c.id, 'digital')
    for (let i = 0; i < 8; i++) await stampOnTill(c.code)
    expect((await apply(s.stampId)).status).toBe(200)
    const { view } = await detail(c.id)
    expect(view).toMatchObject({ stamps: 1, fullCards: 1 })
    const full = view.cards.find((k) => k.filledAt !== null)!
    expect(full.stamps.map((x) => x.id)).toContain(s.stampId)
  })

  test('an unknown or non-uuid stamp is 404; a barista 403; no token 401', async () => {
    expect((await apply(randomUUID())).status).toBe(404)
    expect((await discard('nope')).status).toBe(404)
    expect((await apply(randomUUID(), baristaLogin)).status).toBe(403)
    expect((await call('GET', '/v1/stamps/to-check', baristaLogin)).status).toBe(403)
    expect((await call('GET', '/v1/stamps/to-check', null)).status).toBe(401)
  })
})

import { randomInt, randomUUID } from 'node:crypto'
import { formatPublicCode, makePublicCode } from '@kennko/core'
import type { AttentionEvent, AttentionView, CounterOrderPayload, FlaggedOrder, ImportOrder, OpenShift } from '@kennko/core'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { PushPayload, PushSender } from '../src/push/send.js'
import { startTestDb, type TestDb } from './pg.js'
import {
  customerLinked,
  orderCreated,
  prepStatus,
  publishTwoVersions,
  seedDevice,
  seedStaff,
  shiftClosed,
  shiftOpened,
  stampAdded,
  syncApp,
  type TwoVersions,
} from './sync-helpers.js'

const NOW = new Date('2026-11-21T02:00:00Z')

let db: TestDb
let api: ReturnType<typeof syncApp>
let menu: TwoVersions
let ownerId: string
let ownerLogin: string
let managerLogin: string
let baristaLogin: string
let ticket = 100
let sent: PushPayload[] = []

const sender: PushSender = async (_sub, payload) => {
  sent.push(payload)
  return 'sent'
}

const loginOf = async (staffId: string) => {
  const [r] = await db.sql<{ user_id: string }[]>`select user_id from staff where id = ${staffId}`
  return r!.user_id
}

beforeAll(async () => {
  db = await startTestDb()
  // A staff token here is the login's user id.
  api = syncApp(db.sql, NOW, { push: sender, verifyUser: async (token) => ({ userId: token }) })
  menu = await publishTwoVersions(db.sql)
  ownerId = await seedStaff(db.sql, { fullName: 'Olive', role: 'owner' })
  ownerLogin = await loginOf(ownerId)
  managerLogin = await loginOf(await seedStaff(db.sql, { fullName: 'Mia', role: 'manager' }))
  baristaLogin = await loginOf(await seedStaff(db.sql, { fullName: 'Bea', role: 'barista' }))
})
afterAll(async () => {
  await db.stop()
})
beforeEach(() => {
  sent = []
})

async function call(method: string, path: string, body?: unknown, token: string | null = ownerLogin) {
  const res = await api.app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Record<string, unknown> }
}
const view = async (show: 'open' | 'resolved' = 'open') => {
  const r = await call('GET', `/v1/attention?show=${show}`)
  expect(r.status).toBe(200)
  return r.body as unknown as AttentionView
}
const count = async () => {
  const r = await call('GET', '/v1/attention/count')
  expect(r.status).toBe(200)
  return r.body.count as number
}
const eventIn = (v: AttentionView, id: string): AttentionEvent | undefined => v.events.find((e) => e.id === id)
const orderIn = (v: AttentionView, id: string): FlaggedOrder | undefined => v.orders.find((o) => o.id === id)
const resolve = (deviceId: string, eventId: string, action: 'discard' | 'seen', note = 'Checked') =>
  call('POST', `/v1/attention/events/${deviceId}/${eventId}`, { action, note })
const receipt = async (deviceId: string, id: string) => {
  const [r] = await db.sql`select result, reason, resolved_at, resolved_by, resolve_note from sync_events
    where device_id = ${deviceId} and id = ${id}`
  return r!
}

/** A clean sale at v1 prices (latte M + oat, ₱140): applied with no flags. */
const sale = (shiftId: string, over: Partial<CounterOrderPayload> = {}) => {
  ticket += 1
  return orderCreated({
    shiftId,
    ticketNumber: ticket,
    menuVersion: menu.v1,
    lines: [
      {
        menuItemId: menu.latteId,
        name: 'Latte',
        size: 'M',
        basePriceCentavos: 12000,
        modifiers: [{ id: menu.oatId, name: 'Oat milk', priceCentavos: 2000 }],
        quantity: 1,
        iceLevel: 'regular',
        iceServe: 'mixed',
        note: '',
        lineTotalCentavos: 14000,
      },
    ],
    ...over,
  })
}

/** A till with a shift open on it. */
async function tillWithShift(name = 'Front till') {
  const till = await seedDevice(db.sql, name)
  const open = shiftOpened()
  expect((await api.push(till.token, [open])).results[0]!.result).toBe('applied')
  return { ...till, shiftId: open.payload.shiftId }
}

describe('seen', () => {
  test('an invalid sale is listed held, with its summary and till', async () => {
    const till = await tillWithShift()
    const before = await count()
    const bad = sale(till.shiftId, { totalCentavos: -1 })
    expect((await api.push(till.token, [bad])).results[0]!.result).toBe('held')

    const e = eventIn(await view(), bad.id)
    expect(e).toMatchObject({
      deviceId: till.deviceId,
      deviceName: 'Front till',
      deviceRevoked: false,
      kind: 'order.created',
      result: 'held',
      action: 'discard',
      resolvedAt: null,
    })
    expect(e!.reason).toMatch(/^invalid:/)
    expect(e!.summary.label).toMatch(/^Sale C\d+, 1 line$/)
    expect(e!.summary.amountCentavos).toBe(-1)
    expect(await count()).toBe(before + 1)
  })

  test('a legacy receipt from the import is listed as import.cash_move', async () => {
    const till = await seedDevice(db.sql)
    const move = { id: randomUUID(), shiftId: randomUUID(), kind: 'out', amountCentavos: 900, reason: 'Ice', at: '2026-11-02T01:00:00.000Z', staffId: null }
    const res = await api.app.request('/v1/sync/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${till.token}` },
      body: JSON.stringify({ shifts: [], orders: [], cashMoves: [move] }),
    })
    expect(res.status).toBe(200)
    const e = eventIn(await view(), move.id)
    expect(e).toMatchObject({ kind: 'import.cash_move', result: 'held', action: 'discard' })
    expect(e!.summary).toEqual({ label: 'Old cash out: Ice (before sync)', amountCentavos: 900 })
  })

  test('a receipt flagged already_recorded_differs is listed for a seen', async () => {
    const till = await tillWithShift()
    const first = sale(till.shiftId)
    await api.push(till.token, [first])
    const line = { ...first.payload.lines[0]!, quantity: 2, lineTotalCentavos: 28000 }
    const again = orderCreated({
      ...first.payload,
      lines: [line],
      subtotalCentavos: 28000,
      totalCentavos: 28000,
      payment: { ...first.payload.payment, id: randomUUID(), tenderedCentavos: 30000, changeCentavos: 2000 },
    })
    expect((await api.push(till.token, [again])).results[0]!.reason).toBe('already_recorded_differs')
    expect(eventIn(await view(), again.id)).toMatchObject({ result: 'flagged', action: 'seen', reason: 'already_recorded_differs' })

    const before = await count()
    expect((await resolve(till.deviceId, again.id, 'seen', 'Till resent it')).status).toBe(200)
    expect(eventIn(await view(), again.id)).toBeUndefined()
    expect(await count()).toBe(before - 1)
    const r = await receipt(till.deviceId, again.id)
    expect(r).toMatchObject({ result: 'flagged', resolved_by: ownerId, resolve_note: 'Till resent it' })
    expect(r.resolved_at).toEqual(NOW)
    const done = eventIn(await view('resolved'), again.id)
    expect(done).toMatchObject({ result: 'flagged', resolvedByName: 'Olive', resolveNote: 'Till resent it', action: null })
    expect(done!.resolvedAt).toBe(NOW.toISOString())
  })
})

describe('an old device', () => {
  test('a revoked till still shows, and a retry applies what the new till freed', async () => {
    const old = await seedDevice(db.sql, 'Old till')
    const shiftId = randomUUID()
    const waiting = sale(shiftId)
    expect((await api.push(old.token, [waiting])).results[0]!.reason).toBe('shift_unknown')

    await db.sql`update devices set revoked_at = ${NOW} where id = ${old.deviceId}`
    const fresh = await seedDevice(db.sql, 'New till')
    expect((await api.push(fresh.token, [shiftOpened({ shiftId })])).results[0]!.result).toBe('applied')

    expect(eventIn(await view(), waiting.id)).toMatchObject({ deviceName: 'Old till', deviceRevoked: true, result: 'held' })
    const before = await count()
    const r = await call('POST', `/v1/attention/devices/${old.deviceId}/retry`)
    expect(r).toEqual({ status: 200, body: { held: 0 } })
    expect((await receipt(old.deviceId, waiting.id)).result).toBe('applied')
    expect(eventIn(await view(), waiting.id)).toBeUndefined()
    expect(await count()).toBe(before - 1)
  })

  test('retrying a device that does not exist is 404', async () => {
    expect((await call('POST', `/v1/attention/devices/${randomUUID()}/retry`)).status).toBe(404)
    expect((await call('POST', '/v1/attention/devices/not-a-uuid/retry')).status).toBe(404)
  })
})

describe('discard frees the line', () => {
  let till: Awaited<ReturnType<typeof tillWithShift>>
  let typo: ReturnType<typeof prepStatus>
  let step: ReturnType<typeof prepStatus>

  test('setting aside an invalid step applies the one behind it, deleting nothing', async () => {
    till = await tillWithShift()
    const x = sale(till.shiftId)
    await api.push(till.token, [x])
    typo = prepStatus({ orderId: x.payload.orderId, to: 'brewing' as 'ready' })
    step = prepStatus({ orderId: x.payload.orderId, to: 'preparing' })
    const res = await api.push(till.token, [typo, step])
    expect(res.results.map((r) => r.result)).toEqual(['held', 'held'])
    expect(res.results[1]!.reason).toBe('waits_for_earlier')

    const [{ n: rowsBefore }] = await db.sql<{ n: number }[]>`select count(*)::int as n from sync_events`
    const before = await count()
    const r = await resolve(till.deviceId, typo.id, 'discard', 'Typo on the till')
    expect(r).toEqual({ status: 200, body: { ok: true } })

    expect(await receipt(till.deviceId, typo.id)).toMatchObject({
      result: 'discarded',
      resolved_by: ownerId,
      resolve_note: 'Typo on the till',
      resolved_at: NOW,
    })
    expect((await receipt(till.deviceId, step.id)).result).toBe('applied')
    const [order] = await db.sql`select prep_status from orders where id = ${x.payload.orderId}`
    expect(order!.prep_status).toBe('preparing')
    const [{ n: rowsAfter }] = await db.sql<{ n: number }[]>`select count(*)::int as n from sync_events`
    expect(rowsAfter).toBe(rowsBefore)
    expect(await count()).toBe(before - 2)

    const done = eventIn(await view('resolved'), typo.id)
    expect(done).toMatchObject({ result: 'discarded', resolvedByName: 'Olive', resolveNote: 'Typo on the till', action: null })
  })

  test('rules: discard only held, seen only flagged, once each, with a note', async () => {
    const flaggedTill = await tillWithShift()
    const first = sale(flaggedTill.shiftId)
    await api.push(flaggedTill.token, [first])
    const differs = orderCreated({
      ...first.payload,
      lines: [{ ...first.payload.lines[0]!, quantity: 2, lineTotalCentavos: 28000 }],
      subtotalCentavos: 28000,
      totalCentavos: 28000,
      payment: { ...first.payload.payment, id: randomUUID(), tenderedCentavos: 30000, changeCentavos: 2000 },
    })
    await api.push(flaggedTill.token, [differs])
    const bad = sale(flaggedTill.shiftId, { totalCentavos: -1 })
    await api.push(flaggedTill.token, [bad])

    expect(await resolve(flaggedTill.deviceId, differs.id, 'discard')).toMatchObject({ status: 409, body: { code: 'NOT_HELD' } })
    expect(await resolve(flaggedTill.deviceId, first.id, 'discard')).toMatchObject({ status: 409, body: { code: 'NOT_HELD' } })
    expect(await resolve(flaggedTill.deviceId, bad.id, 'seen')).toMatchObject({ status: 409, body: { code: 'NOT_FLAGGED' } })
    expect(await resolve(till.deviceId, typo.id, 'discard')).toMatchObject({ status: 409, body: { code: 'NOT_OPEN' } })
    expect(await resolve(till.deviceId, typo.id, 'seen')).toMatchObject({ status: 409, body: { code: 'NOT_OPEN' } })
    expect((await resolve(flaggedTill.deviceId, differs.id, 'seen')).status).toBe(200)
    expect(await resolve(flaggedTill.deviceId, differs.id, 'seen')).toMatchObject({ status: 409, body: { code: 'NOT_OPEN' } })
    expect(await resolve(flaggedTill.deviceId, differs.id, 'discard')).toMatchObject({ status: 409, body: { code: 'NOT_OPEN' } })

    const empty = await call('POST', `/v1/attention/events/${flaggedTill.deviceId}/${bad.id}`, { action: 'discard', note: '' })
    expect(empty.status).toBe(400)
    expect(empty.body.code).toBeTruthy()
    const long = await call('POST', `/v1/attention/events/${flaggedTill.deviceId}/${bad.id}`, { action: 'discard', note: 'x'.repeat(201) })
    expect(long.status).toBe(400)
    expect((await call('POST', `/v1/attention/events/${flaggedTill.deviceId}/${bad.id}`, { action: 'delete', note: 'x' })).status).toBe(400)
    expect((await resolve(flaggedTill.deviceId, randomUUID(), 'discard')).status).toBe(404)
    expect((await resolve(randomUUID(), bad.id, 'discard')).status).toBe(404)
    expect((await resolve('nope', bad.id, 'discard')).status).toBe(404)
    expect((await resolve(flaggedTill.deviceId, 'nope', 'discard')).status).toBe(404)
    expect((await receipt(flaggedTill.deviceId, bad.id)).result).toBe('held')
  })
})

describe('a stuck shift', () => {
  test('closing it from admin opens the held shift and its sale; the till close replaces it later', async () => {
    const till = await tillWithShift()
    const s1 = till.shiftId
    const open2 = shiftOpened()
    const s2Sale = sale(open2.payload.shiftId)
    const res = await api.push(till.token, [open2, s2Sale])
    expect(res.results.map((r) => [r.result, r.reason])).toEqual([
      ['held', 'another_shift_open'],
      ['held', 'waits_for_earlier'],
    ])

    const v = await view()
    expect(v.shifts[0]).toMatchObject<Partial<OpenShift>>({
      id: s1,
      deviceId: till.deviceId,
      deviceName: 'Front till',
      deviceRevoked: false,
      openingFloatCentavos: 100000,
      blocking: 1,
    })
    expect(v.shifts.slice(1).every((s) => s.blocking === 0)).toBe(true)
    const before = await count()

    const close = await call('POST', `/v1/attention/shifts/${s1}/close`, { countedCentavos: 0, note: 'pos.db replaced' })
    expect(close).toEqual({ status: 200, body: { ok: true } })
    const [row] = await db.sql`select closed_at, closed_in_admin, closed_by_staff, counted_centavos, expected_centavos, note
      from shifts where id = ${s1}`
    expect(row).toMatchObject({ closed_in_admin: true, closed_by_staff: ownerId, counted_centavos: 0, expected_centavos: null, note: 'pos.db replaced' })
    expect(row!.closed_at).toEqual(NOW)

    const [s2] = await db.sql`select closed_at from shifts where id = ${open2.payload.shiftId}`
    expect(s2).toMatchObject({ closed_at: null })
    expect((await receipt(till.deviceId, s2Sale.id)).result).toBe('applied')
    const after = await view()
    expect(after.shifts.find((s) => s.id === s1)).toBeUndefined()
    expect(after.shifts.find((s) => s.id === open2.payload.shiftId)).toMatchObject({ blocking: 0 })
    // The blocking shift and both held receipts are gone from the count.
    expect(await count()).toBe(before - 3)

    expect(await call('POST', `/v1/attention/shifts/${s1}/close`, { countedCentavos: 0, note: 'again' })).toMatchObject({
      status: 409,
      body: { code: 'ALREADY_CLOSED' },
    })

    const tillClose = shiftClosed({ shiftId: s1, countedCentavos: 150000, expectedCentavos: 149000, note: 'counted' })
    expect((await api.push(till.token, [tillClose])).results[0]).toMatchObject({ result: 'applied', reason: 'replaced_admin_close' })
    const [replaced] = await db.sql`select closed_at, closed_in_admin, counted_centavos, expected_centavos, note
      from shifts where id = ${s1}`
    expect(replaced).toMatchObject({ closed_in_admin: false, counted_centavos: 150000, expected_centavos: 149000, note: 'counted' })
    expect(replaced!.closed_at).toEqual(new Date(tillClose.occurredAt))

    // The till sending its close again changes nothing.
    const resent = shiftClosed({ shiftId: s1, countedCentavos: 1, expectedCentavos: 1 })
    expect((await api.push(till.token, [resent])).results[0]).toMatchObject({ result: 'applied', reason: 'already_closed' })
  })

  test('close: a missing shift is 404, a bad body is 400', async () => {
    expect((await call('POST', `/v1/attention/shifts/${randomUUID()}/close`, { countedCentavos: 0, note: 'x' })).status).toBe(404)
    expect((await call('POST', '/v1/attention/shifts/nope/close', { countedCentavos: 0, note: 'x' })).status).toBe(404)
    const till = await tillWithShift()
    for (const body of [
      { countedCentavos: -1, note: 'x' },
      { countedCentavos: 1.5, note: 'x' },
      { countedCentavos: 100_000_001, note: 'x' },
      { countedCentavos: 0, note: '' },
      { countedCentavos: 0 },
    ]) {
      expect((await call('POST', `/v1/attention/shifts/${till.shiftId}/close`, body)).status, JSON.stringify(body)).toBe(400)
    }
  })
})

describe('flagged orders', () => {
  test('a repriced sale is listed until seen; a legacy order never is', async () => {
    const till = await tillWithShift()
    const off = sale(till.shiftId, { menuVersion: menu.v2 })
    const res = await api.push(till.token, [off])
    expect(res.results[0]).toMatchObject({ result: 'flagged', flags: ['reprice_mismatch'] })

    const order: ImportOrder = {
      id: randomUUID(),
      shiftId: null,
      businessDay: '2026-11-01',
      ticketNumber: 7,
      fulfilment: 'dine_in',
      customerName: 'Walk-in',
      status: 'done',
      lines: [off.payload.lines[0]!],
      subtotalCentavos: 14000,
      discountCentavos: 0,
      discountLabel: null,
      totalCentavos: 14000,
      payment: { id: randomUUID(), method: 'cash', tenderedCentavos: 20000, changeCentavos: 6000, reference: null },
      createdAt: '2026-11-01T01:00:00.000Z',
      voidedAt: null,
      voidReason: null,
      cancelledByStaff: null,
    }
    const imp = await api.app.request('/v1/sync/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${till.token}` },
      body: JSON.stringify({ shifts: [], orders: [order], cashMoves: [] }),
    })
    expect(await imp.json()).toEqual({ inserted: 1, existing: 0, rejected: 0 })

    const v = await view()
    expect(orderIn(v, off.payload.orderId)).toEqual<FlaggedOrder>({
      id: off.payload.orderId,
      ticket: `C${off.payload.ticketNumber}`,
      channel: 'counter',
      businessDay: '2026-11-21',
      flags: ['reprice_mismatch'],
      totalCentavos: 14000,
      deviceName: 'Front till',
      seenAt: null,
    })
    // The order is the thing to look at; its receipt is not listed a second time.
    expect(eventIn(v, off.id)).toBeUndefined()
    expect(orderIn(v, order.id)).toBeUndefined()

    const before = await count()
    expect(await call('POST', `/v1/attention/orders/${off.payload.orderId}/seen`)).toEqual({ status: 200, body: { ok: true } })
    expect(orderIn(await view(), off.payload.orderId)).toBeUndefined()
    expect(await count()).toBe(before - 1)
    expect(orderIn(await view('resolved'), off.payload.orderId)).toMatchObject({ seenAt: NOW.toISOString() })
    const [row] = await db.sql`select flags_seen_at, flags_seen_by from orders where id = ${off.payload.orderId}`
    expect(row).toMatchObject({ flags_seen_at: NOW, flags_seen_by: ownerId })

    expect(await call('POST', `/v1/attention/orders/${off.payload.orderId}/seen`)).toMatchObject({ status: 409, body: { code: 'NOT_OPEN' } })
    expect(await call('POST', `/v1/attention/orders/${order.id}/seen`)).toMatchObject({ status: 409, body: { code: 'NOT_FLAGGED' } })
    expect((await call('POST', `/v1/attention/orders/${randomUUID()}/seen`)).status).toBe(404)
    expect((await call('POST', '/v1/attention/orders/nope/seen')).status).toBe(404)
  })

  test('the resolved view has no shifts', async () => {
    const v = await view('resolved')
    expect(v.shifts).toEqual([])
    expect(v.events.every((e) => e.result === 'discarded' || e.resolvedAt !== null)).toBe(true)
    expect((await call('GET', '/v1/attention?show=everything')).status).toBe(400)
  })
})

describe('the lock and post-commit pushes', () => {
  test('an online prep step freed by a discard sends exactly one customer push, after commit', async () => {
    const till = await seedDevice(db.sql)
    const [o] = await db.sql`
      insert into orders (channel, order_code, fulfilment, prep_status, payment_status, business_day,
        ticket_series, ticket_number, customer_name, customer_phone, customer_email, fulfil_at,
        subtotal_centavos, total_centavos)
      values ('online', 'KNK-ATTN1', 'pickup', 'placed', 'paid', '2026-11-21', 'W', 950, 'Ana', '09170000000',
        'a@x.test', ${NOW.toISOString()}, 10000, 10000)
      returning id`
    const orderId = o!.id as string
    await db.sql`insert into payments (order_id, method, amount_centavos, reference, status)
      values (${orderId}, 'gcash', 10000, 'GC-950', 'verified')`
    const [s] = await db.sql`insert into push_subscriptions (endpoint, p256dh, auth, kind)
      values ('https://push.test/attn', 'p', 'a', 'customer') returning id`
    await db.sql`insert into push_order_watch (order_id, subscription_id) values (${orderId}, ${s!.id})`

    const typo = prepStatus({ orderId, to: 'brewing' as 'ready' })
    const step = prepStatus({ orderId, to: 'preparing' })
    await api.push(till.token, [typo, step])
    expect(sent).toEqual([])

    expect((await resolve(till.deviceId, typo.id, 'discard', 'Typo')).status).toBe(200)
    expect(sent.map((p) => p.title)).toEqual(['W950 is being prepared'])
    const [row] = await db.sql`select prep_status from orders where id = ${orderId}`
    expect(row!.prep_status).toBe('preparing')
  })
})

describe('stamps to check (Plan 7, Ruling 13)', () => {
  test('a stamp for a paper customer is listed under stamps and counted, until it is applied or discarded', async () => {
    const till = await tillWithShift('Stamp till')
    const id = randomUUID()
    const bare = makePublicCode(randomInt)
    await db.sql`insert into auth.users (id, email) values (${id}, 'paper@x.test')`
    await db.sql`insert into customers (id, public_code, display_name, stamp_mode, age_confirmed_at, privacy_accepted_at,
        privacy_version, created_at)
      values (${id}, ${bare}, 'Paper Pia', 'paper', ${NOW}, ${NOW}, '2026-11', ${NOW})`
    const code = formatPublicCode(bare)
    const stampOne = async () => {
      const s = sale(till.shiftId)
      const stamp = stampAdded({ orderId: s.payload.orderId })
      const res = await api.push(till.token, [s, customerLinked({ orderId: s.payload.orderId, publicCode: code }), stamp])
      expect(res.results.map((r) => r.reason)).toEqual([null, null, 'mode_was_paper'])
      return { stampId: stamp.payload.stampId, receiptId: stamp.id, orderId: s.payload.orderId }
    }

    const before = await count()
    const first = await stampOne()
    expect(await count()).toBe(before + 1)
    const second = await stampOne()
    expect(await count()).toBe(before + 2)

    const open = await view()
    expect(open.stamps.map((s) => s.id)).toEqual(expect.arrayContaining([first.stampId, second.stampId]))
    expect(open.stamps.find((s) => s.id === first.stampId)).toMatchObject({
      orderId: first.orderId,
      customerId: id,
      customerCode: code,
      displayName: 'Paper Pia',
      customerMode: 'paper',
      deviceName: 'Stamp till',
    })
    // The receipt itself is not listed again among the events.
    expect(eventIn(open, first.receiptId)).toBeUndefined()

    // Discard the second; switch to digital and apply the first.
    expect((await call('POST', `/v1/stamps/${second.stampId}/discard`)).status).toBe(200)
    expect(await count()).toBe(before + 1)
    expect((await call('POST', `/v1/customers/${id}/stamp-mode`, { mode: 'digital' })).status).toBe(200)
    expect((await call('POST', `/v1/stamps/${first.stampId}/apply`)).status).toBe(200)
    expect(await count()).toBe(before)
    const after = await view()
    expect(after.stamps.map((s) => s.id)).not.toContain(first.stampId)
    expect(after.stamps.map((s) => s.id)).not.toContain(second.stampId)

    // Both receipts now sit among the resolved ones with their notes; resolved never lists stamps.
    const resolved = await view('resolved')
    expect(resolved.stamps).toEqual([])
    expect(eventIn(resolved, first.receiptId)).toMatchObject({ resolveNote: 'Stamp applied', resolvedByName: 'Olive' })
    expect(eventIn(resolved, second.receiptId)).toMatchObject({ resolveNote: 'Stamp discarded' })
  })
})

describe('roles', () => {
  const routes = (): [string, string, unknown?][] => [
    ['GET', '/v1/attention'],
    ['GET', '/v1/attention?show=resolved'],
    ['GET', '/v1/attention/count'],
    ['POST', `/v1/attention/events/${randomUUID()}/${randomUUID()}`, { action: 'discard', note: 'x' }],
    ['POST', `/v1/attention/devices/${randomUUID()}/retry`],
    ['POST', `/v1/attention/shifts/${randomUUID()}/close`, { countedCentavos: 0, note: 'x' }],
    ['POST', `/v1/attention/orders/${randomUUID()}/seen`],
  ]

  test('managers and baristas get 403, no token 401', async () => {
    for (const [method, path, body] of routes()) {
      expect((await call(method, path, body, managerLogin)).status, `${method} ${path} manager`).toBe(403)
      expect((await call(method, path, body, baristaLogin)).status, `${method} ${path} barista`).toBe(403)
      expect((await call(method, path, body, null)).status, `${method} ${path} none`).toBe(401)
    }
  })
})

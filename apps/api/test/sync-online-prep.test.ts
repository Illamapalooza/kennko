import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import type { AppDeps } from '../src/create-app.js'
import { patchOrder } from '../src/orders/actions.js'
import type { PushPayload, PushSender } from '../src/push/send.js'
import { fakeProofs, inlineDefer } from './fakes.js'
import { startTestDb, type TestDb } from './pg.js'
import {
  orderCancelled,
  orderCreated,
  prepStatus,
  seedDevice,
  seedStaff,
  shiftOpened,
  syncApp,
} from './sync-helpers.js'

const NOW = new Date('2026-11-21T02:00:00Z')

let db: TestDb
let api: ReturnType<typeof syncApp>
let deps: AppDeps
let token: string
let deviceId: string
let bea: string
let owner: string
let ticket = 4
let sent: { endpoint: string; payload: PushPayload }[] = []
let senderThrows = false
let zoneId: string

const sender: PushSender = async (sub, payload) => {
  if (senderThrows) throw new Error('push service down')
  sent.push({ endpoint: sub.endpoint, payload })
  return 'sent'
}

beforeAll(async () => {
  db = await startTestDb()
  api = syncApp(db.sql, NOW, { push: sender })
  deps = { sql: db.sql, verifyUser: async () => ({ userId: 'x' }), proofs: fakeProofs(), now: () => NOW, push: sender, defer: inlineDefer }
  ;({ token, deviceId } = await seedDevice(db.sql))
  bea = await seedStaff(db.sql, { fullName: 'Bea' })
  owner = await seedStaff(db.sql, { fullName: 'Olive', role: 'owner' })
  const [z] = await db.sql`insert into delivery_zones (barangay, fee_centavos, latitude, longitude)
    values ('Libertad', 0, 8.942, 125.529) returning id`
  zoneId = z!.id as string
})
afterAll(async () => {
  await db.stop()
})
beforeEach(() => {
  sent = []
  senderThrows = false
})

/** A paid online order (verified GCash payment) whose customer follows it on one push subscription. */
async function seedPaidOnline(
  fulfilment: 'pickup' | 'delivery',
  over: { pay?: string; prep?: string } = {},
): Promise<{ orderId: string; label: string }> {
  ticket += 1
  const delivery = fulfilment === 'delivery'
  const [o] = await db.sql`
    insert into orders (channel, order_code, fulfilment, prep_status, payment_status, business_day,
      ticket_series, ticket_number, customer_name, customer_phone, customer_email, fulfil_at,
      subtotal_centavos, total_centavos, delivery_address, delivery_barangay, delivery_zone_id)
    values ('online', ${'KNK-P' + ticket}, ${fulfilment}, ${over.prep ?? 'placed'}, ${over.pay ?? 'paid'}, '2026-11-21',
      'W', ${ticket}, 'Ana', '09170000000', 'a@x.test', ${NOW.toISOString()}, 10000, 10000,
      ${delivery ? '1 Gate St' : null}, ${delivery ? 'Libertad' : null}, ${delivery ? zoneId : null})
    returning id`
  const orderId = o!.id as string
  const payStatus = (over.pay ?? 'paid') === 'paid' ? 'verified' : 'pending_verification'
  await db.sql`insert into payments (order_id, method, amount_centavos, reference, status)
    values (${orderId}, 'gcash', 10000, ${'GC-' + ticket}, ${payStatus})`
  const [s] = await db.sql`insert into push_subscriptions (endpoint, p256dh, auth, kind)
    values (${'https://push.test/' + ticket}, 'p', 'a', 'customer') returning id`
  await db.sql`insert into push_order_watch (order_id, subscription_id) values (${orderId}, ${s!.id})`
  return { orderId, label: `W${ticket}` }
}

const order = async (id: string) =>
  (await db.sql<{ prep_status: string; payment_status: string }[]>`
    select prep_status, payment_status from orders where id = ${id}`)[0]!
const events = (id: string) =>
  db.sql<{ device_id: string | null; staff_id: string | null; from_value: string; to_value: string }[]>`
    select device_id, staff_id, from_value, to_value from order_events where order_id = ${id} order by received_at, to_value`
const step = (orderId: string, to: Parameters<typeof prepStatus>[0]['to']) => prepStatus({ orderId, to }, { staffId: bea })
const answers = (res: Awaited<ReturnType<typeof api.push>>) => res.results.map((r) => [r.result, r.reason])
const titles = () => sent.map((s) => s.payload.title)

describe('online prep from the till', () => {
  test('pickup: preparing, then ready and completed in one push, each notifies like admin', async () => {
    const { orderId, label } = await seedPaidOnline('pickup')
    const res = await api.push(token, [step(orderId, 'preparing')])
    expect(answers(res)).toEqual([['applied', null]])
    expect((await order(orderId)).prep_status).toBe('preparing')
    const ev = await events(orderId)
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ device_id: deviceId, staff_id: bea, from_value: 'placed', to_value: 'preparing' })
    expect(titles()).toEqual([`${label} is being prepared`])

    const res2 = await api.push(token, [step(orderId, 'ready'), step(orderId, 'completed')])
    expect(answers(res2)).toEqual([
      ['applied', null],
      ['applied', null],
    ])
    expect(titles()).toEqual([`${label} is being prepared`, `${label} is ready for pickup`, `${label} is complete — enjoy!`])
    expect((await order(orderId)).prep_status).toBe('completed')
  })

  test('delivery: preparing, out for delivery, completed; ready is a conflict', async () => {
    const { orderId, label } = await seedPaidOnline('delivery')
    const res = await api.push(token, [step(orderId, 'preparing')])
    expect(answers(res)).toEqual([['applied', null]])
    const wrong = await api.push(token, [step(orderId, 'ready')])
    expect(answers(wrong)).toEqual([['applied', 'prep_conflict']])
    expect((await order(orderId)).prep_status).toBe('preparing')
    expect(sent).toHaveLength(1)

    const rest = await api.push(token, [step(orderId, 'out_for_delivery'), step(orderId, 'completed')])
    expect(answers(rest)).toEqual([
      ['applied', null],
      ['applied', null],
    ])
    expect(titles()).toContain(`${label} is on its way`)
    expect(sent).toHaveLength(3)
    expect((await order(orderId)).prep_status).toBe('completed')
  })
})

describe('admin and till on the same order (Review Focus 2)', () => {
  test('admin first: the till step is already_there, the next one moves', async () => {
    const { orderId } = await seedPaidOnline('pickup')
    expect(await patchOrder(deps, { orderId, staffId: owner, prepStatus: 'preparing' })).toMatchObject({ ok: true })
    expect(sent).toHaveLength(1)
    const res = await api.push(token, [step(orderId, 'preparing')])
    expect(answers(res)).toEqual([['applied', 'already_there']])
    expect(await events(orderId)).toHaveLength(1)
    expect(sent).toHaveLength(1)
    const next = await api.push(token, [step(orderId, 'ready')])
    expect(answers(next)).toEqual([['applied', null]])
    expect(sent).toHaveLength(2)
  })

  test('till first: admin preparing is BAD_TRANSITION, admin ready is ok', async () => {
    const { orderId } = await seedPaidOnline('pickup')
    expect(answers(await api.push(token, [step(orderId, 'preparing')]))).toEqual([['applied', null]])
    expect(await patchOrder(deps, { orderId, staffId: owner, prepStatus: 'preparing' })).toMatchObject({
      ok: false,
      code: 'BAD_TRANSITION',
    })
    expect(await patchOrder(deps, { orderId, staffId: owner, prepStatus: 'ready' })).toMatchObject({ ok: true })
  })

  test('a stale till step after admin moved on is a prep_conflict and changes nothing', async () => {
    const { orderId } = await seedPaidOnline('pickup')
    expect(await patchOrder(deps, { orderId, staffId: owner, prepStatus: 'preparing' })).toMatchObject({ ok: true })
    expect(await patchOrder(deps, { orderId, staffId: owner, prepStatus: 'ready' })).toMatchObject({ ok: true })
    expect(sent).toHaveLength(2)
    const res = await api.push(token, [step(orderId, 'preparing'), step(orderId, 'placed')])
    expect(answers(res)).toEqual([
      ['applied', 'prep_conflict'],
      ['applied', 'prep_conflict'],
    ])
    expect((await order(orderId)).prep_status).toBe('ready')
    expect(sent).toHaveLength(2)
  })
})

describe('what never notifies (Review Focus 3)', () => {
  test('the same push sent twice answers duplicate and sends nothing more', async () => {
    const { orderId } = await seedPaidOnline('pickup')
    const ev = step(orderId, 'preparing')
    expect(answers(await api.push(token, [ev]))).toEqual([['applied', null]])
    expect(answers(await api.push(token, [ev]))).toEqual([['duplicate', null]])
    expect(sent).toHaveLength(1)
  })

  test('a sender that throws still answers 200 applied and the order moves', async () => {
    const { orderId } = await seedPaidOnline('pickup')
    senderThrows = true
    expect(answers(await api.push(token, [step(orderId, 'preparing')]))).toEqual([['applied', null]])
    expect((await order(orderId)).prep_status).toBe('preparing')
  })

  test('an invalid step holds the next one for the same order; nothing moves or notifies', async () => {
    const { orderId } = await seedPaidOnline('pickup')
    const bad = prepStatus({ orderId, to: 'bogus' as 'ready' })
    const res = await api.push(token, [bad, step(orderId, 'preparing')])
    expect(res.results[0]!.result).toBe('held')
    expect(res.results[0]!.reason).toMatch(/^invalid: /)
    expect(answers(res)[1]).toEqual(['held', 'waits_for_earlier'])
    expect((await order(orderId)).prep_status).toBe('placed')
    expect(sent).toHaveLength(0)
  })

  test('a step for an online order the server does not have yet is held order_unknown', async () => {
    const { token: t2 } = await seedDevice(db.sql, 'Second till')
    const res = await api.push(t2, [step('00000000-0000-4000-8000-00000000beef', 'preparing')])
    expect(answers(res)).toEqual([['held', 'order_unknown']])
    expect(sent).toHaveLength(0)
  })

  test('a held step that applies on a later retry notifies then', async () => {
    const { token: t3 } = await seedDevice(db.sql, 'Third till')
    const { orderId, label } = await seedPaidOnline('pickup')
    // The step reaches the server before the order does.
    const missing = '00000000-0000-4000-8000-00000000cafe'
    const early = step(missing, 'preparing')
    expect(answers(await api.push(t3, [early]))).toEqual([['held', 'order_unknown']])
    // The order now exists (as an online, paid order) under that id.
    await db.sql`insert into orders (id, channel, order_code, fulfilment, prep_status, payment_status, business_day,
      ticket_series, ticket_number, customer_name, customer_phone, customer_email, fulfil_at, subtotal_centavos, total_centavos)
      values (${missing}, 'online', 'KNK-CAFE', 'pickup', 'placed', 'paid', '2026-11-21', 'W', 999, 'Ana', '0917', 'a@x.test',
        ${NOW.toISOString()}, 10000, 10000)`
    const [s] = await db.sql`select subscription_id from push_order_watch where order_id = ${orderId}`
    await db.sql`insert into push_order_watch (order_id, subscription_id) values (${missing}, ${s!.subscription_id})`
    // Any applied event in a push triggers the retry pass.
    const other = step(orderId, 'preparing')
    const res = await api.push(t3, [other])
    expect(answers(res)).toEqual([['applied', null]])
    expect((await order(missing)).prep_status).toBe('preparing')
    expect(titles().sort()).toEqual([`${label} is being prepared`, 'W999 is being prepared'].sort())
  })
})

describe('notifications follow the commit', () => {
  /** Makes inserting an order_events row with to_value `to` raise `errcode`. */
  async function failOn(to: string, errcode: string) {
    await db.sql.unsafe(`
      create function test_fail() returns trigger language plpgsql as $$
      begin
        if new.to_value = '${to}' then raise exception 'test failure' using errcode = '${errcode}'; end if;
        return new;
      end $$;
      create trigger test_fail before insert on order_events for each row execute function test_fail();`)
  }
  const unfail = () => db.sql.unsafe('drop trigger test_fail on order_events; drop function test_fail();')

  test('a retryable error fails the whole push: nothing moves and nothing is sent', async () => {
    const { orderId } = await seedPaidOnline('pickup')
    await failOn('ready', '40001')
    try {
      const res = await api.post(token, { events: [step(orderId, 'preparing'), step(orderId, 'ready')] })
      expect(res.status).toBe(500)
    } finally {
      await unfail()
    }
    expect((await order(orderId)).prep_status).toBe('placed')
    expect(sent).toHaveLength(0)
  })

  test('a step whose savepoint rolls back sends nothing, and notifies when the retry applies it', async () => {
    const { orderId, label } = await seedPaidOnline('pickup')
    await failOn('ready', 'P0001')
    let res
    try {
      res = await api.push(token, [step(orderId, 'preparing'), step(orderId, 'ready')])
    } finally {
      await unfail()
    }
    expect(answers(res)[0]).toEqual(['applied', null])
    expect(res.results[1]!.result).toBe('held')
    expect(res.results[1]!.reason).toMatch(/^error: /)
    expect(titles()).toEqual([`${label} is being prepared`])
    // The next push retries the held step first.
    const { orderId: other } = await seedPaidOnline('pickup')
    await api.push(token, [step(other, 'preparing')])
    expect((await order(orderId)).prep_status).toBe('ready')
    expect(titles()).toContain(`${label} is ready for pickup`)
    expect(sent).toHaveLength(3)
  })
})

describe('the till never cancels an online order (Ruling 5)', () => {
  test('order.cancelled stays flagged online_order', async () => {
    const { orderId } = await seedPaidOnline('pickup')
    expect(answers(await api.push(token, [orderCancelled({ orderId })]))).toEqual([['flagged', 'online_order']])
    expect(await order(orderId)).toMatchObject({ prep_status: 'placed', payment_status: 'paid' })
  })

  test('to cancelled is flagged not_from_till', async () => {
    const { orderId } = await seedPaidOnline('pickup')
    expect(answers(await api.push(token, [step(orderId, 'cancelled')]))).toEqual([['flagged', 'not_from_till']])
    expect((await order(orderId)).prep_status).toBe('placed')
  })

  test('an unpaid order is flagged not_paid', async () => {
    const { orderId } = await seedPaidOnline('pickup', { pay: 'pending_verification' })
    expect(answers(await api.push(token, [step(orderId, 'preparing')]))).toEqual([['flagged', 'not_paid']])
    expect((await order(orderId)).prep_status).toBe('placed')
    expect(sent).toHaveLength(0)
  })

  test('an order admin cancelled answers already_cancelled', async () => {
    const { orderId } = await seedPaidOnline('pickup', { pay: 'refunded', prep: 'cancelled' })
    expect(answers(await api.push(token, [step(orderId, 'preparing')]))).toEqual([['applied', 'already_cancelled']])
    expect(sent).toHaveLength(0)
  })
})

test('counter prep (Plan 4) still moves, with no push', async () => {
  const open = shiftOpened({}, { staffId: bea })
  const sale = orderCreated({ shiftId: open.payload.shiftId, ticketNumber: 1 })
  const res = await api.push(token, [open, sale, step(sale.payload.orderId, 'preparing')])
  expect(answers(res)).toEqual([
    ['applied', null],
    ['flagged', 'unknown_version'],
    ['applied', null],
  ])
  expect((await order(sale.payload.orderId)).prep_status).toBe('preparing')
  expect(sent).toHaveLength(0)
})

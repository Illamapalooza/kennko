import { randomUUID } from 'node:crypto'
import { isOnlineQueueOrder, type OnlineQueueOrder, type PullState } from '@kennko/core'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { ONLINE_LINE_COLUMNS, ONLINE_OPTION_COLUMNS, ONLINE_ORDER_COLUMNS } from '../src/sync/online-orders.js'
import { startTestDb, type TestDb } from './pg.js'
import { publishTwoVersions, seedDevice, syncApp } from './sync-helpers.js'

const NOW = new Date('2026-11-21T02:00:00Z')
const hoursAgo = (h: number, from = NOW) => new Date(from.getTime() - h * 3_600_000).toISOString()

let db: TestDb
let api: ReturnType<typeof syncApp>
let token: string
let deviceId: string
let ticket = 0
let zoneId: string
let userId: string
const ids: Record<string, string> = {}

type Seed = {
  channel?: 'online' | 'counter'
  fulfilment?: 'pickup' | 'delivery' | 'dine_in'
  prep?: string
  pay?: string
  updatedAt?: string
  createdAt?: string
  code?: string
  phone?: string
  note?: string | null
}

async function seedOrder(s: Seed = {}): Promise<string> {
  ticket += 1
  const channel = s.channel ?? 'online'
  const fulfilment = s.fulfilment ?? 'pickup'
  const delivery = fulfilment === 'delivery'
  const updated = s.updatedAt ?? hoursAgo(1)
  const created = s.createdAt ?? updated
  const [o] = await db.sql`
    insert into orders (channel, order_code, fulfilment, prep_status, payment_status, business_day,
      ticket_series, ticket_number, customer_name, customer_phone, customer_email, fulfil_at,
      subtotal_centavos, total_centavos, delivery_address, delivery_barangay, delivery_zone_id,
      customer_note, created_at, updated_at, device_id)
    values (${channel}, ${channel === 'online' ? (s.code ?? 'KNK-T' + ticket) : null}, ${fulfilment},
      ${s.prep ?? 'placed'}, ${s.pay ?? 'paid'}, '2026-11-21',
      ${channel === 'online' ? 'W' : 'C'}, ${ticket}, 'Ana', ${channel === 'online' ? (s.phone ?? '09170000000') : null},
      ${channel === 'online' ? 'someone@x.test' : null}, ${channel === 'online' ? hoursAgo(0) : null},
      10000, 10000, ${delivery ? '1 Gate St' : null}, ${delivery ? 'Libertad' : null}, ${delivery ? zoneId : null},
      ${s.note ?? null}, ${created}, ${updated}, ${channel === 'counter' ? deviceId : null})
    returning id`
  return o!.id as string
}

beforeAll(async () => {
  db = await startTestDb()
  api = syncApp(db.sql, NOW)
  ;({ token, deviceId } = await seedDevice(db.sql))
  await publishTwoVersions(db.sql)
  const [z] = await db.sql`insert into delivery_zones (barangay, fee_centavos, latitude, longitude)
    values ('Libertad', 0, 8.942, 125.529) returning id`
  zoneId = z!.id as string
  userId = randomUUID()
  await db.sql`insert into auth.users (id, email) values (${userId}, 'ana.secret@x.test')`

  // A: paid delivery order with every private field filled in
  ids.A = await seedOrder({
    fulfilment: 'delivery',
    code: 'KNK-SECRET',
    phone: '09171112222',
    note: 'No straw',
    createdAt: hoursAgo(1),
    updatedAt: hoursAgo(1),
  })
  await db.sql`update orders set customer_email = 'ana.secret@x.test', staff_note = 'internal-note',
    customer_user_id = ${userId}, delivery_lat = 8.947, delivery_lng = 125.53 where id = ${ids.A}`
  await db.sql`insert into payments (order_id, method, amount_centavos, reference, proof_path, status)
    values (${ids.A}, 'gcash', 10000, 'GC-REF-998877', 'proofs/ana-receipt.jpg', 'verified')`
  const [line] = await db.sql`
    insert into order_lines (order_id, item_name, variant_code, variant_label, unit_price_centavos, quantity,
      line_total_centavos, ice_level, ice_serve, note)
    values (${ids.A}, 'Latte', 'M', 'Medium', 12000, 2, 24000, 'regular', 'mixed', '') returning id`
  await db.sql`insert into order_line_options (line_id, group_name, option_name, price_centavos) values (${line!.id}, 'Milk of Choice', 'Oat milk', 2000)`

  // B: paid pickup, older so it sorts after A
  ids.B = await seedOrder({ phone: '09170000001', createdAt: hoursAgo(3), updatedAt: hoursAgo(3) })
  // C, D: not paid
  ids.C = await seedOrder({ pay: 'pending_verification' })
  ids.D = await seedOrder({ pay: 'rejected', prep: 'cancelled' })
  // E, F: completed 2 h and 25 h ago
  ids.E = await seedOrder({ prep: 'completed', createdAt: hoursAgo(5), updatedAt: hoursAgo(2) })
  ids.F = await seedOrder({ prep: 'completed', createdAt: hoursAgo(30), updatedAt: hoursAgo(25) })
  // G: counter
  ids.G = await seedOrder({ channel: 'counter', fulfilment: 'dine_in', prep: 'preparing' })
  // H: a delivery handed over 1 h ago: still pulled, but without its address and phone
  ids.H = await seedOrder({ fulfilment: 'delivery', prep: 'completed', phone: '09173334444', createdAt: hoursAgo(4), updatedAt: hoursAgo(1) })
})
afterAll(async () => {
  await db.stop()
})

const pull = (t: string | null) =>
  api.app.request('/v1/sync/pull', { headers: t ? { Authorization: `Bearer ${t}` } : {} })
const getState = async (): Promise<{ state: PullState; raw: string }> => {
  const res = await pull(token)
  expect(res.status).toBe(200)
  const raw = await res.text()
  return { state: JSON.parse(raw) as PullState, raw }
}
const keysDeep = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out))
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      out.push(k)
      keysDeep(x, out)
    }
  return out
}

describe('online orders in the pull', () => {
  test('exactly the paid online orders, unfinished first', async () => {
    const { state } = await getState()
    expect(state.onlineOrders!.map((o) => o.id)).toEqual([ids.A, ids.B, ids.H, ids.E])
  })

  test('contract: every pulled order passes the core shape check the till applies', async () => {
    const { state } = await getState()
    expect(state.onlineOrders!.length).toBeGreaterThan(0)
    for (const o of state.onlineOrders!) expect(isOnlineQueueOrder(o), o.id).toBe(true)
  })

  test('allowlist: only the planned keys, and no private value anywhere', async () => {
    const { state, raw } = await getState()
    const orders = state.onlineOrders as OnlineQueueOrder[]
    for (const o of orders) {
      expect(Object.keys(o).sort()).toEqual([
        'businessDay',
        'createdAt',
        'customerName',
        'customerNote',
        'delivery',
        'fulfilAt',
        'fulfilment',
        'id',
        'lines',
        'prepStatus',
        'ticketNumber',
        'updatedAt',
      ])
      for (const l of o.lines) {
        expect(Object.keys(l).sort()).toEqual(['iceLevel', 'iceServe', 'name', 'note', 'options', 'quantity', 'size'])
      }
    }
    const a = orders.find((o) => o.id === ids.A)!
    expect(Object.keys(a.delivery!).sort()).toEqual(['address', 'barangay', 'phone'])
    expect(a.delivery).toEqual({ address: '1 Gate St', barangay: 'Libertad', phone: '09171112222' })
    expect(orders.find((o) => o.id === ids.B)!.delivery).toBeNull()
    // Completed: the till only needs the address and phone until hand-off.
    expect(orders.find((o) => o.id === ids.H)!.delivery).toBeNull()

    for (const secret of [
      'ana.secret@x.test',
      'GC-REF-998877',
      'proofs/ana-receipt.jpg',
      'KNK-SECRET',
      'internal-note',
      '09170000001',
      '09173334444',
      userId,
      '8.947',
    ]) {
      expect(raw, secret).not.toContain(secret)
    }
    const bad = keysDeep(state.onlineOrders).filter((k) => /centavos|price|total|email|reference|proof|code$|user/i.test(k))
    expect(bad).toEqual([])
  })

  test('the column lists are pinned: adding a column means changing this test', () => {
    expect([...ONLINE_ORDER_COLUMNS]).toEqual([
      'id',
      'business_day',
      'ticket_number',
      'customer_name',
      'fulfilment',
      'fulfil_at',
      'customer_note',
      'prep_status',
      'created_at',
      'updated_at',
      'customer_phone',
      'delivery_address',
      'delivery_barangay',
    ])
    expect([...ONLINE_LINE_COLUMNS]).toEqual([
      'id',
      'order_id',
      'item_name',
      'variant_code',
      'variant_label',
      'quantity',
      'ice_level',
      'ice_serve',
      'note',
    ])
    expect([...ONLINE_OPTION_COLUMNS]).toEqual(['line_id', 'option_name'])
  })

  test("A's line and note come through", async () => {
    const { state } = await getState()
    const a = state.onlineOrders!.find((o) => o.id === ids.A)!
    expect(a.lines).toHaveLength(1)
    expect(a.lines[0]).toEqual({
      name: 'Latte',
      size: 'M',
      quantity: 2,
      options: ['Oat milk'],
      iceLevel: 'regular',
      iceServe: 'mixed',
      note: '',
    })
    expect(a.customerNote).toBe('No straw')
    expect(a.businessDay).toBe('2026-11-21')
    expect(a.prepStatus).toBe('placed')
    expect(a.createdAt).toBe(hoursAgo(1))
    expect(state.onlineOrders!.find((o) => o.id === ids.B)!.customerNote).toBeNull()
  })

  test('the 24 h window follows deps.now()', async () => {
    await db.sql`update orders set updated_at = ${hoursAgo(23.9833)} where id = ${ids.E}`
    expect((await getState()).state.onlineOrders!.map((o) => o.id)).toContain(ids.E)
    api.setNow(new Date(NOW.getTime() + 2 * 3_600_000))
    expect((await getState()).state.onlineOrders!.map((o) => o.id)).not.toContain(ids.E)
    api.setNow(NOW)
    await db.sql`update orders set updated_at = ${hoursAgo(2)} where id = ${ids.E}`
  })

  test('201 unfinished paid orders: 200 returned, none of them completed', async () => {
    for (let i = 0; i < 201; i++) await seedOrder({ createdAt: hoursAgo(0.5), updatedAt: hoursAgo(0.5) })
    const list = (await getState()).state.onlineOrders!
    expect(list).toHaveLength(200)
    expect(list.some((o) => o.prepStatus === 'completed')).toBe(false)
  })

  test('a revoked device is refused', async () => {
    const { token: t, deviceId: old } = await seedDevice(db.sql, 'Old till')
    await db.sql`update devices set revoked_at = now() where id = ${old}`
    expect((await pull(t)).status).toBe(401)
  })
})

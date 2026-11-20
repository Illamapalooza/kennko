import { afterAll, beforeAll, expect, test } from 'vitest'
import { startTestDb, type TestDb } from './pg.js'

const OWNER_USER = '11111111-1111-4111-8111-111111111111'
const OWNER = '22222222-2222-4222-8222-222222222222'
const DEVICE = '33333333-3333-4333-8333-333333333333'
const DEVICE_2 = '44444444-4444-4444-8444-444444444444'
const SHIFT = '55555555-5555-4555-8555-555555555555'
const CATEGORY = '66666666-6666-4666-8666-666666666666'
const ITEM = '77777777-7777-4777-8777-777777777777'

let db: TestDb
beforeAll(async () => {
  db = await startTestDb()
  await db.sql`insert into auth.users (id, email, email_confirmed_at) values (${OWNER_USER}, 'owner@kennko.test', now())`
  await db.sql`insert into staff (id, user_id, email, full_name, role)
    values (${OWNER}, ${OWNER_USER}, 'owner@kennko.test', 'Olive', 'owner')`
  await db.sql`insert into devices (id, name) values (${DEVICE}, 'Front till'), (${DEVICE_2}, 'Back till')`
  await db.sql`insert into shifts (id, device_id, opened_at, opened_by_staff, opening_float_centavos)
    values (${SHIFT}, ${DEVICE}, '2026-11-20T00:00:00Z', ${OWNER}, 100000)`
  await db.sql`insert into menu_categories (id, name) values (${CATEGORY}, 'Coffee')`
  await db.sql`insert into menu_items (id, category_id, name) values (${ITEM}, ${CATEGORY}, 'Americano')`
})
afterAll(async () => {
  await db.stop()
})

const insertOrder = (fields: Record<string, unknown>) => {
  const row = {
    channel: 'counter',
    fulfilment: 'dine_in',
    business_day: '2026-11-20',
    ticket_series: 'C',
    ticket_number: 1,
    customer_name: 'Walk-in',
    prep_status: 'placed',
    payment_status: 'paid',
    subtotal_centavos: 10000,
    discount_centavos: 0,
    delivery_fee_centavos: 0,
    total_centavos: 10000,
    device_id: DEVICE,
    ...fields,
  }
  return db.sql`insert into orders ${db.sql(row)} returning id`
}

const onlineOrder = {
  channel: 'online',
  fulfilment: 'pickup',
  ticket_series: 'W',
  ticket_number: 501,
  order_code: 'KEN-501',
  customer_phone: '09170000000',
  customer_email: 'c@kennko.test',
  fulfil_at: '2026-11-20T03:00:00Z',
  device_id: null,
}

// orders

test('a counter dine-in order with a device, shift and staff inserts', async () => {
  const [row] = await insertOrder({ ticket_number: 10, shift_id: SHIFT, opened_by_staff: OWNER })
  expect(row!.id).toBeTruthy()
})

test('a counter order without a device fails orders_counter_device', async () => {
  await expect(insertOrder({ ticket_number: 11, device_id: null })).rejects.toThrow(/orders_counter_device/)
})

test('an online order with a device fails orders_counter_device', async () => {
  await expect(insertOrder({ ...onlineOrder, device_id: DEVICE })).rejects.toThrow(/orders_counter_device/)
})

test('an online order with a shift fails orders_counter_only', async () => {
  await expect(insertOrder({ ...onlineOrder, shift_id: SHIFT })).rejects.toThrow(/orders_counter_only/)
})

test('an online order with opened_by_staff fails orders_counter_only', async () => {
  await expect(insertOrder({ ...onlineOrder, ticket_number: 502, order_code: 'KEN-502', opened_by_staff: OWNER }))
    .rejects.toThrow(/orders_counter_only/)
})

test('an online order without device, shift or staff still inserts', async () => {
  const [row] = await insertOrder({ ...onlineOrder, ticket_number: 503, order_code: 'KEN-503' })
  expect(row!.id).toBeTruthy()
})

test('two counter orders with the same device, day and C number both insert', async () => {
  await insertOrder({ ticket_number: 20 })
  await insertOrder({ ticket_number: 20 })
  const rows = await db.sql`select id from orders where device_id = ${DEVICE} and ticket_number = 20`
  expect(rows).toHaveLength(2)
})

test('the counter ticket and flagged indexes exist; the ticket index is not unique', async () => {
  const rows = await db.sql`
    select c.relname as name, i.indisunique as uniq
    from pg_index i join pg_class c on c.oid = i.indexrelid
    where c.relname in ('orders_counter_ticket_idx', 'orders_flagged_idx', 'cash_moves_shift_idx', 'sync_events_held')
    order by c.relname`
  expect(rows.map((r) => [r.name, r.uniq])).toEqual([
    ['cash_moves_shift_idx', false],
    ['orders_counter_ticket_idx', false],
    ['orders_flagged_idx', false],
    ['sync_events_held', false],
  ])
})

test('payments take a device_id', async () => {
  const [order] = await insertOrder({ ticket_number: 30 })
  const [pay] = await db.sql`insert into payments (order_id, method, amount_centavos, tendered_centavos, change_centavos,
      status, device_id)
    values (${order!.id}, 'cash', 10000, 10000, 0, 'recorded', ${DEVICE}) returning device_id`
  expect(pay!.device_id).toBe(DEVICE)
})

// shifts

test('a second open shift on a device fails shifts_one_open; after closing the first it succeeds', async () => {
  const second = '55555555-5555-4555-8555-000000000002'
  const insertSecond = () => db.sql`insert into shifts (id, device_id, opened_at, opening_float_centavos)
    values (${second}, ${DEVICE}, '2026-11-20T09:00:00Z', 50000)`
  await expect(insertSecond()).rejects.toThrow(/shifts_one_open/)
  await db.sql`update shifts set closed_at = '2026-11-20T08:00:00Z', counted_centavos = 120000,
    expected_centavos = 120000, closed_by_staff = ${OWNER} where id = ${SHIFT}`
  await insertSecond()
  const [row] = await db.sql`select note, is_legacy from shifts where id = ${second}`
  expect(row).toEqual({ note: '', is_legacy: false })
})

test('closed_at without counted_centavos fails shifts_closed_has_count', async () => {
  await expect(db.sql`insert into shifts (id, device_id, opened_at, opening_float_centavos, closed_at)
    values ('55555555-5555-4555-8555-000000000003', ${DEVICE_2}, now(), 0, now())`).rejects.toThrow(
    /shifts_closed_has_count/,
  )
})

test('a negative float or a note over 200 characters fails', async () => {
  await expect(db.sql`insert into shifts (id, device_id, opened_at, opening_float_centavos)
    values ('55555555-5555-4555-8555-000000000004', ${DEVICE_2}, now(), -1)`).rejects.toThrow(/check/)
  await expect(db.sql`insert into shifts (id, device_id, opened_at, opening_float_centavos, note)
    values ('55555555-5555-4555-8555-000000000005', ${DEVICE_2}, now(), 0, ${'x'.repeat(201)})`).rejects.toThrow(/check/)
})

test('a shift needs a till-generated id', async () => {
  await expect(db.sql`insert into shifts (device_id, opened_at, opening_float_centavos)
    values (${DEVICE_2}, now(), 0)`).rejects.toThrow(/null value in column "id"/)
})

// cash moves

const insertMove = (fields: Record<string, unknown>) =>
  db.sql`insert into cash_moves ${db.sql({
    id: crypto.randomUUID(),
    shift_id: SHIFT,
    kind: 'out',
    amount_centavos: 5000,
    reason: 'Ice',
    at: '2026-11-20T02:00:00Z',
    staff_id: OWNER,
    ...fields,
  })} returning id`

test('a cash move inserts', async () => {
  const [row] = await insertMove({})
  expect(row!.id).toBeTruthy()
})

test('a cash move of zero, an empty reason or an unknown kind fails', async () => {
  await expect(insertMove({ amount_centavos: 0 })).rejects.toThrow(/check/)
  await expect(insertMove({ reason: '' })).rejects.toThrow(/check/)
  await expect(insertMove({ reason: 'x'.repeat(81) })).rejects.toThrow(/check/)
  await expect(insertMove({ kind: 'float' })).rejects.toThrow(/check/)
})

// sync_events

const insertEvent = (fields: Record<string, unknown>) =>
  db.sql`insert into sync_events ${db.sql({
    device_id: DEVICE,
    id: '88888888-8888-4888-8888-888888888888',
    seq: 1,
    kind: 'shift.opened',
    payload: db.sql.json({ shiftId: SHIFT }),
    staff_id: OWNER,
    entity_keys: [`shift:${SHIFT}`],
    occurred_at: '2026-11-20T00:00:00Z',
    received_at: '2026-11-20T00:00:05Z',
    result: 'applied',
    ...fields,
  })}`

test('sync_events: the same (device_id, id) twice fails; the same id on another device succeeds', async () => {
  await insertEvent({})
  await expect(insertEvent({ seq: 2 })).rejects.toThrow(/sync_events_pkey/)
  await insertEvent({ device_id: DEVICE_2 })
  const rows = await db.sql`select device_id from sync_events where id = '88888888-8888-4888-8888-888888888888'`
  expect(rows).toHaveLength(2)
})

test('sync_events: every SyncEventKind is accepted; order.deleted and an unknown result fail', async () => {
  const kinds = [
    'order.created',
    'order.prep_status',
    'order.cancelled',
    'shift.opened',
    'shift.closed',
    'cash.moved',
    'menu.availability',
  ]
  for (const [i, kind] of kinds.entries()) {
    await insertEvent({ id: crypto.randomUUID(), seq: 100 + i, kind, result: 'held', reason: 'missing shift' })
  }
  await expect(insertEvent({ id: crypto.randomUUID(), kind: 'order.deleted' })).rejects.toThrow(/check/)
  await expect(insertEvent({ id: crypto.randomUUID(), result: 'dropped' })).rejects.toThrow(/check/)
})

// privileges

test('anon and authenticated hold nothing on shifts, cash_moves and sync_events', async () => {
  const privs = await db.sql`
    select r.role, t.tbl, p.priv
    from (values ('anon'), ('authenticated')) r(role),
         (values ('shifts'), ('cash_moves'), ('sync_events')) t(tbl),
         (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('REFERENCES'), ('TRIGGER'), ('TRUNCATE')) p(priv)
    where has_table_privilege(r.role, t.tbl, p.priv)`
  expect(privs).toEqual([])
})

test('kennko_api can select, insert and update but not delete the three tables', async () => {
  const rows = await db.sql`
    select t.tbl, p.priv, has_table_privilege('kennko_api', t.tbl, p.priv) as has
    from (values ('shifts'), ('cash_moves'), ('sync_events')) t(tbl),
         (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(priv)`
  for (const r of rows) expect([r.tbl, r.priv, r.has]).toEqual([r.tbl, r.priv, r.priv !== 'DELETE'])
  const policies = await db.sql`
    select tablename, cmd from pg_policies
    where tablename in ('shifts', 'cash_moves', 'sync_events') and 'kennko_api' = any(roles)
    order by tablename, cmd`
  expect(policies.map((p) => `${p.tablename}:${p.cmd}`)).toEqual([
    'cash_moves:INSERT',
    'cash_moves:SELECT',
    'cash_moves:UPDATE',
    'shifts:INSERT',
    'shifts:SELECT',
    'shifts:UPDATE',
    'sync_events:INSERT',
    'sync_events:SELECT',
    'sync_events:UPDATE',
  ])
  const rls = await db.sql`
    select relname from pg_class where relname in ('shifts', 'cash_moves', 'sync_events') and relrowsecurity
    order by relname`
  expect(rls.map((r) => r.relname)).toEqual(['cash_moves', 'shifts', 'sync_events'])
})

test('kennko_api may update menu_items.is_available only, and the stamp trigger records the change', async () => {
  const [cols] = await db.sql`select
    has_column_privilege('kennko_api', 'menu_items', 'is_available', 'UPDATE') as avail,
    has_column_privilege('kennko_api', 'menu_items', 'name', 'UPDATE') as name`
  expect(cols).toEqual({ avail: true, name: false })

  await db.sql.begin(async (tx) => {
    await tx.unsafe('set local role kennko_api')
    const updated = await tx`update menu_items set is_available = false where id = ${ITEM} returning id`
    expect(updated).toHaveLength(1)
  })
  const [item] = await db.sql`select is_available, availability_changed_at from menu_items where id = ${ITEM}`
  expect(item!.is_available).toBe(false)
  expect(item!.availability_changed_at).not.toBeNull()

  await expect(
    db.sql.begin(async (tx) => {
      await tx.unsafe('set local role kennko_api')
      await tx`update menu_items set name = 'Long Black' where id = ${ITEM}`
    }),
  ).rejects.toMatchObject({ code: '42501' })
})

import { afterAll, beforeAll, expect, test } from 'vitest'
import { startTestDb, type TestDb } from './pg.js'

// Rows that exist on the live database before 0018 runs: applied, flagged and held receipts, open and
// closed shifts, and orders with and without flags. Every new check must hold for them.
const OWNER_USER = '11111111-1111-4111-8111-111111111111'
const OWNER = '22222222-2222-4222-8222-222222222222'
const DEVICE = '33333333-3333-4333-8333-333333333333'
const SHIFT_OPEN = '55555555-5555-4555-8555-555555555551'
const SHIFT_CLOSED = '55555555-5555-4555-8555-555555555552'
const DEVICE_2 = '44444444-4444-4444-8444-444444444444'
const ORDER_OLD = '99999999-9999-4999-8999-999999999991'
const EV_APPLIED = '88888888-8888-4888-8888-888888888881'
const EV_FLAGGED = '88888888-8888-4888-8888-888888888882'
const EV_HELD = '88888888-8888-4888-8888-888888888883'
const EV_HELD_2 = '88888888-8888-4888-8888-888888888884'

const SEED = `
  insert into auth.users (id, email, email_confirmed_at) values ('${OWNER_USER}', 'owner@kennko.test', now());
  insert into staff (id, user_id, email, full_name, role)
    values ('${OWNER}', '${OWNER_USER}', 'owner@kennko.test', 'Olive', 'owner');
  insert into devices (id, name) values ('${DEVICE}', 'Front till'), ('${DEVICE_2}', 'Back till');
  insert into shifts (id, device_id, opened_at, opened_by_staff, opening_float_centavos)
    values ('${SHIFT_OPEN}', '${DEVICE}', '2026-11-20T00:00:00Z', '${OWNER}', 100000);
  insert into shifts (id, device_id, opened_at, opening_float_centavos, closed_at, counted_centavos, expected_centavos)
    values ('${SHIFT_CLOSED}', '${DEVICE_2}', '2026-11-19T00:00:00Z', 50000, '2026-11-19T10:00:00Z', 60000, 60000);
  insert into orders (id, channel, fulfilment, business_day, ticket_series, ticket_number, customer_name,
      prep_status, payment_status, subtotal_centavos, discount_centavos, delivery_fee_centavos, total_centavos,
      device_id, shift_id, flags)
    values ('${ORDER_OLD}', 'counter', 'dine_in', '2026-11-20', 'C', 1, 'Walk-in', 'placed', 'paid',
      10000, 0, 0, 10000, '${DEVICE}', '${SHIFT_OPEN}', '{price_differs}');
  insert into sync_events (device_id, id, seq, kind, payload, staff_id, entity_keys, occurred_at, received_at,
      result, reason, applied_at)
    values
      ('${DEVICE}', '${EV_APPLIED}', 1, 'shift.opened', '{}', '${OWNER}', '{shift:${SHIFT_OPEN}}',
        '2026-11-20T00:00:00Z', '2026-11-20T00:00:05Z', 'applied', null, '2026-11-20T00:00:05Z'),
      ('${DEVICE}', '${EV_FLAGGED}', 2, 'order.created', '{}', '${OWNER}', '{order:${ORDER_OLD}}',
        '2026-11-20T01:00:00Z', '2026-11-20T01:00:05Z', 'flagged', 'already_recorded_differs', '2026-11-20T01:00:05Z'),
      ('${DEVICE}', '${EV_HELD}', 3, 'order.created', '{}', '${OWNER}', '{order:x}',
        '2026-11-20T02:00:00Z', '2026-11-20T02:00:05Z', 'held', 'shift_unknown', null),
      ('${DEVICE}', '${EV_HELD_2}', 4, 'order.created', '{}', '${OWNER}', '{order:y}',
        '2026-11-20T03:00:00Z', '2026-11-20T03:00:05Z', 'held', 'shift_unknown', null);
`

let db: TestDb
beforeAll(async () => {
  db = await startTestDb({ seedBefore: { migration: '0018', sql: SEED } })
})
afterAll(async () => {
  await db.stop()
})

// sync_events

test('existing receipts keep their result and have no resolution', async () => {
  const rows = await db.sql`select id, result, resolved_at, resolved_by, resolve_note from sync_events order by seq`
  expect(rows.map((r) => [r.result, r.resolved_at, r.resolved_by, r.resolve_note])).toEqual([
    ['applied', null, null, null],
    ['flagged', null, null, null],
    ['held', null, null, null],
    ['held', null, null, null],
  ])
})

test('discarding without resolved_by fails sync_events_discarded_resolved; with all three set it succeeds', async () => {
  await expect(db.sql`update sync_events
    set result = 'discarded', resolved_at = '2026-11-21T00:00:00Z', resolve_note = 'Duplicate sale'
    where id = ${EV_HELD}`).rejects.toThrow(/sync_events_discarded_resolved/)
  await expect(db.sql`update sync_events
    set result = 'discarded', resolved_by = ${OWNER}, resolve_note = 'Duplicate sale'
    where id = ${EV_HELD}`).rejects.toThrow(/sync_events_discarded_resolved/)
  await expect(db.sql`update sync_events
    set result = 'discarded', resolved_at = '2026-11-21T00:00:00Z', resolved_by = ${OWNER}
    where id = ${EV_HELD}`).rejects.toThrow(/sync_events_discarded_resolved/)

  const [row] = await db.sql`update sync_events
    set result = 'discarded', resolved_at = '2026-11-21T00:00:00Z', resolved_by = ${OWNER},
      resolve_note = 'Duplicate sale'
    where id = ${EV_HELD} returning result`
  expect(row!.result).toBe('discarded')
})

test('an unknown result still fails the result check', async () => {
  await expect(db.sql`update sync_events set result = 'dropped' where id = ${EV_APPLIED}`).rejects.toThrow(
    /sync_events_result_check/,
  )
})

test('a seen flagged receipt keeps result flagged with resolved_* set', async () => {
  const [row] = await db.sql`update sync_events
    set resolved_at = '2026-11-21T00:00:00Z', resolved_by = ${OWNER}, resolve_note = 'Checked'
    where id = ${EV_FLAGGED} returning result, resolved_by`
  expect(row).toEqual({ result: 'flagged', resolved_by: OWNER })
})

test('resolve_note must be 1 to 200 characters', async () => {
  await expect(db.sql`update sync_events set resolve_note = '' where id = ${EV_APPLIED}`).rejects.toThrow(
    /sync_events_resolve_note_check/,
  )
  await expect(
    db.sql`update sync_events set resolve_note = ${'x'.repeat(201)} where id = ${EV_APPLIED}`,
  ).rejects.toThrow(/sync_events_resolve_note_check/)
  await db.sql`update sync_events set resolve_note = ${'x'.repeat(200)} where id = ${EV_APPLIED}`
  await db.sql`update sync_events set resolve_note = null where id = ${EV_APPLIED}`
})

test('resolved_by must be a staff id', async () => {
  await expect(db.sql`update sync_events
    set resolved_at = now(), resolved_by = '00000000-0000-4000-8000-000000000000', resolve_note = 'x'
    where id = ${EV_HELD_2}`).rejects.toThrow(/sync_events_resolved_by_fkey/)
})

// shifts

test('shifts.closed_in_admin is false on existing shifts and defaults to false on new ones', async () => {
  await db.sql`insert into shifts (id, device_id, opened_at, opening_float_centavos)
    values ('55555555-5555-4555-8555-555555555553', ${DEVICE_2}, '2026-11-20T00:00:00Z', 0)`
  const rows = await db.sql`select closed_in_admin from shifts order by id`
  expect(rows.map((r) => r.closed_in_admin)).toEqual([false, false, false])
  await expect(db.sql`update shifts set closed_in_admin = null where id = ${SHIFT_OPEN}`).rejects.toThrow(
    /null value/,
  )
})

// orders

test('orders.flags_seen_at and flags_seen_by exist and are null on old rows', async () => {
  const [row] = await db.sql`select flags_seen_at, flags_seen_by from orders where id = ${ORDER_OLD}`
  expect(row).toEqual({ flags_seen_at: null, flags_seen_by: null })
  const [seen] = await db.sql`update orders set flags_seen_at = '2026-11-21T00:00:00Z', flags_seen_by = ${OWNER}
    where id = ${ORDER_OLD} returning flags_seen_by`
  expect(seen!.flags_seen_by).toBe(OWNER)
  await expect(db.sql`update orders set flags_seen_by = '00000000-0000-4000-8000-000000000000'
    where id = ${ORDER_OLD}`).rejects.toThrow(/orders_flags_seen_by_fkey/)
})

// indexes

test('sync_events_open and orders_business_day_idx exist', async () => {
  const rows = await db.sql`select indexname, indexdef from pg_indexes
    where indexname in ('sync_events_open', 'orders_business_day_idx') order by indexname`
  expect(rows.map((r) => r.indexname)).toEqual(['orders_business_day_idx', 'sync_events_open'])
  const open = rows.find((r) => r.indexname === 'sync_events_open')!.indexdef as string
  expect(open).toMatch(/received_at DESC/)
  expect(open).toMatch(/WHERE/)
})

// privileges

test('kennko_api never holds DELETE on sync_events, shifts, orders or payments', async () => {
  const rows = await db.sql`
    select t.tbl from (values ('sync_events'), ('shifts'), ('orders'), ('payments')) t(tbl)
    where has_table_privilege('kennko_api', t.tbl, 'DELETE')`
  expect(rows).toEqual([])
})

test('kennko_api may select and update sync_events, shifts and orders, and every new column', async () => {
  const [t] = await db.sql`select
    has_table_privilege('kennko_api', 'sync_events', 'UPDATE') as ev,
    has_table_privilege('kennko_api', 'shifts', 'UPDATE') as sh,
    has_table_privilege('kennko_api', 'orders', 'UPDATE') as ord`
  expect(t).toEqual({ ev: true, sh: true, ord: true })
  const cols = await db.sql`
    select c.tbl, c.col, p.priv from (values
      ('sync_events', 'resolved_at'), ('sync_events', 'resolved_by'), ('sync_events', 'resolve_note'),
      ('shifts', 'closed_in_admin'), ('orders', 'flags_seen_at'), ('orders', 'flags_seen_by')
    ) c(tbl, col), (values ('SELECT'), ('UPDATE')) p(priv)
    where not has_column_privilege('kennko_api', c.tbl, c.col, p.priv)`
  expect(cols).toEqual([])
})

test('anon and authenticated hold nothing on sync_events and shifts', async () => {
  const privs = await db.sql`
    select r.role, t.tbl, p.priv
    from (values ('anon'), ('authenticated')) r(role),
         (values ('shifts'), ('sync_events')) t(tbl),
         (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('REFERENCES'), ('TRIGGER'), ('TRUNCATE')) p(priv)
    where has_table_privilege(r.role, t.tbl, p.priv)`
  expect(privs).toEqual([])
})

test('anon and authenticated may read but not write the new order columns', async () => {
  const rows = await db.sql`
    select r.role, c.col, p.priv, has_column_privilege(r.role, 'orders', c.col, p.priv) as has
    from (values ('anon'), ('authenticated')) r(role),
         (values ('flags_seen_at'), ('flags_seen_by')) c(col),
         (values ('SELECT'), ('INSERT'), ('UPDATE')) p(priv)`
  for (const r of rows) expect([r.role, r.col, r.priv, r.has]).toEqual([r.role, r.col, r.priv, r.priv === 'SELECT'])
})

test('as kennko_api, a held receipt can be discarded and an order marked seen', async () => {
  await db.sql.begin(async (tx) => {
    await tx.unsafe('set local role kennko_api')
    const ev = await tx`update sync_events
      set result = 'discarded', resolved_at = '2026-11-21T00:00:00Z', resolved_by = ${OWNER}, resolve_note = 'Test'
      where id = ${EV_HELD_2} returning result`
    expect(ev).toEqual([{ result: 'discarded' }])
    const sh = await tx`update shifts set closed_in_admin = true, closed_at = '2026-11-21T00:00:00Z',
      counted_centavos = 0, closed_by_staff = ${OWNER} where id = ${SHIFT_OPEN} returning closed_in_admin`
    expect(sh).toEqual([{ closed_in_admin: true }])
    const ord = await tx`update orders set flags_seen_at = null, flags_seen_by = null
      where id = ${ORDER_OLD} returning id`
    expect(ord).toHaveLength(1)
  })
})

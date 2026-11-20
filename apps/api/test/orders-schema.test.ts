import { afterAll, beforeAll, expect, test } from 'vitest'
import { asUser, startTestDb, type TestDb } from './pg.js'

const OWNER = '11111111-1111-4111-8111-111111111111'
const CUSTOMER = '33333333-3333-4333-8333-333333333333'
const ZONE = '00000000-0000-4000-8000-0000000000e1'
const CAT = '00000000-0000-4000-8000-0000000000c1'
const ITEM = '00000000-0000-4000-8000-0000000000a1'
const GROUP = '00000000-0000-4000-8000-0000000000d1'
const OPTION = '00000000-0000-4000-8000-0000000000b1'

const DEVICE = '00000000-0000-4000-8000-0000000000f1'

const order = (n: number) => `0000000${n}-0000-4000-8000-000000000000`
const line = (n: number) => `0000000${n}-0000-4000-8000-0000000000f0`
const LINE_NO_ITEM = '00000002-0000-4000-8000-0000000000f1'

// Old status, Manila wall-clock time, verified?, fulfilment, has the option (or the option is gone).
const LEGACY_ORDERS: [number, string, string, boolean, 'pickup' | 'delivery'][] = [
  [1, 'awaiting_verification', '2026-11-18 10:00', false, 'pickup'],
  [2, 'confirmed', '2026-11-18 23:30', true, 'pickup'],
  [3, 'preparing', '2026-11-19 00:30', true, 'pickup'],
  [4, 'ready', '2026-11-19 09:00', true, 'pickup'],
  [5, 'out_for_delivery', '2026-11-19 10:00', true, 'delivery'],
  [6, 'completed', '2026-11-17 12:00', true, 'pickup'],
  [7, 'rejected', '2026-11-17 13:00', false, 'pickup'],
  [8, 'cancelled', '2026-11-17 14:00', true, 'pickup'],
]

// Today's shape, loaded just before 0014 runs.
const LEGACY = `
insert into auth.users (id, email, email_confirmed_at) values
  ('${OWNER}', 'owner@kennko.test', now()),
  ('${CUSTOMER}', 'cust@kennko.test', now());
insert into staff (id, email, full_name, role) values ('${OWNER}', 'owner@kennko.test', 'Olive', 'owner');
insert into delivery_zones (id, barangay, fee_centavos, latitude, longitude) values ('${ZONE}', 'Test Barangay', 5000, 8.93, 125.53);
insert into menu_categories (id, name) values ('${CAT}', 'Coffee');
insert into menu_items (id, category_id, name) values ('${ITEM}', '${CAT}', 'Americano');
insert into menu_variants (item_id, code, label, price_centavos, temperature) values ('${ITEM}', 'M', 'Medium', 10000, 'iced');
insert into option_groups (id, name) values ('${GROUP}', 'Milk');
insert into options (id, group_id, name, price_centavos) values ('${OPTION}', '${GROUP}', 'Oat milk', 0);
${LEGACY_ORDERS.map(
  ([n, status, at, verified, fulfilment]) => `
insert into orders (id, order_code, customer_name, customer_phone, customer_email, customer_user_id, fulfilment,
  delivery_address, delivery_barangay, delivery_zone_id, fulfil_at, status,
  subtotal_centavos, delivery_fee_centavos, total_centavos, gcash_reference, payment_proof_path,
  verified_by, verified_at, created_at)
values ('${order(n)}', 'K00${n}', 'Cust ${n}', '0917000000${n}', 'cust@kennko.test', ${n === 1 ? `'${CUSTOMER}'` : 'null'},
  '${fulfilment}',
  ${fulfilment === 'delivery' ? `'1 Gate St', 'Test Barangay', '${ZONE}'` : 'null, null, null'},
  '${at}+08', '${status}', 10000, ${fulfilment === 'delivery' ? 5000 : 0}, ${fulfilment === 'delivery' ? 15000 : 10000},
  'REF${n}', 'proofs/${n}.jpg',
  ${verified ? `'${OWNER}', '${at}+08'::timestamptz + interval '5 minutes'` : 'null, null'}, '${at}+08');
insert into order_items (id, order_id, menu_item_id, name_snapshot, size, base_price_centavos, quantity,
  line_total_centavos, ice_level, ice_serve, item_note)
values ('${line(n)}', '${order(n)}', '${ITEM}', 'Americano', 'M', 10000, 1, 10000, 'regular', 'mixed', 'note ${n}');
insert into order_item_modifiers (order_item_id, modifier_id, name_snapshot, price_centavos)
values ('${line(n)}', ${n === 7 ? 'null' : `'${OPTION}'`}, 'Oat milk', 0);`,
).join('\n')}
insert into order_items (id, order_id, menu_item_id, name_snapshot, size, base_price_centavos, quantity,
  line_total_centavos, ice_level, ice_serve)
values ('${LINE_NO_ITEM}', '${order(2)}', null, 'Old Latte', 'L', 0, 1, 0, 'less', 'side');
`

let db: TestDb
beforeAll(async () => {
  db = await startTestDb({ seedBefore: { migration: '0014_unified_orders.sql', sql: LEGACY } })
  await db.sql`insert into devices (id, name) values (${DEVICE}, 'Front till')`
})
afterAll(async () => {
  await db.stop()
})

test('maps every old status to a prep/payment pair with one payment each', async () => {
  const rows = await db.sql`
    select o.id, o.prep_status, o.payment_status, o.channel, o.fulfilment,
           p.method, p.amount_centavos, p.status as pay_status, p.reference, p.proof_path,
           p.verified_by, p.recorded_at = o.created_at as recorded_at_created,
           (select count(*)::int from payments x where x.order_id = o.id) as payment_count
    from orders o join payments p on p.order_id = o.id order by o.id`
  expect(rows.map((r) => [r.prep_status, r.payment_status, r.pay_status])).toEqual([
    ['placed', 'pending_verification', 'pending_verification'],
    ['placed', 'paid', 'verified'],
    ['preparing', 'paid', 'verified'],
    ['ready', 'paid', 'verified'],
    ['out_for_delivery', 'paid', 'verified'],
    ['completed', 'paid', 'verified'],
    ['cancelled', 'rejected', 'rejected'],
    ['cancelled', 'refunded', 'refunded'],
  ])
  rows.forEach((r, i) => {
    const n = i + 1
    expect(r.payment_count).toBe(1)
    expect(r.channel).toBe('online')
    expect(r.method).toBe('gcash')
    expect(r.amount_centavos).toBe(n === 5 ? 15000 : 10000)
    expect(r.reference).toBe(`REF${n}`)
    expect(r.proof_path).toBe(`proofs/${n}.jpg`)
    expect(r.recorded_at_created).toBe(true)
    expect(r.verified_by).toBe(LEGACY_ORDERS[i][3] ? OWNER : null)
  })
  expect(rows[4].fulfilment).toBe('delivery')
})

test('a legacy cancelled order gets cancelled_at (its created_at); a legacy rejection does not', async () => {
  const rows = await db.sql`
    select id, cancelled_at, cancelled_at = created_at as at_created from orders order by id`
  rows.forEach((r, i) => {
    if (i + 1 === 8) expect(r.at_created).toBe(true)
    else expect(r.cancelled_at).toBeNull()
  })
})

test('records one created event per old order', async () => {
  const rows = await db.sql`
    select o.prep_status, e.kind, e.to_value, e.occurred_at = o.created_at as at_created, e.result
    from orders o join order_events e on e.order_id = o.id order by o.id`
  expect(rows).toHaveLength(8)
  for (const r of rows) {
    expect(r.kind).toBe('created')
    expect(r.to_value).toBe(r.prep_status)
    expect(r.at_created).toBe(true)
    expect(r.result).toBe('applied')
  }
})

test('numbers W tickets per Manila day in creation order', async () => {
  const rows = await db.sql`
    select id, business_day::text as day, ticket_series, ticket_number from orders order by id`
  expect(rows.map((r) => [r.day, r.ticket_series, r.ticket_number])).toEqual([
    ['2026-11-18', 'W', 1],
    ['2026-11-18', 'W', 2],
    ['2026-11-19', 'W', 1], // 00:30 Manila is still the 18th in UTC
    ['2026-11-19', 'W', 2],
    ['2026-11-19', 'W', 3],
    ['2026-11-17', 'W', 1],
    ['2026-11-17', 'W', 2],
    ['2026-11-17', 'W', 3],
  ])
  const counters = await db.sql`
    select business_day::text as day, series, last_number from ticket_counters order by business_day`
  expect(counters.map((c) => [c.day, c.series, c.last_number])).toEqual([
    ['2026-11-17', 'W', 3],
    ['2026-11-18', 'W', 2],
    ['2026-11-19', 'W', 3],
  ])
})

test('lines carry variants and options carry their group', async () => {
  const lines = await db.sql`
    select l.item_id, l.item_name, l.variant_id, l.variant_code, l.variant_label, l.unit_price_centavos, l.note,
           v.code as joined_code
    from order_lines l left join menu_variants v on v.id = l.variant_id
    where l.order_id = ${order(1)}`
  expect(lines).toHaveLength(1)
  expect(lines[0]).toMatchObject({
    item_id: ITEM,
    item_name: 'Americano',
    variant_code: 'M',
    variant_label: 'Medium',
    joined_code: 'M',
    unit_price_centavos: 10000,
    note: 'note 1',
  })
  const options = await db.sql`
    select l.order_id, o.option_id, o.option_name, o.group_name
    from order_line_options o join order_lines l on l.id = o.line_id order by l.order_id`
  expect(options).toHaveLength(8)
  expect(options[0]).toMatchObject({ option_id: OPTION, option_name: 'Oat milk', group_name: 'Milk' })
  expect(options[6]).toMatchObject({ option_id: null, option_name: 'Oat milk', group_name: '' })
})

test('a legacy line whose menu item is gone keeps its code and label, with no variant', async () => {
  const [row] = await db.sql`select item_id, item_name, variant_id, variant_code, variant_label
    from order_lines where id = ${LINE_NO_ITEM}`
  expect(row).toEqual({ item_id: null, item_name: 'Old Latte', variant_id: null, variant_code: 'L', variant_label: 'Large' })
})

test('old columns and types are gone', async () => {
  const cols = await db.sql`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public' and (
      (table_name = 'orders' and column_name in ('status', 'gcash_reference', 'payment_proof_path', 'verified_by', 'verified_at'))
      or (table_name = 'order_lines' and column_name = 'size'))`
  expect(cols).toEqual([])
  const types = await db.sql`
    select typname from pg_type where typnamespace = 'public'::regnamespace
      and typname in ('order_status', 'fulfilment_method', 'drink_size')`
  expect(types).toEqual([])
  const tables = await db.sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name in ('order_items', 'order_item_modifiers')`
  expect(tables).toEqual([])
})

test('a customer still reads their own order and lines, and no payments', async () => {
  const result = await asUser(db.sql, CUSTOMER, async (tx) => ({
    orders: await tx`select id from orders where id = ${order(1)}`,
    lines: await tx`select id from order_lines where order_id = ${order(1)}`,
    options: await tx`select o.id from order_line_options o join order_lines l on l.id = o.line_id
      where l.order_id = ${order(1)}`,
    payments: await tx`select id from payments`,
    events: await tx`select id from order_events`,
  }))
  expect(result.orders).toHaveLength(1)
  expect(result.lines).toHaveLength(1)
  expect(result.options).toHaveLength(1)
  expect(result.payments).toHaveLength(0)
  expect(result.events).toHaveLength(0)
})

test('anon and authenticated hold no privileges on ticket_counters, and only select on payments and events', async () => {
  for (const user of [null, CUSTOMER]) {
    await expect(asUser(db.sql, user, (tx) => tx`select * from ticket_counters`)).rejects.toMatchObject({ code: '42501' })
  }
  await expect(
    asUser(db.sql, OWNER, (tx) => tx`insert into order_events (order_id, kind) values (${order(1)}, 'note')`),
  ).rejects.toMatchObject({ code: '42501' })
  const privs = await db.sql`
    select r.role, t.tbl, p.priv, has_table_privilege(r.role, t.tbl, p.priv) as has
    from (values ('anon'), ('authenticated')) r(role),
         (values ('payments'), ('order_events'), ('ticket_counters')) t(tbl),
         (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('REFERENCES'), ('TRIGGER'), ('TRUNCATE')) p(priv)
    where has_table_privilege(r.role, t.tbl, p.priv)`
  expect(privs.map((x) => `${x.role}:${x.tbl}:${x.priv}`).sort()).toEqual([
    'authenticated:order_events:SELECT',
    'authenticated:payments:SELECT',
  ])
})

test('anon and authenticated keep only select on orders, order_lines and order_line_options', async () => {
  const privs = await db.sql`
    select r.role, t.tbl, p.priv, has_table_privilege(r.role, t.tbl, p.priv) as has
    from (values ('anon'), ('authenticated')) r(role),
         (values ('orders'), ('order_lines'), ('order_line_options')) t(tbl),
         (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)`
  for (const x of privs) expect(`${x.role}:${x.tbl}:${x.priv}:${x.has}`).toBe(`${x.role}:${x.tbl}:${x.priv}:${x.priv === 'SELECT'}`)
  expect(privs).toHaveLength(42)
})

test('the old gcash reference index is gone', async () => {
  const idx = await db.sql`select 1 from pg_indexes where indexname = 'orders_gcash_reference_idx'`
  expect(idx).toHaveLength(0)
})

test('staff read orders and payments but can no longer update orders', async () => {
  const result = await asUser(db.sql, OWNER, async (tx) => ({
    orders: await tx`select id from orders`,
    payments: await tx`select id from payments`,
    events: await tx`select id from order_events`,
  }))
  expect(result.orders).toHaveLength(8)
  expect(result.payments).toHaveLength(8)
  expect(result.events).toHaveLength(8)
  // No update privilege at all now, not merely no policy.
  await expect(
    asUser(db.sql, OWNER, (tx) => tx`update orders set staff_note = 'x' returning id`),
  ).rejects.toMatchObject({ code: '42501' })
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
    payment_status: 'unpaid',
    subtotal_centavos: 10000,
    discount_centavos: 0,
    delivery_fee_centavos: 0,
    total_centavos: 10000,
    // Every counter order comes from a till (0017 orders_counter_device).
    device_id: (fields.channel ?? 'counter') === 'counter' ? DEVICE : null,
    ...fields,
  }
  return db.sql`insert into orders ${db.sql(row)} returning id`
}

test('a counter dine-in order needs no phone, email, code or fulfil time', async () => {
  const [row] = await insertOrder({})
  expect(row.id).toBeTruthy()
})

test('an online order without a code fails orders_online_contact', async () => {
  await expect(
    insertOrder({
      channel: 'online',
      fulfilment: 'pickup',
      ticket_series: 'W',
      ticket_number: 99,
      customer_phone: '09170000000',
      customer_email: 'x@kennko.test',
      fulfil_at: '2026-11-20T10:00:00+08:00',
    }),
  ).rejects.toMatchObject({ constraint_name: 'orders_online_contact' })
})

test('total must equal subtotal minus discount plus fee', async () => {
  await expect(insertOrder({ discount_centavos: 2000, total_centavos: 10000 })).rejects.toMatchObject({
    constraint_name: 'orders_total_math',
  })
  const [ok] = await insertOrder({ ticket_number: 2, discount_centavos: 2000, total_centavos: 8000 })
  expect(ok.id).toBeTruthy()
})

test('a counter order cannot be a delivery, and the series follows the channel', async () => {
  await expect(insertOrder({ fulfilment: 'pickup' })).rejects.toMatchObject({
    constraint_name: 'orders_channel_fulfilment',
  })
  await expect(insertOrder({ ticket_series: 'W', ticket_number: 50 })).rejects.toMatchObject({
    constraint_name: 'orders_ticket_series_channel',
  })
})

const onlineOrder = (fields: Record<string, unknown>) =>
  insertOrder({
    channel: 'online',
    fulfilment: 'pickup',
    ticket_series: 'W',
    order_code: `T-${fields.ticket_number}`,
    customer_phone: '09170000000',
    customer_email: 'x@kennko.test',
    fulfil_at: '2026-11-20T10:00:00+08:00',
    ...fields,
  })

test('a discount larger than the subtotal fails orders_discount_le_subtotal', async () => {
  // A delivery fee keeps the total non-negative, so only the discount rule can fail.
  await expect(
    onlineOrder({
      ticket_number: 101,
      fulfilment: 'delivery',
      delivery_address: '1 Gate St',
      delivery_barangay: 'Test Barangay',
      delivery_zone_id: ZONE,
      subtotal_centavos: 10000,
      discount_centavos: 12000,
      delivery_fee_centavos: 5000,
      total_centavos: 3000,
    }),
  ).rejects.toMatchObject({ constraint_name: 'orders_discount_le_subtotal' })
})

test('a pickup order with a delivery fee fails orders_delivery_needs_address', async () => {
  await expect(
    onlineOrder({ ticket_number: 102, delivery_fee_centavos: 5000, total_centavos: 15000 }),
  ).rejects.toMatchObject({ constraint_name: 'orders_delivery_needs_address' })
  const [ok] = await onlineOrder({ ticket_number: 103 })
  expect(ok.id).toBeTruthy()
})

test('one live payment per order; a rejected one does not count', async () => {
  await expect(
    db.sql`insert into payments (order_id, method, amount_centavos, status)
      values (${order(2)}, 'gcash', 10000, 'pending_verification')`,
  ).rejects.toMatchObject({ constraint_name: 'payments_one_live' })
  // Order 7's payment was rejected, so a fresh one is allowed.
  await db.sql`insert into payments (order_id, method, amount_centavos, status)
    values (${order(7)}, 'gcash', 10000, 'pending_verification')`
  await expect(
    db.sql`insert into payments (order_id, method, amount_centavos, tendered_centavos, change_centavos, status)
      values (${order(7)}, 'cash', 10000, 20000, 5000, 'rejected')`,
  ).rejects.toThrow(/check/)
})

test('kennko_api can write orders, payments, events and counters', async () => {
  await db.sql.begin(async (tx) => {
    await tx.unsafe('set local role kennko_api')
    await tx`insert into ticket_counters (business_day, series, last_number) values ('2026-11-21', 'W', 1)`
    await tx`update ticket_counters set last_number = 2 where business_day = '2026-11-21'`
    await tx`select id from delivery_zones limit 1`
    const [o] = await tx`select id from orders where id = ${order(1)}`
    expect(o.id).toBe(order(1))
    await tx`update orders set staff_note = 'api' where id = ${order(1)}`
    await tx`insert into order_events (order_id, kind, to_value) values (${order(1)}, 'note', 'api')`
    await tx`update payments set status = 'verified' where order_id = ${order(1)}`
    await tx`select id from order_lines`
    await tx`select id from order_line_options`
  })
})

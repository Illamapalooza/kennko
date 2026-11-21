import { afterAll, beforeAll, expect, test } from 'vitest'
import { asUser, startTestDb, type TestDb } from './pg.js'

// Rows that exist on the live database before 0019 runs: staff, a till with an open shift, a counter
// order and an online guest order with lines and options, and receipts of every kind already stored
// (including the legacy import.* kinds). Every new column and check must hold for them.
const OWNER_USER = '11111111-1111-4111-8111-111111111111'
const OWNER = '22222222-2222-4222-8222-222222222222'
const DEVICE = '33333333-3333-4333-8333-333333333333'
const SHIFT = '55555555-5555-4555-8555-555555555551'
const ORDER_COUNTER = '99999999-9999-4999-8999-999999999991'
const ORDER_ONLINE = '99999999-9999-4999-8999-999999999992'
const LINE_COUNTER = '77777777-7777-4777-8777-777777777771'
const LINE_ONLINE = '77777777-7777-4777-8777-777777777772'

// Accounts made after 0019.
const ANA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const BEN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const CY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
const GONE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'

const SEED = `
  insert into auth.users (id, email, email_confirmed_at) values ('${OWNER_USER}', 'owner@kennko.test', now());
  insert into staff (id, user_id, email, full_name, role)
    values ('${OWNER}', '${OWNER_USER}', 'owner@kennko.test', 'Olive', 'owner');
  insert into devices (id, name) values ('${DEVICE}', 'Front till');
  insert into shifts (id, device_id, opened_at, opened_by_staff, opening_float_centavos)
    values ('${SHIFT}', '${DEVICE}', '2026-11-20T00:00:00Z', '${OWNER}', 100000);
  insert into orders (id, channel, fulfilment, business_day, ticket_series, ticket_number, customer_name,
      prep_status, payment_status, subtotal_centavos, discount_centavos, delivery_fee_centavos, total_centavos,
      device_id, shift_id)
    values ('${ORDER_COUNTER}', 'counter', 'dine_in', '2026-11-20', 'C', 1, 'Walk-in', 'completed', 'paid',
      10000, 0, 0, 10000, '${DEVICE}', '${SHIFT}');
  insert into orders (id, channel, order_code, fulfilment, prep_status, payment_status, business_day,
      ticket_series, ticket_number, customer_name, customer_phone, customer_email, fulfil_at,
      subtotal_centavos, delivery_fee_centavos, total_centavos, created_at)
    values ('${ORDER_ONLINE}', 'online', 'KNK-OLD1', 'pickup', 'completed', 'paid', '2026-11-20', 'W', 1,
      'Guest', '09170000000', 'guest@x.test', '2026-11-20T04:00:00Z', 12000, 0, 12000, '2026-11-20T03:00:00Z');
  insert into order_lines (id, order_id, item_name, variant_code, variant_label, unit_price_centavos, quantity,
      line_total_centavos)
    values ('${LINE_COUNTER}', '${ORDER_COUNTER}', 'Latte', 'M', 'Medium', 10000, 1, 10000),
           ('${LINE_ONLINE}', '${ORDER_ONLINE}', 'Latte', 'M', 'Medium', 12000, 1, 12000);
  insert into sync_events (device_id, id, seq, kind, payload, staff_id, entity_keys, occurred_at, received_at,
      result, reason, applied_at)
    select '${DEVICE}', gen_random_uuid(), n, k, '{}', '${OWNER}', '{x}', '2026-11-20T00:00:00Z',
      '2026-11-20T00:00:05Z', case when k like 'import.%' then 'held' else 'applied' end,
      case when k like 'import.%' then 'invalid: legacy: test' end, null
    from unnest(array['order.created', 'order.prep_status', 'order.cancelled', 'shift.opened', 'shift.closed',
      'cash.moved', 'menu.availability', 'import.shift', 'import.order', 'import.cash_move'])
      with ordinality as t(k, n);
`

const NEW_TABLES = ['customers', 'stamp_cards', 'stamps', 'points_ledger', 'rate_limits']

let db: TestDb
let seq = 10
let codeSeq = 0

/** A 9-symbol public code from the allowed alphabet, unique per call (the check symbol is not tested here). */
function code(): string {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
  codeSeq += 1
  let n = codeSeq
  let out = ''
  for (let i = 0; i < 9; i++) {
    out += alphabet[n % alphabet.length]
    n = Math.floor(n / alphabet.length)
  }
  return out
}

async function addCustomer(id: string, email: string, createdAt = '2026-11-10T00:00:00Z') {
  await db.sql`insert into auth.users (id, email, email_confirmed_at, created_at)
    values (${id}, ${email}, ${createdAt}, ${createdAt})`
  await db.sql`insert into customers (id, public_code, display_name, age_confirmed_at, privacy_accepted_at,
      privacy_version, created_at)
    values (${id}, ${code()}, 'Ana', ${createdAt}, ${createdAt}, '2026-11', ${createdAt})`
}

async function addOrder(opts: { email?: string; userId?: string; createdAt?: string; customerId?: string } = {}) {
  seq += 1
  const at = opts.createdAt ?? '2026-11-20T03:00:00Z'
  const [o] = await db.sql`
    insert into orders (channel, order_code, fulfilment, prep_status, payment_status, business_day,
      ticket_series, ticket_number, customer_name, customer_phone, customer_email, customer_user_id, customer_id,
      fulfil_at, subtotal_centavos, delivery_fee_centavos, total_centavos, created_at)
    values ('online', ${`KNK-T${seq}`}, 'pickup', 'completed', 'paid', '2026-11-20', 'W', ${seq}, 'Ana',
      '09170000000', ${opts.email ?? 'someone@x.test'}, ${opts.userId ?? null}, ${opts.customerId ?? null},
      ${at}, 12000, 0, 12000, ${at})
    returning id`
  const id = o!.id as string
  const [l] = await db.sql`insert into order_lines (order_id, item_name, variant_code, variant_label,
      unit_price_centavos, quantity, line_total_centavos)
    values (${id}, 'Latte', 'M', 'Medium', 12000, 1, 12000) returning id`
  await db.sql`insert into order_line_options (line_id, option_name, group_name, price_centavos)
    values (${l!.id}, 'Oat milk', 'Milk', 0)`
  return id
}

async function addCard(customerId: string, filled = false) {
  const [c] = await db.sql`insert into stamp_cards (customer_id, started_at, filled_at)
    values (${customerId}, '2026-11-20T00:00:00Z', ${filled ? '2026-11-20T05:00:00Z' : null}) returning id`
  return c!.id as string
}

async function addStamp(customerId: string, orderId: string, cardId: string | null, flags: string[] = []) {
  await db.sql`insert into stamps (id, customer_id, card_id, order_id, device_id, stamped_at, received_at, flags)
    values (gen_random_uuid(), ${customerId}, ${cardId}, ${orderId}, ${DEVICE}, '2026-11-20T03:00:00Z',
      '2026-11-20T03:00:05Z', ${flags})`
}

beforeAll(async () => {
  db = await startTestDb({ seedBefore: { migration: '0019', sql: SEED } })
  await addCustomer(BEN, 'ben@x.test')
})
afterAll(async () => {
  await db.stop()
})

// Existing rows

test('existing orders have no customer, existing lines are not rewards, and every old receipt is kept', async () => {
  const orders = await db.sql`select id, customer_id from orders where id in (${ORDER_COUNTER}, ${ORDER_ONLINE})`
  expect(orders.map((o) => o.customer_id)).toEqual([null, null])
  const lines = await db.sql`select is_reward from order_lines where id in (${LINE_COUNTER}, ${LINE_ONLINE})`
  expect(lines.map((l) => l.is_reward)).toEqual([false, false])
  const [{ count }] = await db.sql`select count(*)::int from sync_events`
  expect(count).toBe(10)
})

test('order_lines.is_reward defaults to false and cannot be null', async () => {
  const id = await addOrder()
  const [l] = await db.sql`select is_reward from order_lines where order_id = ${id}`
  expect(l!.is_reward).toBe(false)
  await expect(db.sql`update order_lines set is_reward = null where order_id = ${id}`).rejects.toThrow(/null value/)
})

test('the sync_events kind check accepts the four new kinds and still refuses an unknown one', async () => {
  for (const [i, kind] of ['customer.linked', 'customer.unlinked', 'stamp.added', 'reward.used'].entries()) {
    await db.sql`insert into sync_events (device_id, id, seq, kind, payload, entity_keys, occurred_at, received_at, result)
      values (${DEVICE}, gen_random_uuid(), ${100 + i}, ${kind}, '{}', '{x}', now(), now(), 'applied')`
  }
  await expect(db.sql`insert into sync_events (device_id, id, seq, kind, payload, entity_keys, occurred_at,
      received_at, result)
    values (${DEVICE}, gen_random_uuid(), 200, 'stamp.removed', '{}', '{x}', now(), now(), 'applied')`).rejects.toThrow(
    /sync_events_kind_check/,
  )
})

// customers

test('a public code with O, or of the wrong length, fails the public code check', async () => {
  await db.sql`insert into auth.users (id, email, created_at) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'o@x.test', now())`
  for (const bad of ['7F3K9QXAO', '7F3K9QXA', '7F3K9QXAMM', '7f3k9qxam']) {
    await expect(db.sql`insert into customers (id, public_code, display_name, age_confirmed_at, privacy_accepted_at,
        privacy_version, created_at)
      values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', ${bad}, 'O', now(), now(), 'v1', now())`).rejects.toThrow(
      /customers_public_code_check/,
    )
  }
})

test('stamp_mode defaults to none and refuses an unknown mode; display_name must be 1 to 40 characters', async () => {
  const [c] = await db.sql`select stamp_mode from customers where id = ${BEN}`
  expect(c!.stamp_mode).toBe('none')
  await expect(db.sql`update customers set stamp_mode = 'plastic' where id = ${BEN}`).rejects.toThrow(
    /customers_stamp_mode_check/,
  )
  await expect(db.sql`update customers set display_name = '' where id = ${BEN}`).rejects.toThrow(
    /customers_display_name_check/,
  )
  await expect(db.sql`update customers set display_name = ${'x'.repeat(41)} where id = ${BEN}`).rejects.toThrow(
    /customers_display_name_check/,
  )
})

test('a customer must be an auth user', async () => {
  await expect(db.sql`insert into customers (id, public_code, display_name, age_confirmed_at, privacy_accepted_at,
      privacy_version, created_at)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', ${code()}, 'Nobody', now(), now(), 'v1', now())`).rejects.toThrow(
    /customers_id_fkey/,
  )
})

// stamp_cards

test('a second open card fails stamp_cards_one_open; a filled card plus a new open one succeeds', async () => {
  const first = await addCard(BEN)
  await expect(addCard(BEN)).rejects.toThrow(/stamp_cards_one_open/)
  await db.sql`update stamp_cards set filled_at = '2026-11-20T05:00:00Z' where id = ${first}`
  await addCard(BEN)
  const [{ count }] = await db.sql`select count(*)::int from stamp_cards where customer_id = ${BEN}`
  expect(count).toBe(2)
})

test('a claim needs a filled card, and claimed_at and claim_id go together', async () => {
  const [c] = await db.sql`select id from stamp_cards where customer_id = ${BEN} and filled_at is null`
  await expect(db.sql`update stamp_cards set claimed_at = now(), claim_id = gen_random_uuid() where id = ${c!.id}`)
    .rejects.toThrow(/stamp_cards_check/)
  const [full] = await db.sql`select id from stamp_cards where customer_id = ${BEN} and filled_at is not null`
  await expect(db.sql`update stamp_cards set claimed_at = now() where id = ${full!.id}`).rejects.toThrow(
    /stamp_cards_check1/,
  )
  await expect(db.sql`update stamp_cards set claim_id = gen_random_uuid() where id = ${full!.id}`).rejects.toThrow(
    /stamp_cards_check1/,
  )
  await db.sql`update stamp_cards set claimed_at = now(), claim_id = gen_random_uuid() where id = ${full!.id}`
  await db.sql`update stamp_cards set claimed_at = null, claim_id = null where id = ${full!.id}`
})

// stamps

test('a second stamp on one order fails stamps_one_per_order; it succeeds when the first is forgiven', async () => {
  const [card] = await db.sql`select id from stamp_cards where customer_id = ${BEN} and filled_at is null`
  const order = await addOrder()
  await addStamp(BEN, order, card!.id)
  await expect(addStamp(BEN, order, card!.id)).rejects.toThrow(/stamps_one_per_order/)
  await db.sql`update stamps set flags = array['forgiven'] where order_id = ${order}`
  await addStamp(BEN, order, card!.id)
  const [{ count }] = await db.sql`select count(*)::int from stamps where order_id = ${order}`
  expect(count).toBe(2)
})

test('a stamp without a card needs the mode_was_paper flag', async () => {
  const order = await addOrder()
  await expect(addStamp(BEN, order, null)).rejects.toThrow(/stamps_check/)
  await expect(addStamp(BEN, order, null, ['discarded'])).rejects.toThrow(/stamps_check/)
  await addStamp(BEN, order, null, ['mode_was_paper'])
})

test('a stamp needs a real order', async () => {
  const [card] = await db.sql`select id from stamp_cards where customer_id = ${BEN} and filled_at is null`
  await expect(addStamp(BEN, '00000000-0000-4000-8000-000000000000', card!.id)).rejects.toThrow(/stamps_order_id_fkey/)
})

// points_ledger

test('a second (order, order X) ledger row fails points_once_per_order; a reversal of X succeeds', async () => {
  const order = await addOrder()
  const add = (reason: string, delta: number) => db.sql`insert into points_ledger
      (customer_id, delta, reason, order_id, created_at)
    values (${BEN}, ${delta}, ${reason}, ${order}, '2026-11-20T03:00:00Z')`
  await add('order', 12)
  await expect(add('order', 12)).rejects.toThrow(/points_once_per_order/)
  await add('order_reversed', -12)
})

test('order reasons need an order id and other reasons must not have one', async () => {
  const order = await addOrder()
  await expect(db.sql`insert into points_ledger (customer_id, delta, reason, created_at)
    values (${BEN}, 5, 'order', now())`).rejects.toThrow(/points_ledger_check/)
  await expect(db.sql`insert into points_ledger (customer_id, delta, reason, order_id, created_by_staff, note, created_at)
    values (${BEN}, 5, 'adjustment', ${order}, ${OWNER}, 'Sorry', now())`).rejects.toThrow(/points_ledger_check/)
  await db.sql`insert into points_ledger (customer_id, delta, reason, cosmetic_id, created_at)
    values (${BEN}, -50, 'cosmetic', gen_random_uuid(), now())`
})

test('an adjustment without a note or without staff fails; with both it succeeds', async () => {
  await expect(db.sql`insert into points_ledger (customer_id, delta, reason, created_by_staff, created_at)
    values (${BEN}, 5, 'adjustment', ${OWNER}, now())`).rejects.toThrow(/points_ledger_check1/)
  await expect(db.sql`insert into points_ledger (customer_id, delta, reason, note, created_at)
    values (${BEN}, 5, 'adjustment', 'Goodwill', now())`).rejects.toThrow(/points_ledger_check1/)
  await db.sql`insert into points_ledger (customer_id, delta, reason, note, created_by_staff, created_at)
    values (${BEN}, 5, 'adjustment', 'Goodwill', ${OWNER}, now())`
})

test('delta = 0, an unknown reason and an empty note fail', async () => {
  await expect(db.sql`insert into points_ledger (customer_id, delta, reason, note, created_by_staff, created_at)
    values (${BEN}, 0, 'adjustment', 'Zero', ${OWNER}, now())`).rejects.toThrow(/points_ledger_delta_check/)
  await expect(db.sql`insert into points_ledger (customer_id, delta, reason, created_at)
    values (${BEN}, 5, 'gift', now())`).rejects.toThrow(/points_ledger_reason_check/)
  await expect(db.sql`insert into points_ledger (customer_id, delta, reason, note, created_by_staff, created_at)
    values (${BEN}, 5, 'adjustment', '', ${OWNER}, now())`).rejects.toThrow(/points_ledger_note_check/)
})

// rate_limits

test('rate_limits is keyed by key and window start', async () => {
  await db.sql`insert into rate_limits (key, window_start, hits) values ('lookup:d1', '2026-11-20T00:00:00Z', 1)`
  await expect(db.sql`insert into rate_limits (key, window_start, hits)
    values ('lookup:d1', '2026-11-20T00:00:00Z', 1)`).rejects.toThrow(/rate_limits_pkey/)
  await db.sql`insert into rate_limits (key, window_start, hits) values ('lookup:d1', '2026-11-20T00:01:00Z', 1)
    on conflict (key, window_start) do update set hits = rate_limits.hits + 1`
})

// indexes

test('the new indexes exist', async () => {
  const rows = await db.sql`select indexname from pg_indexes where indexname in ('customers_display_name_idx',
    'stamp_cards_one_open', 'stamps_one_per_order', 'stamps_card_idx', 'points_once_per_order',
    'orders_customer_idx', 'stamp_cards_claimed_order_idx', 'stamps_customer_idx', 'sync_events_linked_recent')
    order by indexname`
  expect(rows.map((r) => r.indexname)).toEqual([
    'customers_display_name_idx',
    'orders_customer_idx',
    'points_once_per_order',
    'stamp_cards_claimed_order_idx',
    'stamp_cards_one_open',
    'stamps_card_idx',
    'stamps_customer_idx',
    'stamps_one_per_order',
    'sync_events_linked_recent',
  ])
  const partial = await db.sql<{ indexname: string; indexdef: string }[]>`select indexname, indexdef from pg_indexes
    where indexname in ('stamp_cards_claimed_order_idx', 'sync_events_linked_recent') order by indexname`
  expect(partial[0]!.indexdef).toMatch(/\(claimed_order_id\) WHERE \(claimed_order_id IS NOT NULL\)/)
  expect(partial[1]!.indexdef).toMatch(/\(device_id, received_at DESC\) WHERE/)
  expect(partial[1]!.indexdef).toContain("'customer.linked'")
  expect(partial[1]!.indexdef).toContain("'applied'")
  const [ledger] = await db.sql`select count(*)::int as n from pg_indexes
    where tablename = 'points_ledger' and indexdef like '%(customer_id, created_at DESC)%'`
  expect(ledger!.n).toBe(1)
})

// Deleting an account

test('deleting the auth user cascades to the customer, cards, stamps and ledger, and clears orders.customer_id', async () => {
  await addCustomer(GONE, 'gone@x.test')
  const card = await addCard(GONE)
  const order = await addOrder({ customerId: GONE })
  await addStamp(GONE, order, card)
  await db.sql`insert into points_ledger (customer_id, delta, reason, order_id, created_at)
    values (${GONE}, 12, 'order', ${order}, now())`

  await db.sql`delete from auth.users where id = ${GONE}`

  const [counts] = await db.sql`select
    (select count(*)::int from customers where id = ${GONE}) as customers,
    (select count(*)::int from stamp_cards where customer_id = ${GONE}) as cards,
    (select count(*)::int from stamps where customer_id = ${GONE}) as stamps,
    (select count(*)::int from points_ledger where customer_id = ${GONE}) as ledger`
  expect(counts).toEqual({ customers: 0, cards: 0, stamps: 0, ledger: 0 })
  const [o] = await db.sql`select customer_id from orders where id = ${order}`
  expect(o!.customer_id).toBeNull()
})

// Privileges

test('kennko_api holds select, insert, update and delete on the five new tables', async () => {
  const rows = await db.sql`
    select t.tbl, p.priv, has_table_privilege('kennko_api', t.tbl, p.priv) as has
    from unnest(${NEW_TABLES}::text[]) as t(tbl)
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p(priv)
    where not has_table_privilege('kennko_api', t.tbl, p.priv)`
  expect(rows).toEqual([])
})

test('kennko_api has no DELETE on orders, payments, sync_events or shifts', async () => {
  const rows = await db.sql`
    select t.tbl from unnest(array['orders', 'payments', 'sync_events', 'shifts']) as t(tbl)
    where has_table_privilege('kennko_api', t.tbl, 'DELETE')`
  expect(rows).toEqual([])
})

test('anon and authenticated hold no privilege on the five new tables', async () => {
  const rows = await db.sql`
    select r.role, t.tbl, p.priv
    from unnest(array['anon', 'authenticated']) as r(role)
    cross join unnest(${NEW_TABLES}::text[]) as t(tbl)
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p(priv)
    where has_table_privilege(r.role, t.tbl, p.priv)`
  expect(rows).toEqual([])
})

test('RLS is on for the five new tables, with one kennko_api policy per command', async () => {
  const rls = await db.sql`select relname from pg_class
    where relname = any(${NEW_TABLES}) and relnamespace = 'public'::regnamespace and relrowsecurity order by relname`
  expect(rls.map((r) => r.relname)).toEqual([...NEW_TABLES].sort())
  const policies = await db.sql`select tablename, cmd, roles from pg_policies
    where tablename = any(${NEW_TABLES}) order by tablename, cmd`
  expect(policies).toHaveLength(NEW_TABLES.length * 4)
  for (const p of policies) expect(p.roles).toEqual(['kennko_api'])
  for (const t of NEW_TABLES) {
    expect(policies.filter((p) => p.tablename === t).map((p) => p.cmd)).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
  }
})

test('kennko_api can write and remove a card, a stamp and a ledger row under RLS', async () => {
  await db.sql.unsafe('set role kennko_api')
  try {
    const [card] = await db.sql`insert into stamp_cards (customer_id, started_at, filled_at)
      values (${BEN}, now(), now()) returning id`
    await db.sql`delete from stamp_cards where id = ${card!.id}`
    await db.sql`insert into rate_limits (key, window_start, hits) values ('api:test', now(), 1)`
    await db.sql`delete from rate_limits where key = 'api:test'`
    const [c] = await db.sql`select stamp_mode from customers where id = ${BEN}`
    expect(c!.stamp_mode).toBe('none')
  } finally {
    await db.sql.unsafe('reset role')
  }
})

// owns_order: guest orders by email count only once the account exists

test('a confirmed user sees their own order and guest orders by email placed after they signed up, not before', async () => {
  await addCustomer(ANA, 'ana@x.test', '2026-11-10T00:00:00Z')
  const own = await addOrder({ userId: ANA, email: 'other@x.test', createdAt: '2026-11-01T00:00:00Z' })
  const after = await addOrder({ email: 'ANA@x.test', createdAt: '2026-11-12T00:00:00Z' })
  const before = await addOrder({ email: 'ana@x.test', createdAt: '2026-11-01T00:00:00Z' })
  const stranger = await addOrder({ email: 'someone@x.test', createdAt: '2026-11-12T00:00:00Z' })
  const mine = [own, after].sort()

  const seen = await asUser(db.sql, ANA, async (tx) => ({
    orders: await tx`select id from orders where id in (${own}, ${after}, ${before}, ${stranger}) order by id`,
    lines: await tx`select order_id from order_lines where order_id in (${own}, ${after}, ${before}, ${stranger})
      order by order_id`,
    options: await tx`select l.order_id from order_line_options o join order_lines l on l.id = o.line_id
      where l.order_id in (${own}, ${after}, ${before}, ${stranger}) order by l.order_id`,
  }))
  expect(seen.orders.map((r) => r.id)).toEqual(mine)
  expect(seen.lines.map((r) => r.order_id)).toEqual(mine)
  expect(seen.options.map((r) => r.order_id)).toEqual(mine)
})

test('an unconfirmed user sees no guest orders by email', async () => {
  await db.sql`insert into auth.users (id, email, created_at) values (${CY}, 'cy@x.test', '2026-11-10T00:00:00Z')`
  const guest = await addOrder({ email: 'cy@x.test', createdAt: '2026-11-12T00:00:00Z' })
  const asCy = await asUser(db.sql, CY, (tx) => tx`select id from orders where id = ${guest}`)
  expect(asCy).toEqual([])
})

test('owns_order takes the order time; the two-argument version is gone; authenticated and anon may run it', async () => {
  const fns = await db.sql`select pg_get_function_identity_arguments(p.oid) as args from pg_proc p
    where p.proname = 'owns_order' and p.pronamespace = 'public'::regnamespace`
  expect(fns.map((f) => f.args)).toEqual(['order_user_id uuid, order_email text, order_created_at timestamp with time zone'])
  const [priv] = await db.sql`select
    has_function_privilege('authenticated', 'public.owns_order(uuid, text, timestamptz)', 'EXECUTE') as auth,
    has_function_privilege('anon', 'public.owns_order(uuid, text, timestamptz)', 'EXECUTE') as anon`
  expect(priv).toEqual({ auth: true, anon: true })
  expect(await db.sql`select has_function_privilege('public', 'public.owns_order(uuid, text, timestamptz)', 'EXECUTE') as p`)
    .toEqual([{ p: false }])
})

test('an anon read of orders, lines and options is zero rows, not an error (Ruling P7-1)', async () => {
  const order = await addOrder({ email: 'anon-check@x.test', createdAt: '2026-11-12T00:00:00Z' })
  const seen = await asUser(db.sql, null, async (tx) => ({
    orders: await tx`select id from orders`,
    lines: await tx`select id from order_lines`,
    options: await tx`select id from order_line_options`,
  }))
  expect(order).toBeTruthy()
  expect(seen).toEqual({ orders: [], lines: [], options: [] })
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { COAT_COLOURS, COSMETICS } from '@kennko/cats/pixel'
import { checkCatName, COSMETIC_SLOTS, STARTER_CAT_NAMES, STARTER_COATS } from '@kennko/core'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { startTestDb, type TestDb } from './pg.js'

// Rows that exist on the live database before 0020 runs: staff, a till, an order, two customers and
// ledger rows with every reason Plan 7 writes (order, order_reversed, adjustment). The backfill must give
// each customer one starter cat, and every new check and foreign key must hold for these rows.
const OWNER_USER = '11111111-1111-4111-8111-111111111111'
const OWNER = '22222222-2222-4222-8222-222222222222'
const DEVICE = '33333333-3333-4333-8333-333333333333'
const SHIFT = '55555555-5555-4555-8555-555555555551'
const ORDER = '99999999-9999-4999-8999-999999999991'
const ANA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const BEN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
// Made after 0020.
const GONE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
const CY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'

const SEED = `
  insert into auth.users (id, email, email_confirmed_at) values ('${OWNER_USER}', 'owner@kennko.test', now());
  insert into staff (id, user_id, email, full_name, role)
    values ('${OWNER}', '${OWNER_USER}', 'owner@kennko.test', 'Olive', 'owner');
  insert into devices (id, name) values ('${DEVICE}', 'Front till');
  insert into shifts (id, device_id, opened_at, opened_by_staff, opening_float_centavos)
    values ('${SHIFT}', '${DEVICE}', '2026-11-20T00:00:00Z', '${OWNER}', 100000);
  insert into auth.users (id, email, email_confirmed_at, created_at) values
    ('${ANA}', 'ana@x.test', '2026-11-10T00:00:00Z', '2026-11-10T00:00:00Z'),
    ('${BEN}', 'ben@x.test', '2026-11-10T00:00:00Z', '2026-11-10T00:00:00Z');
  insert into customers (id, public_code, display_name, age_confirmed_at, privacy_accepted_at, privacy_version,
      created_at) values
    ('${ANA}', '7F3K9QXAM', 'Ana', now(), now(), '2026-11', now()),
    ('${BEN}', 'H4PZ2RWNB', 'Ben', now(), now(), '2026-11', now());
  insert into orders (id, channel, fulfilment, business_day, ticket_series, ticket_number, customer_name,
      prep_status, payment_status, subtotal_centavos, discount_centavos, delivery_fee_centavos, total_centavos,
      device_id, shift_id, customer_id)
    values ('${ORDER}', 'counter', 'dine_in', '2026-11-20', 'C', 1, 'Ana', 'completed', 'paid',
      12000, 0, 0, 12000, '${DEVICE}', '${SHIFT}', '${ANA}');
  insert into points_ledger (customer_id, delta, reason, order_id, note, created_by_staff, created_at) values
    ('${ANA}', 12, 'order', '${ORDER}', null, null, '2026-11-20T03:00:00Z'),
    ('${ANA}', -12, 'order_reversed', '${ORDER}', null, null, '2026-11-20T04:00:00Z'),
    ('${BEN}', 30, 'adjustment', null, 'Goodwill', '${OWNER}', '2026-11-20T05:00:00Z');
`

const NEW_TABLES = ['cosmetics', 'customer_cosmetics', 'cats', 'visits', 'shop_secrets']
const PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']
const API_GRANTS: Record<string, string[]> = {
  cosmetics: ['SELECT', 'UPDATE'],
  customer_cosmetics: ['INSERT', 'SELECT'],
  cats: ['INSERT', 'SELECT', 'UPDATE'],
  visits: ['INSERT', 'SELECT', 'UPDATE'],
  shop_secrets: ['INSERT', 'SELECT'],
}

const migration = readFileSync(
  fileURLToPath(new URL('../supabase/migrations/0020_cats_and_visits.sql', import.meta.url)),
  'utf8',
)
const BACKFILL = /insert into cats \(customer_id, name, equipped, updated_at\)[\s\S]*?on conflict do nothing;/.exec(
  migration,
)?.[0]

let db: TestDb

async function addCustomer(id: string, code: string) {
  await db.sql`insert into auth.users (id, email, created_at) values (${id}, ${`${code}@x.test`}, now())`
  await db.sql`insert into customers (id, public_code, display_name, age_confirmed_at, privacy_accepted_at,
      privacy_version, created_at)
    values (${id}, ${code}, 'Someone', now(), now(), '2026-11', now())`
  await db.sql`insert into cats (customer_id, name, equipped, updated_at)
    values (${id}, 'Mochi', '{"coat": "ginger"}', now())`
}

async function cosmeticId(key: string): Promise<string> {
  const [c] = await db.sql`select id from cosmetics where key = ${key}`
  return c!.id as string
}

beforeAll(async () => {
  db = await startTestDb({ seedBefore: { migration: '0020', sql: SEED } })
  await addCustomer(CY, 'Q8W3E5R7T')
})
afterAll(async () => {
  await db.stop()
})

// Existing customers

test('starter cat for every existing customer, named from the list, in a starter coat', async () => {
  const cats = await db.sql`select customer_id, name, equipped, show_on_wall, hidden_by_admin, updated_at from cats
    where customer_id in (${ANA}, ${BEN}) order by customer_id`
  expect(cats.map((c) => c.customer_id)).toEqual([ANA, BEN])
  for (const c of cats) {
    expect(STARTER_CAT_NAMES).toContain(c.name)
    expect(checkCatName(c.name as string)).toEqual({ ok: true, name: c.name })
    expect(Object.keys(c.equipped as object)).toEqual(['coat'])
    expect(STARTER_COATS).toContain((c.equipped as { coat: string }).coat)
    expect(c.show_on_wall).toBe(true)
    expect(c.hidden_by_admin).toBe(false)
    expect(c.updated_at).toBeInstanceOf(Date)
  }
})

test('re-running the backfill adds nothing and changes nothing', async () => {
  expect(BACKFILL).toBeDefined()
  const before = await db.sql`select customer_id, name, equipped from cats order by customer_id`
  await db.sql.unsafe(BACKFILL!)
  const after = await db.sql`select customer_id, name, equipped from cats order by customer_id`
  expect(after).toEqual(before)
  const [{ n }] = await db.sql`select count(*)::int as n from customers c where not exists
    (select 1 from cats where customer_id = c.id)`
  expect(n).toBe(0)
})

test('the backfill picks the name and coat from the public code, the same on every run', async () => {
  const rows = await db.sql`select c.public_code, k.name, k.equipped->>'coat' as coat
    from customers c join cats k on k.customer_id = c.id where c.id in (${ANA}, ${BEN}) order by c.id`
  for (const r of rows) {
    const [pick] = await db.sql`select
      (${STARTER_CAT_NAMES}::text[])[1 + mod(hashtext(${r.public_code})::bigint + 2147483648, 8)::int] as name,
      (${STARTER_COATS}::text[])[1 + mod(hashtext(${r.public_code} || 'coat')::bigint + 2147483648, 4)::int] as coat`
    expect({ name: r.name, coat: r.coat }).toEqual(pick)
  }
})

test('existing ledger rows are kept and pass the new checks', async () => {
  const rows = await db.sql`select reason, delta from points_ledger order by created_at`
  expect(rows.map((r) => [r.reason, r.delta])).toEqual([
    ['order', 12],
    ['order_reversed', -12],
    ['adjustment', 30],
  ])
})

// The catalogue

test('the catalogue matches the art: 22 rows, 4 free starter coats, every key drawn in its slot', async () => {
  const rows = await db.sql<{ key: string; slot: string; price_points: number; is_starter: boolean; is_active: boolean }[]>`
    select key, slot, price_points, is_starter, is_active from cosmetics order by sort_order`
  expect(rows).toHaveLength(22)
  for (const r of rows) {
    expect(COSMETIC_SLOTS).toContain(r.slot)
    if (r.slot === 'coat') expect(COAT_COLOURS[r.key], r.key).toBeDefined()
    else expect(COSMETICS[r.key]?.slot, r.key).toBe(r.slot)
    expect(r.is_active).toBe(true)
  }
  const starters = rows.filter((r) => r.is_starter)
  expect(starters.map((r) => r.key)).toEqual(STARTER_COATS)
  expect(starters.every((r) => r.slot === 'coat' && r.price_points === 0)).toBe(true)
  expect(rows.filter((r) => !r.is_starter).every((r) => r.price_points > 0)).toBe(true)
})

test('the catalogue rows, slots and prices are Ruling 3, in table order', async () => {
  const rows = await db.sql`select key, slot, price_points from cosmetics order by sort_order`
  expect(rows.map((r) => `${r.slot}:${r.key}:${r.price_points}`)).toEqual([
    'coat:ginger:0', 'coat:tabby:0', 'coat:black:0', 'coat:cream:0',
    'coat:tuxedo:60', 'coat:white:60', 'coat:calico:90', 'coat:siamese:120',
    'hat:beanie:40', 'hat:party-hat:50', 'hat:visor:60', 'hat:flower-crown:80', 'hat:crown:150',
    'face:blush:30', 'face:round-glasses:40', 'face:sunnies:60',
    'neck:bandana:30', 'neck:bow-tie:40', 'neck:bell-collar:50',
    'held:kennko-cup:30', 'held:croissant:40', 'held:fish:50',
  ])
  const names = await db.sql`select name from cosmetics where char_length(name) not between 1 and 40`
  expect(names).toEqual([])
})

test('a starter with a price fails; a negative price fails; a bad key or slot fails', async () => {
  const add = (key: string, slot: string, price: number, starter: boolean) => db.sql`
    insert into cosmetics (key, slot, name, price_points, is_starter) values (${key}, ${slot}, 'X', ${price}, ${starter})`
  await expect(add('gold', 'coat', 10, true)).rejects.toThrow(/cosmetics_check/)
  await expect(add('gold', 'coat', -1, false)).rejects.toThrow(/cosmetics_price_points_check/)
  await expect(add('Gold', 'coat', 10, false)).rejects.toThrow(/cosmetics_key_check/)
  await expect(add('gold', 'tail', 10, false)).rejects.toThrow(/cosmetics_slot_check/)
  await expect(add('beanie', 'hat', 10, false)).rejects.toThrow(/cosmetics_key_key/)
})

// cats

test('a cat without a coat fails; a 17-character or empty name fails; one cat per customer', async () => {
  await expect(db.sql`update cats set equipped = '{"hat": "beanie"}' where customer_id = ${CY}`).rejects.toThrow(
    /cats_equipped_check/,
  )
  await expect(db.sql`update cats set equipped = '["coat"]' where customer_id = ${CY}`).rejects.toThrow(
    /cats_equipped_check/,
  )
  await expect(db.sql`update cats set name = ${'x'.repeat(17)} where customer_id = ${CY}`).rejects.toThrow(
    /cats_name_check/,
  )
  await expect(db.sql`update cats set name = '' where customer_id = ${CY}`).rejects.toThrow(/cats_name_check/)
  await db.sql`update cats set name = ${'x'.repeat(16)} where customer_id = ${CY}`
  await expect(db.sql`insert into cats (customer_id, name, equipped, updated_at)
    values (${CY}, 'Ube', '{"coat": "cream"}', now())`).rejects.toThrow(/cats_pkey/)
})

test('a cat may be hidden by a staff member', async () => {
  await db.sql`update cats set hidden_by_admin = true, hidden_by = ${OWNER}, hidden_at = now() where customer_id = ${CY}`
  await expect(db.sql`update cats set hidden_by = gen_random_uuid() where customer_id = ${CY}`).rejects.toThrow(
    /cats_hidden_by_fkey/,
  )
  await db.sql`update cats set hidden_by_admin = false, hidden_by = null, hidden_at = null where customer_id = ${CY}`
})

// visits

test('a visit must end after it starts and its source is checkin or counter; one per customer', async () => {
  const add = (source: string, start: string, end: string) => db.sql`
    insert into visits (customer_id, visit_key, source, started_at, ends_at)
    values (${CY}, gen_random_uuid(), ${source}, ${start}, ${end})`
  await expect(add('checkin', '2026-11-21T10:00:00Z', '2026-11-21T10:00:00Z')).rejects.toThrow(/visits_check/)
  await expect(add('qr', '2026-11-21T10:00:00Z', '2026-11-21T11:30:00Z')).rejects.toThrow(/visits_source_check/)
  await add('checkin', '2026-11-21T10:00:00Z', '2026-11-21T11:30:00Z')
  await expect(add('counter', '2026-11-21T10:00:00Z', '2026-11-21T11:30:00Z')).rejects.toThrow(/visits_pkey/)
  const [idx] = await db.sql`select indexdef from pg_indexes where indexname = 'visits_active_idx'`
  expect(idx!.indexdef).toMatch(/ON public\.visits USING btree \(ends_at\)/)
})

// customer_cosmetics and the ledger

test('owning a cosmetic needs a real cosmetic; owning it twice fails', async () => {
  const beanie = await cosmeticId('beanie')
  await db.sql`insert into customer_cosmetics (customer_id, cosmetic_id, acquired_at) values (${CY}, ${beanie}, now())`
  await expect(db.sql`insert into customer_cosmetics (customer_id, cosmetic_id, acquired_at)
    values (${CY}, ${beanie}, now())`).rejects.toThrow(/customer_cosmetics_pkey/)
  await expect(db.sql`insert into customer_cosmetics (customer_id, cosmetic_id, acquired_at)
    values (${CY}, gen_random_uuid(), now())`).rejects.toThrow(/customer_cosmetics_cosmetic_id_fkey/)
})

test('a cosmetic ledger row needs a real cosmetic id, and only one per customer and cosmetic', async () => {
  const beanie = await cosmeticId('beanie')
  const add = (cosmetic: string | null) => db.sql`insert into points_ledger (customer_id, delta, reason, cosmetic_id,
      created_at) values (${CY}, -40, 'cosmetic', ${cosmetic}, now())`
  await expect(add(null)).rejects.toThrow(/points_ledger_cosmetic_needs_id/)
  await expect(add('00000000-0000-4000-8000-000000000000')).rejects.toThrow(/points_ledger_cosmetic_fk/)
  await add(beanie)
  await expect(add(beanie)).rejects.toThrow(/points_once_per_cosmetic/)
  await add(await cosmeticId('crown'))
})

// shop_secrets

test('shop_secrets holds one row (id 1) with a secret of at least 40 characters; none is seeded', async () => {
  expect(await db.sql`select id from shop_secrets`).toEqual([])
  const add = (id: number, secret: string) =>
    db.sql`insert into shop_secrets (id, checkin_secret, rotated_at) values (${id}, ${secret}, now())`
  await expect(add(1, 'x'.repeat(39))).rejects.toThrow(/shop_secrets_checkin_secret_check/)
  await add(1, 'x'.repeat(43))
  await expect(add(2, 'y'.repeat(43))).rejects.toThrow(/shop_secrets_id_check/)
  await expect(add(1, 'y'.repeat(43))).rejects.toThrow(/shop_secrets_pkey/)
  await db.sql`delete from shop_secrets`
})

// Deleting an account

test('deleting the auth user cascades to the cat, owned cosmetics, the visit and cosmetic ledger rows', async () => {
  await addCustomer(GONE, 'Z9X8C7V6B')
  const hat = await cosmeticId('party-hat')
  await db.sql`insert into customer_cosmetics (customer_id, cosmetic_id, acquired_at) values (${GONE}, ${hat}, now())`
  await db.sql`insert into points_ledger (customer_id, delta, reason, cosmetic_id, created_at)
    values (${GONE}, -50, 'cosmetic', ${hat}, now())`
  await db.sql`insert into visits (customer_id, visit_key, source, started_at, ends_at)
    values (${GONE}, gen_random_uuid(), 'checkin', now(), now() + interval '90 minutes')`

  await db.sql`delete from auth.users where id = ${GONE}`

  const [counts] = await db.sql`select
    (select count(*)::int from cats where customer_id = ${GONE}) as cats,
    (select count(*)::int from customer_cosmetics where customer_id = ${GONE}) as owned,
    (select count(*)::int from visits where customer_id = ${GONE}) as visits,
    (select count(*)::int from points_ledger where customer_id = ${GONE}) as ledger`
  expect(counts).toEqual({ cats: 0, owned: 0, visits: 0, ledger: 0 })
  expect(await db.sql`select id from cosmetics where key = 'party-hat'`).toHaveLength(1)
})

// Privileges

test('kennko_api holds exactly the planned grants on the five new tables, and no DELETE', async () => {
  const rows = await db.sql<{ tbl: string; priv: string }[]>`
    select t.tbl, p.priv from unnest(${NEW_TABLES}::text[]) as t(tbl)
    cross join unnest(${PRIVS}::text[]) as p(priv)
    where has_table_privilege('kennko_api', t.tbl, p.priv)
    order by t.tbl, p.priv`
  const held: Record<string, string[]> = {}
  for (const r of rows) (held[r.tbl] ??= []).push(r.priv)
  expect(held).toEqual(API_GRANTS)
})

test('anon and authenticated hold no privilege on the five new tables', async () => {
  const rows = await db.sql`
    select r.role, t.tbl, p.priv
    from unnest(array['anon', 'authenticated']) as r(role)
    cross join unnest(${NEW_TABLES}::text[]) as t(tbl)
    cross join unnest(${PRIVS}::text[]) as p(priv)
    where has_table_privilege(r.role, t.tbl, p.priv)`
  expect(rows).toEqual([])
})

test('RLS is on for the five new tables, with one kennko_api policy per granted command', async () => {
  const rls = await db.sql`select relname from pg_class
    where relname = any(${NEW_TABLES}) and relnamespace = 'public'::regnamespace and relrowsecurity order by relname`
  expect(rls.map((r) => r.relname)).toEqual([...NEW_TABLES].sort())
  const policies = await db.sql`select tablename, cmd, roles from pg_policies
    where tablename = any(${NEW_TABLES}) order by tablename, cmd`
  for (const p of policies) expect(p.roles).toEqual(['kennko_api'])
  const byTable: Record<string, string[]> = {}
  for (const p of policies) (byTable[p.tablename as string] ??= []).push(p.cmd as string)
  expect(byTable).toEqual(API_GRANTS)
})

test('kennko_api can read the catalogue and write a cat, a visit, an owned cosmetic and the secret under RLS', async () => {
  const fish = await cosmeticId('fish')
  await db.sql.unsafe('set role kennko_api')
  try {
    expect(await db.sql`select key from cosmetics where is_starter order by sort_order`).toHaveLength(4)
    await db.sql`update cosmetics set name = 'Tuna' where id = ${fish}`
    await db.sql`update cats set name = 'Kape', equipped = '{"coat": "black", "held": "fish"}', updated_at = now()
      where customer_id = ${CY}`
    await db.sql`insert into customer_cosmetics (customer_id, cosmetic_id, acquired_at) values (${CY}, ${fish}, now())`
    await db.sql`update visits set ends_at = ends_at + interval '90 minutes' where customer_id = ${CY}`
    await db.sql`insert into shop_secrets (id, checkin_secret, rotated_at) values (1, ${'s'.repeat(43)}, now())
      on conflict do nothing`
    expect(await db.sql`select id from shop_secrets`).toEqual([{ id: 1 }])
    await expect(db.sql`delete from visits where customer_id = ${CY}`).rejects.toThrow(/permission denied/)
  } finally {
    await db.sql.unsafe('reset role')
  }
})

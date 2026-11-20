import { afterAll, beforeAll, expect, test } from 'vitest'
import { asUser, startTestDb, type TestDb } from './pg.js'

// Today's shape, loaded before 0012 runs.
const SEED = `
insert into menu_categories (id, name) values ('00000000-0000-4000-8000-0000000000c1', 'Coffee');
insert into menu_items (id, category_id, name) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000c1', 'Americano');
insert into menu_item_prices (menu_item_id, size, price_centavos) values
  ('00000000-0000-4000-8000-0000000000a1', 'M', 8000),
  ('00000000-0000-4000-8000-0000000000a1', 'L', 9000),
  ('00000000-0000-4000-8000-0000000000a1', 'XL', 10000),
  ('00000000-0000-4000-8000-0000000000a1', 'HOT', 9500);
insert into modifier_groups (id, name, is_multi_select, sort_order) values
  ('00000000-0000-4000-8000-0000000000d1', 'Milk', false, 0),
  ('00000000-0000-4000-8000-0000000000d2', 'Sweetness', false, 1),
  ('00000000-0000-4000-8000-0000000000d3', 'Add-ons', true, 2);
insert into modifiers (id, group_id, name, price_centavos, sort_order) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000d1', 'Oat milk', 2000, 0),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000d2', 'Less sweet', 0, 0),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000d3', 'Extra shot', 3000, 0),
  ('00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000d3', 'Syrup', 1500, 1);
`

const ITEM = '00000000-0000-4000-8000-0000000000a1'
const BARISTA = '22222222-2222-4222-8222-222222222222'

let db: TestDb
beforeAll(async () => {
  db = await startTestDb({ seedBefore: { migration: '0012', sql: SEED } })
  await db.sql`insert into auth.users (id, email) values (${BARISTA}, 'b@kennko.test')`
  await db.sql`insert into staff (id, user_id, email, full_name, role) values (${BARISTA}, ${BARISTA}, 'b@kennko.test', 'Bea', 'barista')`
})
afterAll(async () => {
  await db.stop()
})

test('backfills a variant per old price', async () => {
  const rows = await db.sql`select code, label, temperature, price_centavos from menu_variants
    where item_id = ${ITEM} order by sort_order`
  expect(rows.map((r) => [r.code, r.label, r.temperature, r.price_centavos])).toEqual([
    ['M', 'Medium', 'iced', 8000],
    ['L', 'Large', 'iced', 9000],
    ['XL', 'XL', 'iced', 10000],
    ['HOT', 'Hot', 'hot', 9500],
  ])
})

test('keeps modifier ids as option ids', async () => {
  const ids = ['b1', 'b2', 'b3', 'b4'].map((s) => `00000000-0000-4000-8000-0000000000${s}`)
  const found = await db.sql`select id from options where id in ${db.sql(ids)}`
  expect(found).toHaveLength(4)
  const groups = await db.sql`select name, min_select, max_select from option_groups
    where name in ('Milk', 'Sweetness', 'Add-ons') order by name`
  expect(groups.map((g) => [g.name, g.min_select, g.max_select])).toEqual([
    ['Add-ons', 0, 5],
    ['Milk', 0, 1],
    ['Sweetness', 0, 1],
  ])
})

test('attaches every option group to every drink item', async () => {
  const rows = await db.sql`select g.name from item_option_groups l
    join option_groups g on g.id = l.group_id where l.item_id = ${ITEM} order by g.name`
  expect(rows.map((r) => r.name)).toEqual(['Add-ons', 'Milk', 'Sweetness'])
})

test('seeds food', async () => {
  const [cat] = await db.sql`select id, kind from menu_categories where name = 'Food'`
  expect(cat.kind).toBe('food')
  const items = await db.sql`select i.id, i.name, i.description, v.code, v.price_centavos, v.temperature
    from menu_items i join menu_variants v on v.item_id = i.id
    where i.category_id = ${cat.id} order by i.name`
  expect(items.map((r) => [r.name, r.description, r.code, r.price_centavos, r.temperature])).toEqual([
    ['Cookies', null, 'REG', 6000, 'none'],
    ['Empanada', 'Chicken', 'REG', 4500, 'none'],
    ['Fries', null, 'REG', 8500, 'none'],
  ])
  const groupsFor = async (name: string) =>
    db.sql`select g.name, g.min_select, g.max_select,
        (select array_agg(o.name order by o.sort_order) from options o where o.group_id = g.id) as opts
      from item_option_groups l
      join option_groups g on g.id = l.group_id
      join menu_items i on i.id = l.item_id
      where i.name = ${name} and i.category_id = ${cat.id}`
  const cookies = await groupsFor('Cookies')
  expect(cookies.map((g) => [g.name, g.min_select, g.max_select, g.opts])).toEqual([
    ['Cookie flavour', 1, 1, ['Original', 'Chocolate', 'Red Velvet']],
  ])
  expect(await groupsFor('Empanada')).toEqual([])
  const fries = await groupsFor('Fries')
  expect(fries.map((g) => [g.name, g.min_select, g.max_select, g.opts])).toEqual([
    ['Fries flavour', 1, 1, ['Original', 'Cheese', 'BBQ', 'Sour Cream']],
  ])
  const [{ paid }] = await db.sql`select count(*)::int as paid from options o
    join option_groups g on g.id = o.group_id
    where g.name in ('Cookie flavour', 'Fries flavour') and o.price_centavos <> 0`
  expect(paid).toBe(0)
})

test('seeds discount presets', async () => {
  const rows = await db.sql`select label, kind, value from discount_presets order by sort_order`
  expect(rows.map((r) => [r.label, r.kind, r.value])).toEqual([
    ['Senior / PWD 20%', 'percent', 20],
    ['Promo 10%', 'percent', 10],
  ])
})

test('order line options point at options (order_item_modifiers.modifier_id, renamed by 0014)', async () => {
  const [opt] = await db.sql`insert into options (group_id, name, price_centavos)
    select id, 'Brand new', 0 from option_groups where name = 'Milk' returning id`
  const [order] = await db.sql`insert into orders (order_code, customer_name, customer_phone, customer_email,
      fulfilment, fulfil_at, subtotal_centavos, total_centavos, business_day, ticket_series, ticket_number,
      prep_status, payment_status)
    values ('T-1', 'A', '1', 'a@b.c', 'pickup', now(), 0, 0, '2026-11-20', 'W', 1, 'placed', 'pending_verification')
    returning id`
  const [line] = await db.sql`insert into order_lines (order_id, item_name, variant_code, variant_label,
      unit_price_centavos, quantity, line_total_centavos)
    values (${order.id}, 'Americano', 'HOT', 'Hot', 8000, 1, 8000) returning id`
  await db.sql`insert into order_line_options (line_id, option_id, group_name, option_name, price_centavos)
    values (${line.id}, ${opt.id}, 'Milk', 'Brand new', 0)`
  const [fk] = await db.sql`select confrelid::regclass::text as target from pg_constraint
    where conrelid = 'order_line_options'::regclass and contype = 'f'
      and conkey = array[(select attnum from pg_attribute
        where attrelid = 'order_line_options'::regclass and attname = 'option_id')]::int2[]`
  expect(fk.target).toBe('options')
})

test('stamps availability_changed_at when is_available changes', async () => {
  const [variant] = await db.sql`select id from menu_variants where item_id = ${ITEM} and code = 'M'`
  const [option] = await db.sql`select id from options where name = 'Syrup'`
  const checks: [string, string, string][] = [
    ['menu_items', ITEM, 'id'],
    ['menu_variants', variant.id, 'id'],
    ['options', option.id, 'id'],
  ]
  for (const [table, id] of checks) {
    const [before] = await db.sql`select availability_changed_at as at from ${db.sql(table)} where id = ${id}`
    expect(before.at).toBeNull()
    await db.sql`update ${db.sql(table)} set is_available = false where id = ${id}`
    const [after] = await db.sql`select availability_changed_at as at, is_available from ${db.sql(table)} where id = ${id}`
    expect(after.is_available).toBe(false)
    expect(after.at).toBeInstanceOf(Date)
  }
})

test('anon reads live variants only', async () => {
  const [cat] = await db.sql`select id from menu_categories where name = 'Coffee'`
  const [archivedItem] = await db.sql`insert into menu_items (category_id, name, is_archived)
    values (${cat.id}, 'Old Brew', true) returning id`
  await db.sql`insert into menu_variants (item_id, code, label, price_centavos, temperature)
    values (${archivedItem.id}, 'M', 'Medium', 100, 'iced')`
  await db.sql`update menu_variants set is_archived = true where item_id = ${ITEM} and code = 'XL'`
  const rows = await asUser(db.sql, null, (tx) =>
    tx`select i.name, v.code from menu_variants v join menu_items i on i.id = v.item_id
       where i.name in ('Americano', 'Old Brew') order by v.sort_order`,
  )
  expect(rows.map((r) => `${r.name}:${r.code}`)).toEqual(['Americano:M', 'Americano:L', 'Americano:HOT'])
})

test('a barista may change only is_available on variants and options', async () => {
  const [variant] = await db.sql`select id from menu_variants where item_id = ${ITEM} and code = 'L'`
  const [option] = await db.sql`select id from options where name = 'Oat milk'`
  await asUser(db.sql, BARISTA, async (tx) => {
    await tx`update menu_variants set is_available = false where id = ${variant.id}`
    await tx`update options set is_available = false where id = ${option.id}`
  })
  const expect42501 = async (fn: (tx: import('postgres').TransactionSql) => Promise<unknown>) => {
    await expect(asUser(db.sql, BARISTA, fn)).rejects.toMatchObject({ code: '42501' })
  }
  await expect42501((tx) => tx`update menu_variants set price_centavos = 1 where id = ${variant.id}`)
  await expect42501((tx) => tx`update options set price_centavos = 1 where id = ${option.id}`)
})

test('kennko_api can insert a snapshot and cannot update menu_items', async () => {
  const run = async <T>(fn: (tx: import('postgres').TransactionSql) => Promise<T>) =>
    (await db.sql.begin(async (tx) => {
      await tx.unsafe('set local role kennko_api')
      return fn(tx)
    })) as T
  await run((tx) => tx`insert into menu_snapshots (version, body, body_hash) values (1, '{}'::jsonb, 'h')`)
  await run((tx) => tx`insert into menu_snapshots (version, body, body_hash) values (2, '{}'::jsonb, 'h')`)
  const items = await run((tx) => tx`select count(*)::int as n from menu_items`)
  expect(items[0].n).toBeGreaterThan(0)
  await expect(run((tx) => tx`update menu_items set name = 'x'`)).rejects.toMatchObject({ code: '42501' })
  await expect(run((tx) => tx`update menu_snapshots set body_hash = 'z'`)).rejects.toMatchObject({ code: '42501' })
  await expect(run((tx) => tx`delete from menu_publish_lock`)).rejects.toMatchObject({ code: '42501' })
  await run((tx) => tx`update menu_publish_lock set id = true`)
})

test('trusted server sessions (no JWT) are not restricted by the guards', async () => {
  const [variant] = await db.sql`select id from menu_variants where item_id = ${ITEM} and code = 'M'`
  await db.sql`update menu_variants set price_centavos = 8100 where id = ${variant.id}`
  const [row] = await db.sql`select price_centavos from menu_variants where id = ${variant.id}`
  expect(row.price_centavos).toBe(8100)
  await db.sql`update menu_variants set price_centavos = 8000 where id = ${variant.id}`
})

test('an explicit anon JWT cannot change a variant', async () => {
  const [variant] = await db.sql`select id from menu_variants where item_id = ${ITEM} and code = 'M'`
  const rows = await asUser(db.sql, null, (tx) =>
    tx`update menu_variants set price_centavos = 1 where id = ${variant.id} returning id`,
  )
  expect(rows).toHaveLength(0)
  const [row] = await db.sql`select price_centavos from menu_variants where id = ${variant.id}`
  expect(row.price_centavos).toBe(8000)
})

test('after 0013 the legacy menu tables are gone and every price lives on menu_variants', async () => {
  const gone = await db.sql`select to_regclass('public.menu_item_prices') as p,
    to_regclass('public.modifiers') as m, to_regclass('public.modifier_groups') as g`
  expect(gone[0]).toEqual({ p: null, m: null, g: null })
  const rows = await db.sql`select code, price_centavos from menu_variants
    where item_id = ${ITEM} order by sort_order`
  expect(rows.map((r) => [r.code, r.price_centavos])).toEqual([
    ['M', 8000],
    ['L', 9000],
    ['XL', 10000],
    ['HOT', 9500],
  ])
  // 0014 drops drink_size once order_items.size becomes order_lines.variant_code.
  const [{ n }] = await db.sql`select count(*)::int as n from pg_type where typname = 'drink_size'`
  expect(n).toBe(0)
  const policies = await db.sql`select policyname from pg_policies
    where tablename in ('menu_item_prices', 'modifiers', 'modifier_groups')`
  expect(policies).toHaveLength(0)
})

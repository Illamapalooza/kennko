import postgres from 'postgres'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { buildSnapshotBody, hashBody, publishMenu } from '../src/menu/snapshot.js'
import { startTestDb, type TestDb } from './pg.js'

let db: TestDb
let itemId: string
let variantId: string

beforeAll(async () => {
  db = await startTestDb()
  const [cat] = await db.sql`insert into menu_categories (name, sort_order) values ('Coffee', 0) returning id`
  const [item] = await db.sql`insert into menu_items (category_id, name) values (${cat!.id}, 'Americano') returning id`
  itemId = item!.id
  const [v] = await db.sql`insert into menu_variants (item_id, code, label, price_centavos, temperature)
    values (${itemId}, 'M', 'Medium', 8000, 'iced') returning id`
  variantId = v!.id
})
afterAll(async () => {
  await db.stop()
})

const setPrice = (p: number) => db.sql`update menu_variants set price_centavos = ${p} where id = ${variantId}`
const snapshot = async (version: number) =>
  (await db.sql`select body, body_hash from menu_snapshots where version = ${version}`)[0]!

test('first publish creates version 1', async () => {
  expect(await publishMenu(db.sql, null)).toEqual({ version: 1, created: true })
  const body = (await snapshot(1)).body
  const coffee = body.categories.find((c: { name: string }) => c.name === 'Coffee')
  expect(coffee.items[0].variants[0]).toMatchObject({ code: 'M', priceCentavos: 8000, isAvailable: true })
  expect(body.categories.map((c: { name: string }) => c.name)).toContain('Food')
  expect(body.discountPresets).toHaveLength(2)
})

test('publishing an unchanged menu creates nothing', async () => {
  expect(await publishMenu(db.sql, null)).toEqual({ version: 1, created: false })
  const [{ n }] = await db.sql`select count(*)::int as n from menu_snapshots`
  expect(n).toBe(1)
})

test('a price change creates version 2 and version 1 is unchanged', async () => {
  const before = await snapshot(1)
  await setPrice(9000)
  expect(await publishMenu(db.sql, null)).toEqual({ version: 2, created: true })
  expect(await snapshot(1)).toEqual(before)
  expect((await snapshot(2)).body_hash).not.toBe(before.body_hash)
})

test('an edit back to an earlier state creates a new version', async () => {
  await setPrice(8000)
  expect(await publishMenu(db.sql, null)).toEqual({ version: 3, created: true })
  expect((await snapshot(3)).body_hash).toBe((await snapshot(1)).body_hash)
})

test('archived items and inactive categories are left out, and older versions still hold them', async () => {
  const [cat] = await db.sql`insert into menu_categories (name, sort_order) values ('Seasonal', 9) returning id`
  await db.sql`insert into menu_items (category_id, name) values (${cat!.id}, 'Pumpkin')`
  const names = (body: { categories: { name: string }[] }) => body.categories.map((c) => c.name)
  expect((await publishMenu(db.sql, null)).version).toBe(4)
  expect(names((await snapshot(4)).body)).toContain('Seasonal')

  await db.sql`update menu_categories set is_active = false where id = ${cat!.id}`
  await db.sql`update menu_items set is_archived = true where id = ${itemId}`
  expect(await publishMenu(db.sql, null)).toEqual({ version: 5, created: true })
  const v5 = (await snapshot(5)).body
  expect(names(v5)).not.toContain('Seasonal')
  const coffee = v5.categories.find((c: { name: string }) => c.name === 'Coffee')
  expect(coffee?.items ?? []).toHaveLength(0)
  expect(names((await snapshot(4)).body)).toContain('Seasonal')
  expect(JSON.stringify((await snapshot(3)).body)).toContain('Americano')
  await db.sql`update menu_items set is_archived = false where id = ${itemId}`
})

// PGlite runs every socket connection in one backend session, so both clients share a transaction
// and this cannot prove the row lock works (it also passes with the lock removed). It does check
// the concurrent path returns one version. Real lock behaviour needs a real Postgres.
test('two publishes at the same time make one version', async () => {
  const [{ max }] = await db.sql`select max(version)::int as max from menu_snapshots`
  await setPrice(7500)
  const other = postgres(db.url, { max: 1, prepare: false, onnotice: () => {} })
  try {
    const results = await Promise.all([publishMenu(db.sql, null), publishMenu(other, null)])
    expect(results.map((r) => r.version)).toEqual([max + 1, max + 1])
    expect(results.filter((r) => r.created)).toHaveLength(1)
  } finally {
    await other.end({ timeout: 1 })
  }
})

test('option groups of inactive categories are left out', async () => {
  const groupNames = (body: { optionGroups: { name: string }[] }) => body.optionGroups.map((g) => g.name)
  const before = await buildSnapshotBody(db.sql)
  expect(groupNames(before)).toEqual(expect.arrayContaining(['Cookie flavour', 'Fries flavour']))

  await db.sql`update menu_categories set is_active = false where name = 'Food'`
  const after = await buildSnapshotBody(db.sql)
  expect(groupNames(after)).not.toContain('Cookie flavour')
  expect(groupNames(after)).not.toContain('Fries flavour')
  expect(after.categories.map((c) => c.name)).not.toContain('Food')
  await db.sql`update menu_categories set is_active = true where name = 'Food'`
})

test('hashBody ignores key order', async () => {
  const body = await buildSnapshotBody(db.sql)
  const reverse = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(reverse)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverse(x)]))
        : v
  const reordered = reverse(body) as typeof body
  expect(hashBody(reordered)).toBe(hashBody(body))
})

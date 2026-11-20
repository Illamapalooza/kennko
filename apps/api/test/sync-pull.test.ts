import type { PullState } from '@kennko/core'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { startTestDb, type TestDb } from './pg.js'
import { publishTwoVersions, seedDevice, syncApp } from './sync-helpers.js'

let db: TestDb
let api: ReturnType<typeof syncApp>
let token: string
let deviceId: string

beforeAll(async () => {
  db = await startTestDb()
  api = syncApp(db.sql)
  ;({ token, deviceId } = await seedDevice(db.sql))
})
afterAll(async () => {
  await db.stop()
})

const pull = (t: string | null, q = '') =>
  api.app.request(`/v1/sync/pull${q}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} })
const get = async (q = ''): Promise<PullState> => {
  const res = await pull(token, q)
  expect(res.status).toBe(200)
  expect(res.headers.get('Cache-Control')).toBe('no-store')
  return (await res.json()) as PullState
}

test('no snapshot published: menu is null', async () => {
  const s = await get()
  expect(s.menu).toBeNull()
  expect(s.soldOut).toEqual([])
})

test('menu snapshot is sent only when the till is behind', async () => {
  const m = await publishTwoVersions(db.sql)
  const s = await get()
  expect(s.menu?.version).toBe(m.v2)
  expect(s.menu?.snapshot?.version).toBe(m.v2)
  expect((await get(`?version=${m.v1}`)).menu?.snapshot?.version).toBe(m.v2)
  expect(await get(`?version=${m.v2}`)).toMatchObject({ menu: { version: m.v2, snapshot: null } })
  expect((await get('?version=abc')).menu?.snapshot).not.toBeNull()
  expect((await get('?version=0')).menu?.snapshot).not.toBeNull()
  expect((await get('?version=-3')).menu?.snapshot).not.toBeNull()

  const [v] = await db.sql<{ price_centavos: number }[]>`select price_centavos from menu_variants where id = ${m.latteMId}`
  expect(v!.price_centavos).toBe(13000)
  // Served as published: sold-out flags are not overlaid on the body.
  await db.sql`update menu_items set is_available = false where id = ${m.latteId}`
  await db.sql`update menu_variants set is_available = false where id = ${m.latteMId}`
  await db.sql`update options set is_available = false where id = ${m.oatId}`
  const off = await get()
  expect(off.soldOut).toEqual([m.latteId, m.latteMId, m.oatId].sort())
  expect(off.menu?.snapshot?.categories[0]?.items[0]?.isAvailable).toBe(true)
  await db.sql`update menu_items set is_available = true`
  await db.sql`update menu_variants set is_available = true`
  await db.sql`update options set is_available = true`
})

test('staff: only active people with a PIN, never email or user id', async () => {
  await db.sql`delete from staff`
  await db.sql.unsafe(
    `insert into auth.users (id, email) values
       ('00000000-0000-4000-8000-0000000000a1', 'a@x.test'),
       ('00000000-0000-4000-8000-0000000000a2', 'b@x.test'),
       ('00000000-0000-4000-8000-0000000000a3', 'c@x.test');
     insert into staff (user_id, email, full_name, role, is_active, pin_hash) values
       ('00000000-0000-4000-8000-0000000000a1', 'a@x.test', 'Active Pin', 'barista', true, 'h1'),
       ('00000000-0000-4000-8000-0000000000a2', 'b@x.test', 'Inactive Pin', 'barista', false, 'h2'),
       ('00000000-0000-4000-8000-0000000000a3', 'c@x.test', 'Active No Pin', 'manager', true, null);`,
  ).simple()
  const s = await get()
  expect(s.staff).toEqual([{ id: expect.any(String), fullName: 'Active Pin', role: 'barista', pinHash: 'h1' }])
  const text = JSON.stringify(s.staff)
  expect(text).not.toMatch(/email|user_id|userId/)
})

test('shop details are name, address and phone only', async () => {
  const s = await get()
  expect(s.shop.name).toBe('Kennko Coffee')
  expect(Object.keys(s.shop).sort()).toEqual(['address', 'name', 'phone'])
  expect(JSON.stringify(s.shop)).not.toMatch(/receipt_footer|receiptFooter/)
})

test('a revoked or missing device is refused', async () => {
  expect((await pull(null)).status).toBe(401)
  await db.sql`update devices set revoked_at = now(), token_hash = null where id = ${deviceId}`
  expect((await pull(token)).status).toBe(401)
})

import { afterAll, beforeAll, expect, test } from 'vitest'
import { asUser, startTestDb, type TestDb } from './pg.js'

const OWNER = '11111111-1111-4111-8111-111111111111'
const BARISTA = '22222222-2222-4222-8222-222222222222'
const SPLIT_USER = '44444444-4444-4444-8444-444444444444'
const SPLIT_STAFF = '55555555-5555-4555-8555-555555555555'

// Staff added the old way (staff.id = auth user id), loaded just before 0016 runs.
const LEGACY = `
insert into auth.users (id, email, email_confirmed_at) values
  ('${OWNER}', 'owner@kennko.test', now()),
  ('${BARISTA}', 'bea@kennko.test', now());
insert into staff (id, email, full_name, role) values
  ('${OWNER}', 'owner@kennko.test', 'Olive', 'owner'),
  ('${BARISTA}', 'bea@kennko.test', 'Bea', 'barista');
`

let db: TestDb
beforeAll(async () => {
  db = await startTestDb({ seedBefore: { migration: '0016', sql: LEGACY } })
})
afterAll(async () => {
  await db.stop()
})

test('existing staff keep their id and get user_id = id', async () => {
  const rows = await db.sql`select id, user_id from staff where id in (${OWNER}, ${BARISTA}) order by id`
  expect(rows).toEqual([
    { id: OWNER, user_id: OWNER },
    { id: BARISTA, user_id: BARISTA },
  ])
})

test('role is text and the staff_role enum is gone', async () => {
  const [row] = await db.sql`select pg_typeof(role)::text as t from staff limit 1`
  expect(row.t).toBe('text')
  expect(await db.sql`select 1 from pg_type where typname = 'staff_role'`).toHaveLength(0)
})

test('is_owner and is_active_staff match on user_id', async () => {
  const [owner] = await asUser(db.sql, OWNER, (tx) => tx`select public.is_owner() as o, public.is_active_staff() as a`)
  expect(owner).toEqual({ o: true, a: true })
  const [barista] = await asUser(db.sql, BARISTA, (tx) => tx`select public.is_owner() as o, public.is_active_staff() as a`)
  expect(barista).toEqual({ o: false, a: true })
})

test('a barista needs no id, login or email', async () => {
  const [row] = await db.sql`insert into staff (full_name, role) values ('No Login', 'barista') returning id, user_id, email`
  expect(row.id).toMatch(/^[0-9a-f-]{36}$/)
  expect(row.id).not.toBe(OWNER)
  expect(row.user_id).toBeNull()
  expect(row.email).toBeNull()
})

test('an owner without a login fails staff_owner_has_login', async () => {
  await expect(db.sql`insert into staff (full_name, role) values ('Ghost Owner', 'owner')`).rejects.toThrow(
    /staff_owner_has_login/,
  )
})

test('an unknown role fails staff_role_check', async () => {
  await expect(db.sql`insert into staff (full_name, role) values ('Cook', 'chef')`).rejects.toThrow(/staff_role_check/)
})

test('a manager is allowed', async () => {
  const [row] = await db.sql`insert into staff (full_name, role) values ('Max', 'manager') returning role`
  expect(row.role).toBe('manager')
})

test('an owner whose staff id differs from their login is still the owner and reads their own row', async () => {
  await db.sql`insert into auth.users (id, email, email_confirmed_at) values (${SPLIT_USER}, 'split@kennko.test', now())`
  await db.sql`insert into staff (id, user_id, email, full_name, role)
    values (${SPLIT_STAFF}, ${SPLIT_USER}, 'split@kennko.test', 'Split', 'owner')`
  const [fns] = await asUser(db.sql, SPLIT_USER, (tx) => tx`select public.is_owner() as o, public.is_active_staff() as a`)
  expect(fns).toEqual({ o: true, a: true })
  const own = await asUser(db.sql, SPLIT_USER, (tx) => tx`select id, full_name from staff where id = ${SPLIT_STAFF}`)
  expect(own).toEqual([{ id: SPLIT_STAFF, full_name: 'Split' }])
})

test('a barista reads only their own row', async () => {
  const rows = await asUser(db.sql, BARISTA, (tx) => tx`select id from staff`)
  expect(rows).toEqual([{ id: BARISTA }])
})

test('the website role cannot read pin_hash or write staff', async () => {
  const [r] = await db.sql`select
    has_column_privilege('authenticated', 'staff', 'pin_hash', 'SELECT') as pin,
    has_column_privilege('authenticated', 'staff', 'full_name', 'SELECT') as name,
    has_column_privilege('authenticated', 'staff', 'pin_updated_at', 'SELECT') as pin_at,
    has_table_privilege('authenticated', 'staff', 'INSERT') as ins,
    has_table_privilege('authenticated', 'staff', 'UPDATE') as upd,
    has_table_privilege('kennko_api', 'staff', 'SELECT') as api_sel,
    has_table_privilege('kennko_api', 'staff', 'INSERT') as api_ins,
    has_table_privilege('kennko_api', 'staff', 'UPDATE') as api_upd`
  expect(r).toEqual({
    pin: false,
    name: true,
    pin_at: true,
    ins: false,
    upd: false,
    api_sel: true,
    api_ins: true,
    api_upd: true,
  })
})

test('anon has nothing on staff, and the website role cannot delete, empty or reference it', async () => {
  const [r] = await db.sql`select
    has_table_privilege('anon', 'staff', 'SELECT') as anon_sel,
    has_table_privilege('anon', 'staff', 'INSERT') as anon_ins,
    has_table_privilege('anon', 'staff', 'UPDATE') as anon_upd,
    has_table_privilege('anon', 'staff', 'DELETE') as anon_del,
    has_table_privilege('authenticated', 'staff', 'DELETE') as auth_del,
    has_table_privilege('authenticated', 'staff', 'TRUNCATE') as auth_empty,
    has_table_privilege('authenticated', 'staff', 'REFERENCES') as auth_ref,
    has_table_privilege('authenticated', 'staff', 'TRIGGER') as auth_trig`
  expect(r).toEqual({
    anon_sel: false,
    anon_ins: false,
    anon_upd: false,
    anon_del: false,
    auth_del: false,
    auth_empty: false,
    auth_ref: false,
    auth_trig: false,
  })
})

test('the website role cannot insert staff even as the owner', async () => {
  await expect(
    asUser(db.sql, OWNER, (tx) => tx`insert into staff (full_name, role) values ('Sneak', 'barista')`),
  ).rejects.toThrow(/permission denied/)
})

test('devices are invisible to anon and authenticated and writable by the API without delete', async () => {
  const [r] = await db.sql`select
    has_table_privilege('anon', 'devices', 'SELECT') as anon_sel,
    has_table_privilege('authenticated', 'devices', 'SELECT') as auth_sel,
    has_table_privilege('kennko_api', 'devices', 'SELECT') as api_sel,
    has_table_privilege('kennko_api', 'devices', 'INSERT') as api_ins,
    has_table_privilege('kennko_api', 'devices', 'UPDATE') as api_upd,
    has_table_privilege('kennko_api', 'devices', 'DELETE') as api_del`
  expect(r).toEqual({
    anon_sel: false,
    auth_sel: false,
    api_sel: true,
    api_ins: true,
    api_upd: true,
    api_del: false,
  })
  const [rls] = await db.sql`select relrowsecurity from pg_class where oid = 'public.devices'::regclass`
  expect(rls.relrowsecurity).toBe(true)
})

test('a new device gets defaults', async () => {
  const [d] = await db.sql`insert into devices (name) values ('Counter till') returning *`
  expect(d).toMatchObject({ ticket_series: 'C', pairing_attempts: 0, token_hash: null, revoked_at: null })
  expect(d.id).toMatch(/^[0-9a-f-]{36}$/)
})

test('device name and ticket series are checked', async () => {
  await expect(db.sql`insert into devices (name) values ('')`).rejects.toThrow(/check/)
  await expect(db.sql`insert into devices (name) values (${'x'.repeat(41)})`).rejects.toThrow(/check/)
  await expect(db.sql`insert into devices (name, ticket_series) values ('Till', 'W')`).rejects.toThrow(/check/)
  await expect(db.sql`insert into devices (name, pairing_attempts) values ('Till', -1)`).rejects.toThrow(/check/)
})

test('two pending devices cannot share a pairing code; many can have none', async () => {
  await db.sql`insert into devices (name, pairing_code_hash) values ('A', 'samehash')`
  await expect(db.sql`insert into devices (name, pairing_code_hash) values ('B', 'samehash')`).rejects.toThrow(
    /devices_pending_code/,
  )
  await db.sql`insert into devices (name) values ('C'), ('D')`
})

test('paired_by points at staff', async () => {
  await db.sql`insert into devices (name, paired_by) values ('E', ${OWNER})`
  await expect(
    db.sql`insert into devices (name, paired_by) values ('F', '99999999-9999-4999-8999-999999999999')`,
  ).rejects.toThrow(/foreign key/)
})

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import type { Hono } from 'hono'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkStaffPin, hashStaffPin } from '@kennko/core/staff-pin'
import { createApp } from '../src/create-app.js'
import { verifierFromJwks, type AppEnv } from '../src/auth.js'
import { fakeProofs, inlineDefer } from './fakes.js'
import { startTestDb, type TestDb } from './pg.js'

// Real hash/check; randomStaffPin returns queued values first so uniqueness can be forced.
const queued: string[] = []
vi.mock('@kennko/core/staff-pin', async () => {
  const actual = await vi.importActual<typeof import('@kennko/core/staff-pin')>('@kennko/core/staff-pin')
  return { ...actual, randomStaffPin: () => queued.shift() ?? actual.randomStaffPin() }
})

const ISSUER = 'http://supabase.test/auth/v1'
const OWNER = '00000000-0000-4000-8000-000000000001'
const BARISTA = '00000000-0000-4000-8000-000000000002'
const NEW_LOGIN = '00000000-0000-4000-8000-000000000003'
const NEW_LOGIN_2 = '00000000-0000-4000-8000-000000000004'

describe('staff and PIN management', () => {
  let db: TestDb
  let app: Hono<AppEnv>
  let ownerJwt: string
  let baristaJwt: string

  beforeAll(async () => {
    db = await startTestDb()
    const { publicKey, privateKey } = await generateKeyPair('ES256')
    const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' }
    const sign = (sub: string) =>
      new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
        .setSubject(sub)
        .setIssuer(ISSUER)
        .setAudience('authenticated')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(privateKey)
    ownerJwt = await sign(OWNER)
    baristaJwt = await sign(BARISTA)
    app = createApp({
      sql: db.sql,
      verifyUser: verifierFromJwks(createLocalJWKSet({ keys: [jwk] }), ISSUER),
      proofs: fakeProofs(),
      push: null,
      defer: inlineDefer,
      now: () => new Date('2026-11-20T10:00:00Z'),
    })
  })
  afterAll(async () => {
    await db.stop()
  })

  beforeEach(async () => {
    queued.length = 0
    await db.sql
      .unsafe(
        `delete from devices; delete from staff;
         delete from auth.users;
         insert into auth.users (id, email) values
           ('${OWNER}', 'o@x.test'), ('${BARISTA}', 'b@x.test'), ('${NEW_LOGIN}', 'n@x.test'), ('${NEW_LOGIN_2}', 'n2@x.test');
         insert into staff (id, user_id, email, full_name, role, is_active, created_at) values
           ('${OWNER}', '${OWNER}', 'o@x.test', 'Owner', 'owner', true, '2026-01-01T00:00:00Z'),
           ('${BARISTA}', '${BARISTA}', 'b@x.test', 'Barista', 'barista', true, '2026-01-02T00:00:00Z');`,
      )
      .simple()
  })

  const req = (path: string, method: string, auth?: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  type View = {
    id: string
    fullName: string
    email: string | null
    role: string
    isActive: boolean
    hasLogin: boolean
    pinSet: boolean
    pinUpdatedAt: string | null
  }
  const addBarista = async (fullName = 'Ana') => {
    const res = await req('/v1/staff', 'POST', ownerJwt, { fullName, role: 'barista' })
    expect(res.status).toBe(201)
    return (await res.json()) as View
  }
  const row = async (id: string) => (await db.sql`select * from staff where id = ${id}`)[0]!
  const issue = (id: string) => req(`/v1/staff/${id}/pin`, 'POST', ownerJwt)

  it('adds a barista without a login', async () => {
    const res = await req('/v1/staff', 'POST', ownerJwt, { fullName: '  Ana  ', role: 'barista' })
    expect(res.status).toBe(201)
    const v = (await res.json()) as View
    expect(v).toMatchObject({ fullName: 'Ana', role: 'barista', isActive: true, hasLogin: false, pinSet: false, email: null, pinUpdatedAt: null })
    expect(v).not.toHaveProperty('userId')
  })

  it('adds a manager with a login and email', async () => {
    const res = await req('/v1/staff', 'POST', ownerJwt, { fullName: 'Mia', role: 'manager', userId: NEW_LOGIN, email: 'n@x.test' })
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ role: 'manager', hasLogin: true, email: 'n@x.test' })
  })

  it('refuses an owner without a login, a reused login and an unknown login', async () => {
    const o = await req('/v1/staff', 'POST', ownerJwt, { fullName: 'Boss', role: 'owner' })
    expect(o.status).toBe(409)
    expect((await o.json()) as { code: string }).toMatchObject({ code: 'NEEDS_LOGIN' })

    const body = { fullName: 'Mia', role: 'manager', userId: NEW_LOGIN }
    expect((await req('/v1/staff', 'POST', ownerJwt, body)).status).toBe(201)
    const again = await req('/v1/staff', 'POST', ownerJwt, { ...body, fullName: 'Mia 2' })
    expect(again.status).toBe(409)
    expect(await again.json()).toMatchObject({ code: 'ALREADY_STAFF' })

    const ghost = await req('/v1/staff', 'POST', ownerJwt, { fullName: 'G', role: 'manager', userId: '00000000-0000-4000-8000-0000000000ff' })
    expect(ghost.status).toBe(400)
    expect(await ghost.json()).toMatchObject({ code: 'INVALID' })
  })

  it('lists staff in creation order without secrets', async () => {
    const a = await addBarista()
    await issue(a.id)
    const res = await req('/v1/staff', 'GET', ownerJwt)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain('pin_hash')
    expect(text).not.toContain('pinHash')
    expect(text).not.toContain('scrypt$')
    expect(text).not.toContain('userId')
    expect(text).not.toContain('user_id')
    const { staff } = JSON.parse(text) as { staff: View[] }
    expect(staff.map((s) => s.fullName)).toEqual(['Owner', 'Barista', 'Ana'])
    expect(staff[0]).toMatchObject({ hasLogin: true, pinSet: false })
    expect(staff[2]).toMatchObject({ pinSet: true })
  })

  it('a barista (and anonymous) is refused on every route', async () => {
    const a = await addBarista()
    const calls: [string, string, unknown?][] = [
      ['/v1/staff', 'GET'],
      ['/v1/staff', 'POST', { fullName: 'X', role: 'barista' }],
      [`/v1/staff/${a.id}`, 'PATCH', { fullName: 'Y' }],
      [`/v1/staff/${a.id}/pin`, 'POST'],
    ]
    for (const [path, method, body] of calls) {
      expect((await req(path, method, baristaJwt, body)).status).toBe(403)
      expect((await req(path, method, undefined, body)).status).toBe(401)
    }
  })

  it('issues a PIN once, stores only a hash, and a second issue replaces it', async () => {
    const a = await addBarista()
    const res = await issue(a.id)
    expect(res.status).toBe(201)
    const { pin } = (await res.json()) as { pin: string }
    expect(pin).toMatch(/^\d{6}$/)
    const r1 = await row(a.id)
    expect(await checkStaffPin(pin, r1.pin_hash)).toBe(true)
    expect(r1.pin_updated_at).not.toBeNull()

    const get = await (await req('/v1/staff', 'GET', ownerJwt)).text()
    expect(get).not.toContain('pin_hash')
    expect(get).not.toContain(pin + '"')
    const { staff } = JSON.parse(get) as { staff: View[] }
    expect(staff.find((s) => s.id === a.id)?.pinSet).toBe(true)

    await issue(a.id)
    expect((await row(a.id)).pin_hash).not.toBe(r1.pin_hash)
  })

  it('never issues a PIN another active person already has', async () => {
    const a = await addBarista('Ana')
    const b = await addBarista('Ben')
    queued.push('483920')
    const pa = ((await (await issue(a.id)).json()) as { pin: string }).pin
    expect(pa).toBe('483920')
    queued.push('483920', '507318')
    const pb = ((await (await issue(b.id)).json()) as { pin: string }).pin
    expect(pb).toBe('507318')
    // Re-issuing to the same person may keep their own PIN.
    queued.push('483920')
    expect(((await (await issue(a.id)).json()) as { pin: string }).pin).toBe('483920')
  })

  it('an inactive person does not block a PIN, and cannot be issued one', async () => {
    const a = await addBarista('Ana')
    queued.push('483920')
    await issue(a.id)
    await req(`/v1/staff/${a.id}`, 'PATCH', ownerJwt, { isActive: false })
    const dead = await issue(a.id)
    expect(dead.status).toBe(409)
    expect(await dead.json()).toMatchObject({ code: 'INACTIVE' })
    const b = await addBarista('Ben')
    queued.push('483920')
    expect(((await (await issue(b.id)).json()) as { pin: string }).pin).toBe('483920')
  })

  it('keeps the last active owner', async () => {
    for (const body of [{ role: 'barista' }, { isActive: false }, { role: 'manager', isActive: true }]) {
      const res = await req(`/v1/staff/${OWNER}`, 'PATCH', ownerJwt, body)
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ code: 'LAST_OWNER', message: 'There must always be at least one active owner.' })
    }
    const r = await row(OWNER)
    expect(r.role).toBe('owner')
    expect(r.is_active).toBe(true)

    // A second owner makes deactivating one fine.
    await req('/v1/staff', 'POST', ownerJwt, { fullName: 'Two', role: 'owner', userId: NEW_LOGIN })
    const ok = await req(`/v1/staff/${OWNER}`, 'PATCH', ownerJwt, { isActive: false })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ isActive: false })
  })

  it('renaming the last owner is fine', async () => {
    const res = await req(`/v1/staff/${OWNER}`, 'PATCH', ownerJwt, { fullName: 'Boss' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ fullName: 'Boss', role: 'owner' })
  })

  it('promotes a person with a login to owner, but not one without', async () => {
    const a = await addBarista()
    const no = await req(`/v1/staff/${a.id}`, 'PATCH', ownerJwt, { role: 'owner' })
    expect(no.status).toBe(409)
    expect(await no.json()).toMatchObject({ code: 'NEEDS_LOGIN' })
    expect((await row(a.id)).role).toBe('barista')

    const ok = await req(`/v1/staff/${BARISTA}`, 'PATCH', ownerJwt, { role: 'owner' })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ role: 'owner' })
  })

  it('reactivating clears the PIN', async () => {
    const a = await addBarista()
    await issue(a.id)
    const off = await req(`/v1/staff/${a.id}`, 'PATCH', ownerJwt, { isActive: false })
    expect(((await off.json()) as View).pinSet).toBe(true)
    const on = await req(`/v1/staff/${a.id}`, 'PATCH', ownerJwt, { isActive: true })
    expect(on.status).toBe(200)
    expect(await on.json()).toMatchObject({ isActive: true, pinSet: false, pinUpdatedAt: null })
    const r = await row(a.id)
    expect(r.pin_hash).toBeNull()
    expect(r.pin_updated_at).toBeNull()
  })

  it('an already-active person keeps their PIN when isActive true is resent', async () => {
    const a = await addBarista()
    await issue(a.id)
    const res = await req(`/v1/staff/${a.id}`, 'PATCH', ownerJwt, { isActive: true })
    expect(((await res.json()) as View).pinSet).toBe(true)
  })

  it('rejects bad bodies and unknown ids', async () => {
    const a = await addBarista()
    expect((await req(`/v1/staff/${a.id}`, 'PATCH', ownerJwt, {})).status).toBe(400)
    expect((await req(`/v1/staff/${a.id}`, 'PATCH', ownerJwt, { role: 'king' })).status).toBe(400)
    expect((await req('/v1/staff', 'POST', ownerJwt, { fullName: '   ', role: 'barista' })).status).toBe(400)
    expect((await req('/v1/staff', 'POST', ownerJwt, { fullName: 'X', role: 'cook' })).status).toBe(400)
    const missing = '00000000-0000-4000-8000-0000000000aa'
    expect((await req(`/v1/staff/${missing}`, 'PATCH', ownerJwt, { fullName: 'Z' })).status).toBe(404)
    expect((await req(`/v1/staff/${missing}/pin`, 'POST', ownerJwt)).status).toBe(404)
    expect((await req('/v1/staff/not-a-uuid', 'PATCH', ownerJwt, { fullName: 'Z' })).status).toBe(404)
  })

  it('sets updated_at explicitly on updates', async () => {
    const a = await addBarista()
    await req(`/v1/staff/${a.id}`, 'PATCH', ownerJwt, { fullName: 'Ana B' })
    expect((await row(a.id)).updated_at.toISOString()).toBe('2026-11-20T10:00:00.000Z')
  })

  it('hashStaffPin is real inside the mock', async () => {
    expect(await hashStaffPin('483920')).toMatch(/^scrypt\$/)
  })
})

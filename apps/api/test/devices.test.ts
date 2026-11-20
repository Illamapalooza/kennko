import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import type { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/create-app.js'
import { verifierFromJwks, type AppEnv } from '../src/auth.js'
import { sha256Hex } from '../src/devices/tokens.js'
import { fakeAuthAdmin, fakeProofs, inlineDefer } from './fakes.js'
import { startTestDb, type TestDb } from './pg.js'

const ISSUER = 'http://supabase.test/auth/v1'
const OWNER = '00000000-0000-4000-8000-000000000001'
const BARISTA = '00000000-0000-4000-8000-000000000002'

describe('devices and pairing', () => {
  let db: TestDb
  let app: Hono<AppEnv>
  let ownerJwt: string
  let baristaJwt: string
  let now = new Date('2026-11-20T10:00:00Z')

  beforeAll(async () => {
    db = await startTestDb()
    await db.sql
      .unsafe(
        `insert into auth.users (id, email) values ('${OWNER}', 'o@x.test'), ('${BARISTA}', 'b@x.test');
         insert into staff (id, user_id, email, full_name, role, is_active) values
           ('${OWNER}', '${OWNER}', 'o@x.test', 'Owner', 'owner', true),
           ('${BARISTA}', '${BARISTA}', 'b@x.test', 'Barista', 'barista', true);`,
      )
      .simple()
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
      authAdmin: fakeAuthAdmin(),
      push: null,
      defer: inlineDefer,
      now: () => now,
      webKey: null,
    })
  })
  afterAll(async () => {
    await db.stop()
  })

  const req = (path: string, method: string, auth?: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  type Created = { id: string; name: string; code: string; expiresAt: string }
  const add = async (name = 'Till') => {
    const res = await req('/v1/devices', 'POST', ownerJwt, { name })
    expect(res.status).toBe(201)
    return (await res.json()) as Created
  }
  const pair = (code: string) => req('/v1/devices/pair', 'POST', undefined, { code })
  const wrong = (code: string) => (code === '000000' ? '000001' : '000000')
  const row = async (id: string) => (await db.sql`select * from devices where id = ${id}`)[0]!

  it('owner adds a device; only the hash is stored; barista refused', async () => {
    const d = await add('Counter till')
    expect(d.code).toMatch(/^\d{6}$/)
    expect(d.expiresAt).toBe(new Date(now.getTime() + 600_000).toISOString())
    const r = await row(d.id)
    expect(r.pairing_code_hash).toBe(sha256Hex(d.code))
    expect(r.paired_by).toBe(OWNER)
    expect(Object.values(r).some((v) => v === d.code)).toBe(false)
    expect((await req('/v1/devices', 'POST', baristaJwt, { name: 'x' })).status).toBe(403)
    expect((await req('/v1/devices', 'GET', baristaJwt)).status).toBe(403)
  })

  it('pairs, then /me returns only active staff with a PIN', async () => {
    await db.sql`insert into staff (email, full_name, role, is_active, pin_hash) values
      ('a@x.test', 'Active Pin', 'barista', true, 'h1'),
      ('b2@x.test', 'Active NoPin', 'barista', true, null),
      ('c@x.test', 'Inactive Pin', 'barista', false, 'h3')`
    const d = await add()
    const res = await pair(d.code)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { deviceId: string; name: string; ticketSeries: string; token: string }
    expect(body.token.startsWith('kd_')).toBe(true)
    expect(body.deviceId).toBe(d.id)
    expect(body.ticketSeries).toBe('C')
    const r = await row(d.id)
    expect(r.token_hash).toBe(sha256Hex(body.token))
    expect(r.pairing_code_hash).toBeNull()
    expect(r.paired_at).not.toBeNull()

    const me = await req('/v1/devices/me', 'GET', body.token)
    expect(me.status).toBe(200)
    const m = (await me.json()) as { device: unknown; staff: { fullName: string; pinHash: string }[] }
    expect(m.device).toEqual({ id: d.id, name: 'Till', ticketSeries: 'C' })
    expect(m.staff).toEqual([expect.objectContaining({ fullName: 'Active Pin', pinHash: 'h1', role: 'barista' })])
  })

  it('attempt limits, expiry, single use', async () => {
    const a = await add()
    for (let i = 0; i < 4; i++) expect((await pair(wrong(a.code))).status).toBe(401)
    expect((await pair(a.code)).status).toBe(200)

    const b = await add()
    for (let i = 0; i < 5; i++) expect((await pair(wrong(b.code))).status).toBe(401)
    expect((await pair(b.code)).status).toBe(401)
    expect((await row(b.id)).pairing_code_hash).toBeNull()

    const c = await add()
    now = new Date(c.expiresAt)
    const exp = await pair(c.code)
    expect(exp.status).toBe(401)
    expect(((await exp.json()) as { code: string }).code).toBe('PAIRING_FAILED')
    now = new Date('2026-11-20T10:00:00Z')

    const d = await add()
    expect((await pair(d.code)).status).toBe(200)
    expect((await pair(d.code)).status).toBe(401)

    const e = await add()
    const both = await Promise.all([pair(e.code), pair(e.code)])
    expect(both.map((r) => r.status).sort()).toEqual([200, 401])
  })

  it('revoke, list and statuses', async () => {
    const d = await add('Revokable')
    const body = (await (await pair(d.code)).json()) as { token: string }
    expect((await req('/v1/devices/me', 'GET', body.token)).status).toBe(200)
    expect((await req(`/v1/devices/${d.id}`, 'DELETE', ownerJwt)).status).toBe(204)
    const res = await req('/v1/devices/me', 'GET', body.token)
    expect(res.status).toBe(401)
    expect(((await res.json()) as { code: string }).code).toBe('DEVICE_REVOKED')
    expect((await req(`/v1/devices/${d.id}`, 'DELETE', ownerJwt)).status).toBe(204)
    expect((await req('/v1/devices/00000000-0000-4000-8000-0000000000ff', 'DELETE', ownerJwt)).status).toBe(404)
    expect((await req('/v1/devices/nope', 'DELETE', ownerJwt)).status).toBe(404)
    expect((await req(`/v1/devices/${d.id}`, 'DELETE', baristaJwt)).status).toBe(403)

    const afterRevoke = (await (await req('/v1/devices', 'GET', ownerJwt)).json()) as { devices: { id: string }[] }
    expect(afterRevoke.devices.map((x) => x.id)).not.toContain(d.id)

    await db.sql`delete from devices`
    await add('Waiting')
    now = new Date(now.getTime() + 700_000)
    await add('Expired')
    now = new Date(now.getTime() + 700_000)
    await add('Fresh')
    const paired = await add('Paired')
    const tok = ((await (await pair(paired.code)).json()) as { token: string }).token
    await req('/v1/devices/me', 'GET', tok)
    const list = (await (await req('/v1/devices', 'GET', ownerJwt)).json()) as {
      devices: { id: string; name: string; status: string; expiresAt: string | null; pairedAt: string | null; lastSeenAt: string | null }[]
    }
    const by = Object.fromEntries(list.devices.map((x) => [x.name, x]))
    expect(by['Waiting']!.status).toBe('expired')
    expect(by['Expired']!.status).toBe('expired')
    expect(by['Fresh']!.status).toBe('waiting')
    expect(by['Paired']!.status).toBe('paired')
    expect(by['Paired']!.pairedAt).toBe(now.toISOString())
    expect(by['Paired']!.lastSeenAt).toBe(now.toISOString())
    expect(JSON.stringify(list)).not.toMatch(/hash/)
  })

  it('bad bodies -> 400', async () => {
    const r1 = await req('/v1/devices/pair', 'POST', undefined, { code: '12345' })
    expect(r1.status).toBe(400)
    expect(((await r1.json()) as { code: string }).code).toBe('INVALID')
    expect((await req('/v1/devices', 'POST', ownerJwt, { name: '' })).status).toBe(400)
  })
})

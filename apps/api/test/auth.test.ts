import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import type { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/create-app.js'
import { requireStaff, verifierFromJwks, type AppEnv } from '../src/auth.js'
import { fakeProofs, inlineDefer } from './fakes.js'
import { startTestDb, type TestDb } from './pg.js'

const SUPABASE_URL = 'http://supabase.test'
const ISSUER = `${SUPABASE_URL}/auth/v1`

const OWNER = '00000000-0000-4000-8000-000000000001'
const BARISTA = '00000000-0000-4000-8000-000000000002'
const FIRED = '00000000-0000-4000-8000-000000000003'

describe('staff auth', () => {
  let db: TestDb
  let app: Hono<AppEnv>
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey']
  let sign: (sub: string, opts?: { expiresIn?: string | number; key?: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'] }) => Promise<string>

  beforeAll(async () => {
    db = await startTestDb()
    const rows = [
      [OWNER, 'owner@x.test', 'owner', true],
      [BARISTA, 'barista@x.test', 'barista', true],
      [FIRED, 'fired@x.test', 'owner', false],
    ] as const
    // Constants only, so run as one simple-protocol script (PGlite's extended protocol is flaky here).
    await db.sql
      .unsafe(
        rows
          .map(
            ([id, email, role, active]) =>
              `insert into auth.users (id, email) values ('${id}', '${email}');
               insert into staff (id, email, full_name, role, is_active)
               values ('${id}', '${email}', '${email}', '${role}', ${active});`,
          )
          .join('\n'),
      )
      .simple()

    const pair = await generateKeyPair('ES256')
    const publicKey = pair.publicKey
    privateKey = pair.privateKey
    const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' }
    const verifyUser = verifierFromJwks(createLocalJWKSet({ keys: [jwk] }), ISSUER)
    sign = (sub, opts = {}) =>
      new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
        .setSubject(sub)
        .setIssuer(ISSUER)
        .setAudience('authenticated')
        .setIssuedAt()
        .setExpirationTime(opts.expiresIn ?? '5m')
        .sign(opts.key ?? privateKey)

    const deps = { sql: db.sql, verifyUser, proofs: fakeProofs(), push: null, defer: inlineDefer, now: () => new Date() }
    app = createApp(deps)
    app.get('/owner-only', requireStaff(deps, 'owner'), (c) => c.json(c.get('staff')))
    app.get('/any-staff', requireStaff(deps), (c) => c.json(c.get('staff')))

  })
  afterAll(async () => {
    await db.stop()
  })

  const get = (path: string, token?: string) =>
    app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })

  it('no token -> 401', async () => {
    const res = await get('/owner-only')
    expect(res.status).toBe(401)
    expect(((await res.json()) as { code: string }).code).toBe('UNAUTHENTICATED')
  })

  it('a token signed by another key -> 401', async () => {
    const other = await generateKeyPair('ES256')
    const res = await get('/owner-only', await sign(OWNER, { key: other.privateKey }))
    expect(res.status).toBe(401)
  })

  it('an expired token -> 401', async () => {
    const res = await get('/owner-only', await sign(OWNER, { expiresIn: Math.floor(Date.now() / 1000) - 60 }))
    expect(res.status).toBe(401)
  })

  it('a barista on an owner route -> 403', async () => {
    const res = await get('/owner-only', await sign(BARISTA))
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code: string }).code).toBe('FORBIDDEN')
  })

  it('a deactivated owner -> 403', async () => {
    const res = await get('/owner-only', await sign(FIRED))
    expect(res.status).toBe(403)
  })

  it('a valid user who is not staff -> 403', async () => {
    const res = await get('/any-staff', await sign('00000000-0000-4000-8000-0000000000ff'))
    expect(res.status).toBe(403)
  })

  it('a valid owner token passes with staff set', async () => {
    const res = await get('/owner-only', await sign(OWNER))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: OWNER, role: 'owner' })
  })

  it('a barista passes a route with no role requirement', async () => {
    const res = await get('/any-staff', await sign(BARISTA))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: BARISTA, role: 'barista' })
  })

  const base = () => new SignJWT({}).setIssuedAt().setExpirationTime('5m')

  it('a non-uuid subject -> 401, not 500', async () => {
    expect((await get('/any-staff', await sign('not-a-uuid'))).status).toBe(401)
  })

  it('a missing subject -> 401', async () => {
    const t = await base()
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .sign(privateKey)
    expect((await get('/any-staff', t)).status).toBe(401)
  })

  it('a wrong issuer -> 401', async () => {
    const t = await base()
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setSubject(OWNER)
      .setIssuer('http://evil.test/auth/v1')
      .setAudience('authenticated')
      .sign(privateKey)
    expect((await get('/any-staff', t)).status).toBe(401)
  })

  it('a wrong audience -> 401', async () => {
    const t = await base()
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setSubject(OWNER)
      .setIssuer(ISSUER)
      .setAudience('anon')
      .sign(privateKey)
    expect((await get('/any-staff', t)).status).toBe(401)
  })

  it('an HS256-signed token -> 401', async () => {
    const t = await base()
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
      .setSubject(OWNER)
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .sign(new TextEncoder().encode('a-shared-secret-that-is-long-enough-32b'))
    expect((await get('/any-staff', t)).status).toBe(401)
  })

  it('an alg:none token -> 401', async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const t = `${b64({ alg: 'none', kid: 'k1' })}.${b64({
      sub: OWNER,
      iss: ISSUER,
      aud: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 300,
    })}.`
    expect((await get('/any-staff', t)).status).toBe(401)
  })

  it('a non-Bearer Authorization header -> 401', async () => {
    const res = await app.request('/any-staff', { headers: { Authorization: 'Basic xyz' } })
    expect(res.status).toBe(401)
  })
})

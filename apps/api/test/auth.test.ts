import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import type { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { requireStaff, verifierFromJwks, type AppEnv } from '../src/auth.ts'
import { startTestDb, type TestDb } from './pg.ts'

const SUPABASE_URL = 'http://supabase.test'
const ISSUER = `${SUPABASE_URL}/auth/v1`

const OWNER = '00000000-0000-4000-8000-000000000001'
const BARISTA = '00000000-0000-4000-8000-000000000002'
const FIRED = '00000000-0000-4000-8000-000000000003'

describe('staff auth', () => {
  let db: TestDb
  let app: Hono<AppEnv>
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

    const { publicKey, privateKey } = await generateKeyPair('ES256')
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

    const deps = { sql: db.sql, verifyUser }
    app = createApp(deps) as unknown as Hono<AppEnv>
    app.get('/owner-only', requireStaff(deps, 'owner'), (c) => c.json(c.get('staff')))
    app.get('/any-staff', requireStaff(deps), (c) => c.json(c.get('staff')))

    // PGlite quirk: the first run of a given parameterised query fails once ("unnamed prepared statement
    // does not exist"); real Postgres is unaffected. Burn it with a throwaway request (result ignored).
    await app.request('/any-staff', { headers: { Authorization: `Bearer ${await sign(OWNER)}` } })
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
})

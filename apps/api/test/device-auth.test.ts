import { createLocalJWKSet } from 'jose'
import type { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/create-app.js'
import { requireDevice, requireStaff, verifierFromJwks, type AppEnv } from '../src/auth.js'
import { newDeviceToken, newPairingCode, sha256Hex } from '../src/devices/tokens.js'
import { fakeAuthAdmin, fakeProofs, inlineDefer } from './fakes.js'
import { startTestDb, type TestDb } from './pg.js'

describe('device auth', () => {
  let db: TestDb
  let app: Hono<AppEnv>
  let now = new Date('2026-11-20T10:00:00Z')
  const token = newDeviceToken()
  let deviceId: string

  beforeAll(async () => {
    db = await startTestDb()
    const [d] = await db.sql`
      insert into devices (name, token_hash, paired_at) values ('Counter', ${sha256Hex(token)}, now()) returning id`
    deviceId = d!.id
    // The real verifier on a key set that holds no keys: every token fails to verify.
    const deps = {
      sql: db.sql,
      verifyUser: verifierFromJwks(createLocalJWKSet({ keys: [] }), 'http://supabase.test/auth/v1'),
      proofs: fakeProofs(),
      authAdmin: fakeAuthAdmin(),
      push: null,
      defer: inlineDefer,
      now: () => now,
    }
    app = createApp(deps)
    app.get('/device-only', requireDevice(deps), (c) => c.json(c.get('device')))
    app.get('/owner-only', requireStaff(deps, 'owner'), (c) => c.json(c.get('staff')))
  })
  afterAll(async () => {
    await db.stop()
  })

  const call = (path: string, auth?: string, method = 'GET') =>
    app.request(path, { method, headers: auth ? { Authorization: auth } : {} })
  const lastSeen = async () => {
    const [r] = await db.sql`select last_seen_at from devices where id = ${deviceId}`
    return r!.last_seen_at as Date | null
  }
  const code = async (res: Response) => ((await res.json()) as { code: string }).code

  it('token helpers have the right shape', () => {
    expect(token).toMatch(/^kd_[A-Za-z0-9_-]{43}$/)
    expect(newPairingCode()).toMatch(/^\d{6}$/)
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('a valid token passes, sets last_seen_at, and a call within a minute leaves it', async () => {
    const res = await call('/device-only', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: deviceId, name: 'Counter' })
    const first = await lastSeen()
    expect(first).not.toBeNull()

    now = new Date(now.getTime() + 30_000)
    expect((await call('/device-only', `Bearer ${token}`)).status).toBe(200)
    expect((await lastSeen())!.getTime()).toBe(first!.getTime())

    now = new Date(now.getTime() + 61_000)
    expect((await call('/device-only', `Bearer ${token}`)).status).toBe(200)
    expect((await lastSeen())!.getTime()).toBeGreaterThan(first!.getTime())
  })

  it('no header, a non-device token, an unknown device token -> 401', async () => {
    for (const auth of [undefined, 'Bearer not-a-device', 'Bearer kd_unknown']) {
      const res = await call('/device-only', auth)
      expect(res.status).toBe(401)
    }
    expect(await code(await call('/device-only'))).toBe('UNAUTHENTICATED')
    expect(await code(await call('/device-only', 'Bearer not-a-device'))).toBe('UNAUTHENTICATED')
    expect(await code(await call('/device-only', 'Bearer kd_unknown'))).toBe('DEVICE_REVOKED')
  })

  it('the device token is refused on staff routes (not a JWT)', async () => {
    expect((await call('/owner-only', `Bearer ${token}`)).status).toBe(401)
    expect((await call('/v1/menu/publish', `Bearer ${token}`, 'POST')).status).toBe(401)
  })

  it('a revoked device -> 401 DEVICE_REVOKED', async () => {
    await db.sql`update devices set revoked_at = now() where id = ${deviceId}`
    const res = await call('/device-only', `Bearer ${token}`)
    expect(res.status).toBe(401)
    const body = (await res.json()) as { code: string; message: string }
    expect(body.code).toBe('DEVICE_REVOKED')
    expect(body.message).toBe('This till was disconnected. Pair it again.')
  })
})

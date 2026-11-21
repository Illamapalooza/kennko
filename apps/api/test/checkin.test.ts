import { randomUUID } from 'node:crypto'
import { CHECKINS_PER_MINUTE, MAX_VISITORS, wallCode, wallMinute, type PullState } from '@kennko/core'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import type { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { verifierFromJwks, type AppEnv } from '../src/auth.js'
import { createApp } from '../src/create-app.js'
import { fakeAuthAdmin, fakeProofs, inlineDefer, type FakeAuthAdmin } from './fakes.js'
import { startTestDb, type TestDb } from './pg.js'
import { seedDevice } from './sync-helpers.js'

const ISSUER = 'http://supabase.test/auth/v1'
const MIN = 60_000
const M = wallMinute(Date.parse('2026-11-21T02:00:00Z'))
/** Minute `M` plus 30 seconds. */
const T = new Date(M * MIN + 30_000)
const at = (ms: number) => new Date(T.getTime() + ms)

type Json = Record<string, unknown>

describe('POST /v1/checkin and the visitors in the pull', () => {
  let db: TestDb
  let app: Hono<AppEnv>
  let auth: FakeAuthAdmin
  let sign: (sub: string) => Promise<string>
  let device: string
  let secret: string
  let now = T

  beforeAll(async () => {
    db = await startTestDb()
    const pair = await generateKeyPair('ES256')
    const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' }
    sign = (sub) =>
      new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
        .setSubject(sub)
        .setIssuer(ISSUER)
        .setAudience('authenticated')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(pair.privateKey)
    auth = fakeAuthAdmin()
    app = createApp({
      sql: db.sql,
      verifyUser: verifierFromJwks(createLocalJWKSet({ keys: [jwk] }), ISSUER),
      proofs: fakeProofs(),
      authAdmin: auth,
      push: null,
      defer: inlineDefer,
      now: () => now,
      webKey: null,
    })
    device = (await seedDevice(db.sql)).token
    // The first pull creates the secret; the test reads it from the database.
    const first = await pull()
    const [row] = await db.sql<{ checkin_secret: string }[]>`select checkin_secret from shop_secrets where id = 1`
    secret = row!.checkin_secret
    expect(first.checkin).toEqual({ secret, url: 'https://kennko.vercel.app/here' })
  })
  afterAll(async () => {
    await db.stop()
  })

  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, headers: res.headers, body: (text ? JSON.parse(text) : null) as Json }
  }
  async function pull(): Promise<PullState> {
    const r = await call('GET', '/v1/sync/pull', device)
    expect(r.status).toBe(200)
    return r.body as unknown as PullState
  }
  /** A signed-in person; with `join`, a Kennko card (and so a cat). */
  async function person(join = true) {
    const id = randomUUID()
    const email = `${id.slice(0, 8)}@x.test`
    await db.sql`insert into auth.users (id, email) values (${id}, ${email})`
    auth.users[id] = { email, emailConfirmed: true, createdAt: '2026-11-10T00:00:00Z', name: 'Ana' }
    const jwt = await sign(id)
    if (join) {
      const r = await call('POST', '/v1/me/join', jwt, { ageConfirmed: true, privacyVersion: '2026-11' })
      expect(r.status).toBe(200)
    }
    return { id, jwt }
  }
  /** The wall's code for the minute holding `when`. */
  const codeFor = (when: Date, s = secret) => wallCode(s, wallMinute(when.getTime()))
  const checkin = (jwt: string | undefined, code: unknown) => call('POST', '/v1/checkin', jwt, { code })
  const visitOf = async (id: string) =>
    (await db.sql<{ visit_key: string; started_at: Date; ends_at: Date; source: string }[]>`
      select visit_key, started_at, ends_at, source from visits where customer_id = ${id}`)[0]
  const catOf = async (id: string) => (await db.sql<{ name: string }[]>`select name from cats where customer_id = ${id}`)[0]!

  describe('the wall code', () => {
    it('wall code accepted for the current and previous minute only', async () => {
      now = T
      const p = await person()
      const code = await codeFor(T)

      const ok = await checkin(p.jwt, code)
      expect(ok.status).toBe(200)
      expect(ok.headers.get('cache-control')).toBe('no-store')
      // The same code a minute later (minute M + 1) is the previous minute: still accepted.
      now = at(MIN)
      expect((await checkin(p.jwt, code)).status).toBe(200)
      // Two minutes later (minute M + 2) it has changed.
      now = at(2 * MIN)
      const late = await checkin(p.jwt, code)
      expect(late.status).toBe(400)
      expect(late.body).toEqual({ code: 'BAD_WALL_CODE', message: 'That code has changed. Scan the wall again.' })

      // No future minute.
      now = T
      const q = await person()
      const future = await checkin(q.jwt, await wallCode(secret, M + 1))
      expect(future.status).toBe(400)
      expect(future.body.code).toBe('BAD_WALL_CODE')
      // Another secret's code.
      const other = await checkin(q.jwt, await codeFor(T, 'x'.repeat(43)))
      expect(other.status).toBe(400)
      expect(await visitOf(q.id)).toBeUndefined()
      // Garbage (from someone else, as each try counts towards the rate limit).
      const g = await person()
      for (const junk of ['../..', 'a'.repeat(40), '', code.toUpperCase(), 12345678, null]) {
        const r = await checkin(g.jwt, junk)
        expect(r.status, String(junk)).toBe(400)
        expect(r.body.code).toBe('BAD_WALL_CODE')
      }
      expect(await visitOf(g.id)).toBeUndefined()
    })
  })

  describe('visits', () => {
    it('the first check-in starts a 90-minute visit; one 30 minutes later moves the end and keeps the visit', async () => {
      now = T
      const p = await person()
      const first = await checkin(p.jwt, await codeFor(T))
      expect(first.body).toEqual({ endsAt: at(90 * MIN).toISOString(), onWall: true })
      const v1 = (await visitOf(p.id))!
      expect(v1.started_at).toEqual(T)
      expect(v1.ends_at).toEqual(at(90 * MIN))
      expect(v1.source).toBe('checkin')

      now = at(30 * MIN)
      const second = await checkin(p.jwt, await codeFor(now))
      expect(second.body).toEqual({ endsAt: at(120 * MIN).toISOString(), onWall: true })
      const v2 = (await visitOf(p.id))!
      expect(v2.ends_at).toEqual(at(120 * MIN))
      expect(v2.visit_key).toBe(v1.visit_key)
      expect(v2.started_at).toEqual(T)

      // After the visit ended: a new key and a new start.
      now = at(121 * MIN)
      await checkin(p.jwt, await codeFor(now))
      const v3 = (await visitOf(p.id))!
      expect(v3.visit_key).not.toBe(v1.visit_key)
      expect(v3.started_at).toEqual(now)
      expect(v3.ends_at).toEqual(at(211 * MIN))
      now = T
    })

    it(`the ${CHECKINS_PER_MINUTE + 1}th check-in in a minute is 429, even with a valid code`, async () => {
      now = T
      const p = await person()
      const code = await codeFor(T)
      for (let i = 0; i < CHECKINS_PER_MINUTE; i++) expect((await checkin(p.jwt, code)).status).toBe(200)
      const r = await checkin(p.jwt, code)
      expect(r.status).toBe(429)
      expect(r.body.code).toBe('RATE_LIMITED')
    })

    it('no card is 404 NOT_JOINED; no token is 401', async () => {
      now = T
      const p = await person(false)
      const r = await checkin(p.jwt, await codeFor(T))
      expect(r.status).toBe(404)
      expect(r.body.code).toBe('NOT_JOINED')
      expect((await checkin(undefined, await codeFor(T))).status).toBe(401)
    })

    it('a customer from before the cats deploy (no cat) gets one at check-in', async () => {
      now = T
      const p = await person()
      await db.sql`delete from cats where customer_id = ${p.id}`
      expect((await checkin(p.jwt, await codeFor(T))).status).toBe(200)
      expect((await catOf(p.id)).name).toBeTruthy()
    })
  })

  describe('who is on the wall', () => {
    it('"Show me on the wall" off: the visit is kept but the cat is not in the pull until switched on; hidden by admin never is', async () => {
      now = T
      const p = await person()
      await db.sql`update cats set show_on_wall = false where customer_id = ${p.id}`
      const r = await checkin(p.jwt, await codeFor(T))
      expect(r.status).toBe(200)
      expect(r.body.onWall).toBe(false)
      const v = (await visitOf(p.id))!
      expect(v).toBeDefined()
      expect((await pull()).visitors!.map((x) => x.key)).not.toContain(v.visit_key)

      await db.sql`update cats set show_on_wall = true where customer_id = ${p.id}`
      const seen = (await pull()).visitors!.find((x) => x.key === v.visit_key)
      expect(seen).toMatchObject({ name: (await catOf(p.id)).name, endsAt: at(90 * MIN).toISOString() })

      await db.sql`update cats set hidden_by_admin = true where customer_id = ${p.id}`
      expect((await pull()).visitors!.map((x) => x.key)).not.toContain(v.visit_key)
      const again = await checkin(p.jwt, await codeFor(T))
      expect(again.body.onWall).toBe(false)
    })

    it(`at most ${MAX_VISITORS}: 14 active visits give the newest ${MAX_VISITORS}; ended visits never show`, async () => {
      // A day later every earlier visit has ended.
      now = at(24 * 60 * MIN)
      const started: { key: string; startedAt: Date }[] = []
      for (let i = 0; i < 14; i++) {
        const p = await person()
        const key = randomUUID()
        const startedAt = new Date(now.getTime() - (i + 1) * MIN)
        await db.sql`insert into visits (customer_id, visit_key, source, started_at, ends_at)
          values (${p.id}, ${key}, 'checkin', ${startedAt}, ${new Date(now.getTime() + 60 * MIN)})`
        started.push({ key, startedAt })
      }
      // Ended a second ago, started most recently of all: still never shown.
      const gone = await person()
      await db.sql`insert into visits (customer_id, visit_key, source, started_at, ends_at)
        values (${gone.id}, ${randomUUID()}, 'checkin', ${new Date(now.getTime() - 1000 * 30)}, ${new Date(now.getTime() - 1000)})`

      const visitors = (await pull()).visitors!
      expect(visitors).toHaveLength(MAX_VISITORS)
      expect(visitors.map((v) => v.key)).toEqual(started.slice(0, MAX_VISITORS).map((s) => s.key))
      now = T
    })
  })
})

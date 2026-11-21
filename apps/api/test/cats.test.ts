import { randomUUID } from 'node:crypto'
import { STARTER_CAT_NAMES, STARTER_COATS, type CosmeticView, type MeView } from '@kennko/core'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import type { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { verifierFromJwks, type AppEnv } from '../src/auth.js'
import { createApp } from '../src/create-app.js'
import { ensureCat, ownedKeys } from '../src/loyalty/cats.js'
import { fakeAuthAdmin, fakeProofs, inlineDefer, type FakeAuthAdmin } from './fakes.js'
import { startTestDb, type TestDb } from './pg.js'

const ISSUER = 'http://supabase.test/auth/v1'
const NOW = new Date('2026-11-21T02:00:00Z')
const STAFF = '00000000-0000-4000-8000-0000000000e1'

type Json = Record<string, unknown>
type Customer = NonNullable<MeView['customer']>

describe('Kennko cats: the catalogue, buying with points, equipping', () => {
  let db: TestDb
  let app: Hono<AppEnv>
  let auth: FakeAuthAdmin
  let sign: (sub: string) => Promise<string>
  let now = NOW
  const ids: Record<string, string> = {}

  beforeAll(async () => {
    db = await startTestDb()
    await db.sql
      .unsafe(
        `insert into auth.users (id, email) values ('${STAFF}', 'staff@x.test');
         insert into staff (id, user_id, email, full_name, role, is_active)
           values ('${STAFF}', '${STAFF}', 'staff@x.test', 'Olive', 'owner', true);`,
      )
      .simple()
    for (const r of await db.sql<{ id: string; key: string }[]>`select id, key from cosmetics`) ids[r.key] = r.id

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
  })
  afterAll(async () => {
    await db.stop()
  })

  const call = async (method: string, path: string, jwt?: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, headers: res.headers, body: (text ? JSON.parse(text) : null) as Json }
  }

  async function person() {
    const id = randomUUID()
    const email = `${id.slice(0, 8)}@x.test`
    await db.sql`insert into auth.users (id, email) values (${id}, ${email})`
    auth.users[id] = { email, emailConfirmed: true, createdAt: '2026-11-10T00:00:00Z', name: 'Ana' }
    return { id, jwt: await sign(id) }
  }
  /** A customer with a card and `points` from an adjustment. */
  async function member(points = 0) {
    const p = await person()
    const r = await call('POST', '/v1/me/join', p.jwt, { ageConfirmed: true, privacyVersion: '2026-11' })
    expect(r.status).toBe(200)
    if (points !== 0) await give(p.id, points)
    return p
  }
  const give = (id: string, delta: number) => db.sql`
    insert into points_ledger (customer_id, delta, reason, note, created_by_staff, created_at)
    values (${id}, ${delta}, 'adjustment', 'test', ${STAFF}, ${NOW})`
  const me = async (jwt: string) => ((await call('GET', '/v1/me', jwt)).body as MeView).customer!
  const buy = (jwt: string, key: string) => call('POST', `/v1/me/cosmetics/${ids[key]}/buy`, jwt)
  const putCat = (jwt: string, body: unknown) => call('PUT', '/v1/me/cat', jwt, body)
  const counts = async (id: string) => {
    const [r] = await db.sql`select
      (select count(*)::int from customer_cosmetics where customer_id = ${id}) as owned,
      (select count(*)::int from points_ledger where customer_id = ${id} and reason = 'cosmetic') as charges`
    return r
  }

  describe('buying', () => {
    it('a purchase refused below the price', async () => {
      const p = await member(39)
      const r = await buy(p.jwt, 'beanie')
      expect(r.status).toBe(409)
      expect(r.body.code).toBe('NOT_ENOUGH_POINTS')
      expect(await counts(p.id)).toEqual({ owned: 0, charges: 0 })
      expect((await me(p.jwt)).points).toBe(39)

      await give(p.id, 1)
      const ok = await buy(p.jwt, 'beanie')
      expect(ok.status).toBe(200)
      const c = (ok.body as MeView).customer!
      expect(c.owned).toContain('beanie')
      expect(c.points).toBe(0)
      const rows = await db.sql`select delta, cosmetic_id from points_ledger where customer_id = ${p.id} and reason = 'cosmetic'`
      expect(rows.map((x) => [x.delta, x.cosmetic_id])).toEqual([[-40, ids.beanie]])
      // Buying does not equip.
      expect(c.cat.look).toEqual({ coat: c.cat.look.coat })
    })

    it('a double buy: both 200, charged once', async () => {
      const p = await member(100)
      const [a, b] = await Promise.all([buy(p.jwt, 'beanie'), buy(p.jwt, 'beanie')])
      expect([a.status, b.status]).toEqual([200, 200])
      expect(await counts(p.id)).toEqual({ owned: 1, charges: 1 })
      expect((await me(p.jwt)).points).toBe(60)
      const again = await buy(p.jwt, 'beanie')
      expect(again.status).toBe(200)
      expect((again.body as MeView).customer!.points).toBe(60)
    })

    it('a negative balance (a reversal after spending) refuses any priced item', async () => {
      const p = await member(40)
      expect((await buy(p.jwt, 'beanie')).status).toBe(200)
      await give(p.id, -10)
      const r = await buy(p.jwt, 'blush')
      expect(r.status).toBe(409)
      expect(r.body.code).toBe('NOT_ENOUGH_POINTS')
      expect(await counts(p.id)).toEqual({ owned: 1, charges: 1 })
    })

    it('a starter is 409 STARTER_ITEM; an inactive item, an unknown uuid and a non-uuid are 404', async () => {
      const p = await member(500)
      const starter = await buy(p.jwt, 'tabby')
      expect(starter.status).toBe(409)
      expect(starter.body.code).toBe('STARTER_ITEM')

      await db.sql`update cosmetics set is_active = false where key = 'fish'`
      try {
        const inactive = await buy(p.jwt, 'fish')
        expect(inactive.status).toBe(404)
        expect(inactive.body.code).toBe('UNKNOWN_COSMETIC')
      } finally {
        await db.sql`update cosmetics set is_active = true where key = 'fish'`
      }
      const unknown = await call('POST', `/v1/me/cosmetics/${randomUUID()}/buy`, p.jwt)
      expect(unknown.status).toBe(404)
      expect(unknown.body.code).toBe('UNKNOWN_COSMETIC')
      expect((await call('POST', '/v1/me/cosmetics/not-a-uuid/buy', p.jwt)).status).toBe(404)
      expect(await counts(p.id)).toEqual({ owned: 0, charges: 0 })
      expect((await me(p.jwt)).points).toBe(500)
    })

    it('without a card: 404 NOT_JOINED; without a token: 401', async () => {
      const p = await person()
      const r = await buy(p.jwt, 'beanie')
      expect(r.status).toBe(404)
      expect(r.body.code).toBe('NOT_JOINED')
      expect((await call('POST', `/v1/me/cosmetics/${ids.beanie}/buy`)).status).toBe(401)
    })
  })

  describe('equipping, renaming and the wall switch', () => {
    it('an equipped cosmetic that isn\'t owned is refused', async () => {
      const p = await member(150)
      const before = (await me(p.jwt)).cat
      const r = await putCat(p.jwt, { name: 'Mochi', look: { coat: 'tabby', hat: 'crown' }, showOnWall: true })
      expect(r.status).toBe(409)
      expect(r.body.code).toBe('NOT_OWNED')
      expect((await me(p.jwt)).cat).toEqual(before)

      expect((await buy(p.jwt, 'crown')).status).toBe(200)
      const ok = await putCat(p.jwt, { name: 'Mochi', look: { coat: 'tabby', hat: 'crown' }, showOnWall: false })
      expect(ok.status).toBe(200)
      expect((ok.body as MeView).customer!.cat).toEqual({
        name: 'Mochi',
        look: { coat: 'tabby', hat: 'crown' },
        showOnWall: false,
        hiddenByAdmin: false,
        visitEndsAt: null,
      })
      const [row] = await db.sql`select updated_at from cats where customer_id = ${p.id}`
      expect((row!.updated_at as Date).toISOString()).toBe(NOW.toISOString())
    })

    it('coats: a bought coat needs buying, a starter coat does not', async () => {
      const p = await member()
      const siamese = await putCat(p.jwt, { name: 'Ube', look: { coat: 'siamese' }, showOnWall: true })
      expect(siamese.status).toBe(409)
      expect(siamese.body.code).toBe('NOT_OWNED')
      expect((await putCat(p.jwt, { name: 'Ube', look: { coat: 'tabby' }, showOnWall: true })).status).toBe(200)
    })

    it('a wrong slot is 400 WRONG_SLOT; an unknown key is 409 NOT_OWNED; a bad look is 400 BAD_LOOK', async () => {
      const p = await member(100)
      expect((await buy(p.jwt, 'bandana')).status).toBe(200)
      const wrong = await putCat(p.jwt, { name: 'Ube', look: { coat: 'tabby', hat: 'bandana' }, showOnWall: true })
      expect(wrong.status).toBe(400)
      expect(wrong.body.code).toBe('WRONG_SLOT')
      const coatAsHat = await putCat(p.jwt, { name: 'Ube', look: { coat: 'tabby', hat: 'ginger' }, showOnWall: true })
      expect(coatAsHat.body.code).toBe('WRONG_SLOT')
      const nope = await putCat(p.jwt, { name: 'Ube', look: { coat: 'tabby', hat: 'nope' }, showOnWall: true })
      expect(nope.status).toBe(409)
      expect(nope.body.code).toBe('NOT_OWNED')
      for (const look of [{ hat: 'beanie' }, { coat: 'tabby', tail: 'x' }, 'tabby', null, { coat: '' }]) {
        const bad = await putCat(p.jwt, { name: 'Ube', look, showOnWall: true })
        expect(bad.status, JSON.stringify(look)).toBe(400)
        expect(bad.body.code).toBe('BAD_LOOK')
      }
      expect((await putCat(p.jwt, { name: 'Ube', look: { coat: 'tabby', neck: 'bandana' }, showOnWall: true })).status).toBe(200)
    })

    it('a body without a boolean showOnWall or a string name is 400', async () => {
      const p = await member()
      expect((await putCat(p.jwt, { name: 'Ube', look: { coat: 'tabby' } })).status).toBe(400)
      expect((await putCat(p.jwt, { name: 'Ube', look: { coat: 'tabby' }, showOnWall: 'yes' })).status).toBe(400)
      expect((await putCat(p.jwt, { look: { coat: 'tabby' }, showOnWall: true })).status).toBe(400)
      expect((await putCat(p.jwt, null)).status).toBe(400)
    })

    it('names: the core rules and message; the normalised name is stored', async () => {
      const p = await member()
      const bad = await putCat(p.jwt, { name: 'Cat 2025', look: { coat: 'tabby' }, showOnWall: true })
      expect(bad.status).toBe(400)
      expect(bad.body).toMatchObject({ code: 'BAD_NAME', message: 'Too many numbers in a row.' })
      const ok = await putCat(p.jwt, { name: '  Mochi   Ube ', look: { coat: 'tabby' }, showOnWall: true })
      expect((ok.body as MeView).customer!.cat.name).toBe('Mochi Ube')
      await putCat(p.jwt, { name: '  Mochi  ', look: { coat: 'tabby' }, showOnWall: true })
      const [row] = await db.sql`select name from cats where customer_id = ${p.id}`
      expect(row!.name).toBe('Mochi')
    })

    it('a switched-off item already owned can still be equipped, and leaves the shop', async () => {
      const p = await member(50)
      expect((await buy(p.jwt, 'fish')).status).toBe(200)
      await db.sql`update cosmetics set is_active = false where key = 'fish'`
      try {
        const r = await putCat(p.jwt, { name: 'Ube', look: { coat: 'tabby', held: 'fish' }, showOnWall: true })
        expect(r.status).toBe(200)
        expect((r.body as MeView).customer!.owned).toContain('fish')
        const shop = (await call('GET', '/v1/cosmetics')).body as unknown as CosmeticView[]
        expect(shop.map((x) => x.key)).not.toContain('fish')
      } finally {
        await db.sql`update cosmetics set is_active = true where key = 'fish'`
      }
    })

    it('without a card: 404 NOT_JOINED', async () => {
      const p = await person()
      const r = await putCat(p.jwt, { name: 'Ube', look: { coat: 'tabby' }, showOnWall: true })
      expect(r.status).toBe(404)
      expect(r.body.code).toBe('NOT_JOINED')
    })

    it('visitEndsAt: the visit end while it is later than now, else null', async () => {
      const p = await member()
      await db.sql`insert into visits (customer_id, visit_key, source, started_at, ends_at)
        values (${p.id}, ${randomUUID()}, 'checkin', ${NOW}, '2026-11-21T03:30:00Z')`
      expect((await me(p.jwt)).cat.visitEndsAt).toBe('2026-11-21T03:30:00.000Z')
      now = new Date('2026-11-21T03:30:00Z')
      try {
        expect((await me(p.jwt)).cat.visitEndsAt).toBeNull()
      } finally {
        now = NOW
      }
    })
  })

  describe('the cat comes with the card', () => {
    it('join gives a cat with a starter name and a starter coat; owned is the 4 starter coats', async () => {
      const p = await member()
      const c: Customer = await me(p.jwt)
      expect(STARTER_CAT_NAMES).toContain(c.cat.name)
      expect(STARTER_COATS).toContain(c.cat.look.coat)
      expect(Object.keys(c.cat.look)).toEqual(['coat'])
      expect(c.cat).toMatchObject({ showOnWall: true, hiddenByAdmin: false, visitEndsAt: null })
      expect(c.owned).toEqual([...STARTER_COATS].sort())
      const [n] = await db.sql`select count(*)::int as n from cats where customer_id = ${p.id}`
      expect(n!.n).toBe(1)
    })

    it('a customer row without a cat (the old-API gap) gets one on GET /v1/me', async () => {
      const p = await person()
      await db.sql`insert into customers (id, public_code, display_name, age_confirmed_at, privacy_accepted_at, privacy_version, created_at)
        values (${p.id}, '23456789A', 'Gap', ${NOW}, ${NOW}, '2026-11', ${NOW})`
      const c = await me(p.jwt)
      expect(STARTER_CAT_NAMES).toContain(c.cat.name)
      expect(STARTER_COATS).toContain(c.cat.look.coat)
    })

    it('ensureCat uses the given pick and never replaces a cat', async () => {
      const p = await person()
      await db.sql`insert into customers (id, public_code, display_name, age_confirmed_at, privacy_accepted_at, privacy_version, created_at)
        values (${p.id}, '3456789AB', 'Pick', ${NOW}, ${NOW}, '2026-11', ${NOW})`
      // The check symbol may be wrong for this code; ensureCat does not care.
      await db.sql.begin((tx) => ensureCat(tx, p.id, NOW, { randomInt: (max) => max - 1 }))
      await db.sql.begin((tx) => ensureCat(tx, p.id, NOW, { randomInt: () => 0 }))
      const [row] = await db.sql`select name, equipped from cats where customer_id = ${p.id}`
      expect(row).toEqual({ name: STARTER_CAT_NAMES.at(-1), equipped: { coat: STARTER_COATS.at(-1) } })
      expect(await db.sql.begin((tx) => ownedKeys(tx, p.id))).toEqual([...STARTER_COATS].sort())
    })
  })

  describe('GET /v1/cosmetics', () => {
    it('public, cached for 60s, the active items by slot then sort order, no customer data', async () => {
      const r = await call('GET', '/v1/cosmetics')
      expect(r.status).toBe(200)
      expect(r.headers.get('cache-control')).toBe('public, max-age=60')
      const list = r.body as unknown as CosmeticView[]
      expect(list).toHaveLength(22)
      expect(list.map((x) => x.key)).toEqual([
        'ginger', 'tabby', 'black', 'cream', 'tuxedo', 'white', 'calico', 'siamese',
        'beanie', 'party-hat', 'visor', 'flower-crown', 'crown',
        'blush', 'round-glasses', 'sunnies',
        'bandana', 'bow-tie', 'bell-collar',
        'kennko-cup', 'croissant', 'fish',
      ])
      expect(list[8]).toEqual({
        id: ids.beanie,
        key: 'beanie',
        slot: 'hat',
        name: 'Beanie',
        pricePoints: 40,
        isStarter: false,
        isActive: true,
        sortOrder: 9,
      })
      expect(JSON.stringify(r.body)).not.toMatch(/customer|owned|points"/)
    })

    it('slot order wins over sort order', async () => {
      await db.sql`update cosmetics set sort_order = 0 where key = 'fish'`
      try {
        const list = (await call('GET', '/v1/cosmetics')).body as unknown as CosmeticView[]
        expect(list.at(-1)!.key).toBe('croissant')
        expect(list.findIndex((x) => x.key === 'fish')).toBe(19)
      } finally {
        await db.sql`update cosmetics set sort_order = 22 where key = 'fish'`
      }
    })
  })
})

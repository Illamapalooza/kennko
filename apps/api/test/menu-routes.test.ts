import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import type { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/create-app.js'
import { verifierFromJwks, type AppEnv } from '../src/auth.js'
import { fakeProofs, inlineDefer } from './fakes.js'
import { startTestDb, type TestDb } from './pg.js'

const ISSUER = 'http://supabase.test/auth/v1'
const OWNER = '00000000-0000-4000-8000-000000000001'

describe('menu routes', () => {
  let db: TestDb
  let app: Hono<AppEnv>
  let token: string
  let variantId: string

  beforeAll(async () => {
    db = await startTestDb()
    await db.sql
      .unsafe(
        `insert into auth.users (id, email) values ('${OWNER}', 'o@x.test');
         insert into staff (id, email, full_name, role, is_active) values ('${OWNER}', 'o@x.test', 'Owner', 'owner', true);`,
      )
      .simple()
    const { publicKey, privateKey } = await generateKeyPair('ES256')
    const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' }
    token = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setSubject(OWNER)
      .setIssuer(ISSUER)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)
    app = createApp({
      sql: db.sql,
      verifyUser: verifierFromJwks(createLocalJWKSet({ keys: [jwk] }), ISSUER),
      proofs: fakeProofs(),
      push: null,
      defer: inlineDefer,
      now: () => new Date(),
    })

    const [cat] = await db.sql`insert into menu_categories (name, sort_order) values ('Coffee', 0) returning id`
    const [item] = await db.sql`insert into menu_items (category_id, name) values (${cat!.id}, 'Americano') returning id`
    const [v] = await db.sql`insert into menu_variants (item_id, code, label, price_centavos, temperature)
      values (${item!.id}, 'M', 'Medium', 8000, 'iced') returning id`
    variantId = v!.id
  })
  afterAll(async () => {
    await db.stop()
  })

  const publish = () => app.request('/v1/menu/publish', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
  type Snap = { version: number; categories: { name: string; items: { id: string; isAvailable: boolean; variants: { isAvailable: boolean }[] }[] }[] }

  it('no snapshot -> 404 NO_MENU', async () => {
    const res = await app.request('/v1/menu')
    expect(res.status).toBe(404)
    expect(((await res.json()) as { code: string }).code).toBe('NO_MENU')
  })

  it('publish without a token -> 401, as owner -> version', async () => {
    expect((await app.request('/v1/menu/publish', { method: 'POST' })).status).toBe(401)
    const res = await publish()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ version: 1, created: true })
  })

  it('latest menu after a publish', async () => {
    const res = await app.request('/v1/menu')
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=30, stale-while-revalidate=300')
    expect(res.headers.get('ETag')).toMatch(/^"v1-[0-9a-f]{8}"$/)
    const body = (await res.json()) as Snap
    expect(body.version).toBe(1)
    expect(body.categories.find((c) => c.name === 'Coffee')!.items[0]!.variants[0]!.isAvailable).toBe(true)
  })

  it('marking a variant sold out shows without a publish and changes the ETag', async () => {
    const before = (await app.request('/v1/menu')).headers.get('ETag')
    await db.sql`update menu_variants set is_available = false where id = ${variantId}`
    const res = await app.request('/v1/menu')
    const body = (await res.json()) as Snap
    expect(body.version).toBe(1)
    expect(body.categories.find((c) => c.name === 'Coffee')!.items[0]!.variants[0]!.isAvailable).toBe(false)
    expect(res.headers.get('ETag')).not.toBe(before)
  })

  it('If-None-Match with the current ETag -> 304', async () => {
    const etag = (await app.request('/v1/menu')).headers.get('ETag')!
    const res = await app.request('/v1/menu', { headers: { 'If-None-Match': etag } })
    expect(res.status).toBe(304)
    const weak = await app.request('/v1/menu', { headers: { 'If-None-Match': `W/${etag}` } })
    expect(weak.status).toBe(304)
    const multi = await app.request('/v1/menu', { headers: { 'If-None-Match': `"v0-00000000", ${etag}` } })
    expect(multi.status).toBe(304)
    expect((await app.request('/v1/menu', { headers: { 'If-None-Match': '*' } })).status).toBe(304)
    expect(await res.text()).toBe('')
    expect(res.headers.get('ETag')).toBe(etag)
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=30, stale-while-revalidate=300')
    const stale = await app.request('/v1/menu', { headers: { 'If-None-Match': '"v0-00000000"' } })
    expect(stale.status).toBe(200)
  })

  it('overlays sold-out items and options too, and back to available', async () => {
    const [opt] = await db.sql`select o.id from options o limit 1`
    const [item] = await db.sql`select id from menu_items limit 1`
    const flat = async () => {
      const b = (await (await app.request('/v1/menu')).json()) as Snap & { optionGroups: { options: { id: string; isAvailable: boolean }[] }[] }
      return { item: b.categories.flatMap((c) => c.items).find((i) => i.id === item!.id)!.isAvailable, opt: b.optionGroups.flatMap((g) => g.options).find((o) => o.id === opt!.id)?.isAvailable }
    }
    const etag0 = (await app.request('/v1/menu')).headers.get('ETag')
    await db.sql`update menu_items set is_available = false where id = ${item!.id}`
    await db.sql`update options set is_available = false where id = ${opt.id}`
    const off = await flat()
    expect(off.item).toBe(false)
    expect(off.opt).toBe(false)
    await db.sql`update menu_items set is_available = true where id = ${item!.id}`
    await db.sql`update options set is_available = true where id = ${opt.id}`
    const back = await flat()
    expect(back.item).toBe(true)
    expect(back.opt).toBe(true)
    expect((await app.request('/v1/menu')).headers.get('ETag')).toBe(etag0)
  })

  it('a version endpoint ignores later sold-out marks', async () => {
    const res = await app.request('/v1/menu/1')
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    const body = (await res.json()) as Snap
    expect(body.version).toBe(1)
    expect(body.categories.find((c) => c.name === 'Coffee')!.items[0]!.variants[0]!.isAvailable).toBe(true)
  })

  it('unknown version -> 404, non-integer -> 400', async () => {
    const missing = await app.request('/v1/menu/99')
    expect(missing.status).toBe(404)
    expect(((await missing.json()) as { code: string }).code).toBe('NO_SUCH_VERSION')
    for (const v of ['abc', '1.5', '-1', '0', '01', '1e3', '99999999999999999999']) {
      const res = await app.request(`/v1/menu/${v}`)
      expect(res.status).toBe(400)
      expect(((await res.json()) as { code: string }).code).toBe('BAD_VERSION')
    }
  })
})

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import type { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/create-app.js'
import { verifierFromJwks, type AppEnv } from '../src/auth.js'
import { fakeProofs, inlineDefer } from './fakes.js'
import { startTestDb, type TestDb } from './pg.js'

const ISSUER = 'http://supabase.test/auth/v1'
const OWNER = '00000000-0000-4000-8000-000000000001'

type Status = { publishedVersion: number | null; publishedAt: string | null; hasUnpublishedChanges: boolean }

describe('menu status', () => {
  let db: TestDb
  let app: Hono<AppEnv>
  let token: string
  let variantId: string

  beforeAll(async () => {
    db = await startTestDb()
    await db.sql
      .unsafe(
        `insert into auth.users (id, email) values ('${OWNER}', 'o@x.test');
         insert into staff (id, user_id, email, full_name, role, is_active) values ('${OWNER}', '${OWNER}', 'o@x.test', 'Owner', 'owner', true);`,
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

  const status = async () => {
    const res = await app.request('/v1/menu/status', { headers: { Authorization: `Bearer ${token}` } })
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    return (await res.json()) as Status
  }
  const publish = () => app.request('/v1/menu/publish', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })

  it('no token -> 401', async () => {
    expect((await app.request('/v1/menu/status')).status).toBe(401)
  })

  it('no snapshot -> unpublished', async () => {
    expect(await status()).toEqual({ publishedVersion: null, publishedAt: null, hasUnpublishedChanges: true })
  })

  it('right after publish -> no changes', async () => {
    await publish()
    const s = await status()
    expect(s.publishedVersion).toBe(1)
    expect(s.publishedAt).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect(s.hasUnpublishedChanges).toBe(false)
  })

  it('a sold-out toggle alone -> no changes', async () => {
    await db.sql`update menu_variants set is_available = false where id = ${variantId}`
    expect((await status()).hasUnpublishedChanges).toBe(false)
    await db.sql`update menu_variants set is_available = true where id = ${variantId}`
  })

  it('after a price change -> changes; after publishing again -> none', async () => {
    await db.sql`update menu_variants set price_centavos = 9000 where id = ${variantId}`
    expect((await status()).hasUnpublishedChanges).toBe(true)
    await publish()
    const s = await status()
    expect(s.publishedVersion).toBe(2)
    expect(s.hasUnpublishedChanges).toBe(false)
  })
})

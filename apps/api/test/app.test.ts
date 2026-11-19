import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { startTestDb, type TestDb } from './pg.ts'

describe('app skeleton', () => {
  let db: TestDb
  beforeAll(async () => {
    db = await startTestDb()
  })
  afterAll(async () => {
    await db.stop()
  })

  const build = () =>
    createApp({
      sql: db.sql,
      verifyUser: async () => {
        throw new Error('not used')
      },
    })

  it('GET /health answers {ok:true} when the database answers', async () => {
    const res = await build().request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it("an unknown route answers 404 {code:'NOT_FOUND'}", async () => {
    const res = await build().request('/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('loadConfig', () => {
  it('names the missing variable', () => {
    expect(() => loadConfig({ SUPABASE_URL: 'https://x.supabase.co' })).toThrow(/DATABASE_URL/)
    expect(() => loadConfig({ DATABASE_URL: 'postgres://u:p@h:5432/d' })).toThrow(/SUPABASE_URL/)
  })

  it('returns the config when both are set', () => {
    expect(
      loadConfig({ DATABASE_URL: 'postgres://u:p@h:5432/d', SUPABASE_URL: 'https://x.supabase.co' }),
    ).toEqual({ databaseUrl: 'postgres://u:p@h:5432/d', supabaseUrl: 'https://x.supabase.co' })
  })
})

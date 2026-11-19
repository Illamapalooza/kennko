import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/create-app.js'
import { loadConfig } from '../src/config.js'
import { fakeProofs } from './fakes.js'
import { startTestDb, type TestDb } from './pg.js'

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
      proofs: fakeProofs(),
      now: () => new Date(),
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
  const env = {
    DATABASE_URL: 'postgres://u:p@h:5432/d',
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  }

  it('names the missing variable', () => {
    expect(() => loadConfig({ ...env, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/)
    expect(() => loadConfig({ ...env, SUPABASE_URL: undefined })).toThrow(/SUPABASE_URL/)
    expect(() => loadConfig({ ...env, SUPABASE_SERVICE_ROLE_KEY: undefined })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
    expect(() => loadConfig({ ...env, SUPABASE_SERVICE_ROLE_KEY: '' })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/)
  })

  it('returns the config when all are set', () => {
    expect(loadConfig(env)).toEqual({
      databaseUrl: 'postgres://u:p@h:5432/d',
      supabaseUrl: 'https://x.supabase.co',
      supabaseServiceRoleKey: 'service-key',
    })
  })
})

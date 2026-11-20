import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/create-app.js'
import { loadConfig } from '../src/config.js'
import { fakeAuthAdmin, fakeProofs, inlineDefer } from './fakes.js'
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
      authAdmin: fakeAuthAdmin(),
      push: null,
      defer: inlineDefer,
      now: () => new Date(),
      webKey: null,
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
      vapid: null,
      webKey: null,
    })
  })

  it('reads KENNKO_WEB_KEY (32+ characters), treats blank as unset, and never echoes it', () => {
    expect(loadConfig({ ...env, KENNKO_WEB_KEY: 'k'.repeat(32) }).webKey).toBe('k'.repeat(32))
    expect(loadConfig({ ...env, KENNKO_WEB_KEY: '' }).webKey).toBeNull()
    expect(() => loadConfig({ ...env, KENNKO_WEB_KEY: 'k'.repeat(31) })).toThrow(/^Missing or invalid environment variable: KENNKO_WEB_KEY$/)
    // Spaces do not count: a key of blanks, or a short key padded out, fails boot.
    expect(() => loadConfig({ ...env, KENNKO_WEB_KEY: ' '.repeat(40) })).toThrow(/KENNKO_WEB_KEY/)
    expect(() => loadConfig({ ...env, KENNKO_WEB_KEY: ` ${'k'.repeat(31)} ` })).toThrow(/KENNKO_WEB_KEY/)
  })

  it('reads VAPID keys when all three are set, treats blank as unset', () => {
    const vapid = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:a@x.test' }
    expect(loadConfig({ ...env, ...vapid }).vapid).toEqual({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@x.test' })
    expect(loadConfig({ ...env, VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: '' }).vapid).toBeNull()
  })

  it.each([
    [{ VAPID_PUBLIC_KEY: 'pub' }],
    [{ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' }],
    [{ VAPID_SUBJECT: 'mailto:a@x.test', VAPID_PRIVATE_KEY: 'priv' }],
  ])('a partial VAPID set %o warns and turns push off instead of throwing', (partial) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(loadConfig({ ...env, ...partial }).vapid).toBeNull()
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/VAPID/))
    } finally {
      warn.mockRestore()
    }
  })
})

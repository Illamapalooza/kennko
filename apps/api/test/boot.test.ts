import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as webpush from 'web-push'
import { buildApp } from '../src/boot.js'

// Dummy values only: nothing here connects (postgres, the JWKS and storage are all lazy).
const env = {
  DATABASE_URL: 'postgres://u:p@127.0.0.1:1/d',
  SUPABASE_URL: 'https://x.supabase.test',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
}
const keys = webpush.generateVAPIDKeys()
const good = { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:a@x.test' }

const publicKey = async (extra: Record<string, string>) => {
  const res = await buildApp({ ...env, ...extra }).request('/v1/push/public-key')
  return { status: res.status, body: (await res.json()) as { publicKey?: string; code?: string } }
}

describe('buildApp', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('valid VAPID settings -> push on', async () => {
    expect(await publicKey(good)).toEqual({ status: 200, body: { publicKey: keys.publicKey } })
  })

  it('no VAPID settings -> boots with push off', async () => {
    expect((await publicKey({})).status).toBe(404)
  })

  it.each([
    [{ VAPID_PUBLIC_KEY: keys.publicKey }],
    [{ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey }],
  ])('partial VAPID settings -> boots with push off', async (partial) => {
    expect((await publicKey(partial)).status).toBe(404)
  })

  it.each([
    ['a subject that is not a URL', { ...good, VAPID_SUBJECT: 'not a url' }],
    ['a short public key', { ...good, VAPID_PUBLIC_KEY: 'abc' }],
    ['a short private key', { ...good, VAPID_PRIVATE_KEY: 'abc' }],
  ])('%s -> boots with push off and logs why', async (_label, bad) => {
    const r = await publicKey(bad)
    expect(r.status).toBe(404)
    expect(console.error).toHaveBeenCalled()
  })

  it('push off -> subscribe answers 503 PUSH_UNAVAILABLE', async () => {
    const res = await buildApp({ ...env, ...good, VAPID_SUBJECT: 'nope' }).request('/v1/push/subscriptions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscription: {}, orderCode: 'KNK-1' }),
    })
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ code: 'PUSH_UNAVAILABLE' })
  })
})

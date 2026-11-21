import { describe, expect, it } from 'vitest'
import { nativeFetch } from '../src/app/native-fetch.ts'

describe('nativeFetch', () => {
  it('keeps the Date header', async () => {
    const f = nativeFetch({
      request: async () => ({
        status: 200,
        headers: { Date: 'Sun, 22 Nov 2026 02:00:00 GMT', 'Content-Type': 'application/json' },
        data: '{"ok":true}',
        url: 'https://api.kennko.test/v1/sync/pull',
      }),
    })
    const res = await f('https://api.kennko.test/v1/sync/pull')
    expect(res.headers.get('date')).toBe('Sun, 22 Nov 2026 02:00:00 GMT')
    expect(await res.json()).toEqual({ ok: true })
  })

  it('posts JSON', async () => {
    let seen: any = null
    const f = nativeFetch({
      request: async (opts) => {
        seen = opts
        return { status: 200, headers: {}, data: '{}', url: opts.url }
      },
    })
    await f('https://api.kennko.test/v1/devices/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: '123456' }),
    })
    expect(seen.method).toBe('POST')
    expect(seen.data).toEqual({ code: '123456' })
    expect(seen.headers['content-type']).toBe('application/json')
  })

  it('401 stays a response, not a throw', async () => {
    const f = nativeFetch({
      request: async () => ({ status: 401, headers: {}, data: { code: 'DEVICE_REVOKED' }, url: 'https://x' }),
    })
    const res = await f('https://x')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ code: 'DEVICE_REVOKED' })
  })

  it('abort rejects with AbortError within 10 ms', async () => {
    const f = nativeFetch({
      request: () => new Promise(() => {}),
    })
    const controller = new AbortController()
    const started = Date.now()
    const p = f('https://x', { signal: controller.signal })
    setTimeout(() => controller.abort(), 5)
    let err: any
    try {
      await p
    } catch (e) {
      err = e
    }
    expect(err?.name).toBe('AbortError')
    expect(Date.now() - started).toBeLessThan(50)
  })

  it('network failure rejects TypeError', async () => {
    const f = nativeFetch({
      request: async () => { throw new Error('java.net.ConnectException') },
    })
    await expect(f('https://x')).rejects.toBeInstanceOf(TypeError)
  })
})

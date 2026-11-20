import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAuthAdmin } from '../src/auth-admin.js'

type Call = { url: string; init: RequestInit }

function mockFetch(responses: Response[]): Call[] {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init })
      return responses.shift() ?? new Response('{}', { status: 200 })
    }),
  )
  return calls
}

const headersOf = (c: Call) => new Headers(c.init.headers)
const ID = '00000000-0000-4000-8000-0000000000c1'

describe('createAuthAdmin', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const admin = () => createAuthAdmin('https://ref.supabase.co/', 'service-key')
  const expectKeyHeaders = (c: Call) => {
    expect(headersOf(c).get('Authorization')).toBe('Bearer service-key')
    expect(headersOf(c).get('apikey')).toBe('service-key')
  }

  it('getUser reads the admin user and whether the email is confirmed', async () => {
    const calls = mockFetch([
      Response.json({ id: ID, email: 'ana@x.test', email_confirmed_at: '2026-11-01T00:00:00Z' }),
      Response.json({ id: ID, email: 'ana@x.test', email_confirmed_at: null }),
      Response.json({ id: ID, phone: '0917' }),
    ])
    expect(await admin().getUser(ID)).toEqual({ email: 'ana@x.test', emailConfirmed: true })
    expect(await admin().getUser(ID)).toEqual({ email: 'ana@x.test', emailConfirmed: false })
    expect(await admin().getUser(ID)).toEqual({ email: null, emailConfirmed: false })
    expect(calls[0]!.url).toBe(`https://ref.supabase.co/auth/v1/admin/users/${ID}`)
    expect(calls[0]!.init.method ?? 'GET').toBe('GET')
    expectKeyHeaders(calls[0]!)
  })

  it('getUser answers null on 404 and throws on any other failure, without the body', async () => {
    mockFetch([
      new Response('{"msg":"User not found"}', { status: 404 }),
      new Response('{"msg":"ana@x.test boom"}', { status: 500 }),
    ])
    expect(await admin().getUser(ID)).toBeNull()
    const err = await admin().getUser(ID).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('Auth getUser failed (500)')
  })

  it('invite posts the email and returns the new user id', async () => {
    const calls = mockFetch([Response.json({ id: ID, email: 'new@x.test' })])
    expect(await admin().invite('new@x.test')).toEqual({ userId: ID })
    expect(calls[0]!.url).toBe('https://ref.supabase.co/auth/v1/invite')
    expect(calls[0]!.init.method).toBe('POST')
    expect(headersOf(calls[0]!).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ email: 'new@x.test' })
    expectKeyHeaders(calls[0]!)
  })

  it('invite throws on a non-2xx, without echoing the email', async () => {
    mockFetch([new Response('{"msg":"new@x.test already registered"}', { status: 422 })])
    const err = await admin().invite('new@x.test').catch((e: Error) => e)
    expect((err as Error).message).toBe('Auth invite failed (422)')
  })

  it('deleteUser deletes the admin user and throws on 500', async () => {
    const calls = mockFetch([new Response('{}', { status: 200 }), new Response('', { status: 500 })])
    await admin().deleteUser(ID)
    expect(calls[0]!.url).toBe(`https://ref.supabase.co/auth/v1/admin/users/${ID}`)
    expect(calls[0]!.init.method).toBe('DELETE')
    expectKeyHeaders(calls[0]!)
    await expect(admin().deleteUser(ID)).rejects.toThrow('Auth deleteUser failed (500)')
  })
})

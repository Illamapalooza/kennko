import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProofStore } from '../src/storage.js'

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

describe('createProofStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const store = () => createProofStore('https://ref.supabase.co/', 'service-key')

  it('uploads to the payment-proofs bucket with the service key and no upsert', async () => {
    const calls = mockFetch([new Response('{"Key":"x"}', { status: 200 })])
    const bytes = new Uint8Array([1, 2, 3])
    await store().upload('proofs/KNK-ACDEFH/abc.jpg', bytes, 'image/jpeg')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://ref.supabase.co/storage/v1/object/payment-proofs/proofs/KNK-ACDEFH/abc.jpg')
    expect(calls[0]!.init.method).toBe('POST')
    const h = headersOf(calls[0]!)
    expect(h.get('Authorization')).toBe('Bearer service-key')
    expect(h.get('apikey')).toBe('service-key')
    expect(h.get('Content-Type')).toBe('image/jpeg')
    expect(h.get('x-upsert')).toBe('false')
  })

  it('a failed upload throws', async () => {
    mockFetch([new Response('{"message":"exists"}', { status: 409 })])
    await expect(store().upload('proofs/a/b.jpg', new Uint8Array([1]), 'image/jpeg')).rejects.toThrow(/409/)
  })

  it('removes with DELETE and a prefixes body', async () => {
    const calls = mockFetch([new Response('[]', { status: 200 })])
    await store().remove('proofs/KNK-ACDEFH/abc.jpg')
    expect(calls[0]!.url).toBe('https://ref.supabase.co/storage/v1/object/payment-proofs')
    expect(calls[0]!.init.method).toBe('DELETE')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ prefixes: ['proofs/KNK-ACDEFH/abc.jpg'] })
    const h = headersOf(calls[0]!)
    expect(h.get('Authorization')).toBe('Bearer service-key')
    expect(h.get('apikey')).toBe('service-key')
    expect(h.get('Content-Type')).toBe('application/json')
  })

  it('a failed remove throws', async () => {
    mockFetch([new Response('nope', { status: 500 })])
    await expect(store().remove('proofs/a/b.jpg')).rejects.toThrow(/500/)
  })

  it('signs a URL and returns it absolute', async () => {
    const calls = mockFetch([
      Response.json({ signedURL: '/object/sign/payment-proofs/proofs/a/b.jpg?token=t' }),
    ])
    const url = await store().signedUrl('proofs/a/b.jpg', 600)
    expect(calls[0]!.url).toBe('https://ref.supabase.co/storage/v1/object/sign/payment-proofs/proofs/a/b.jpg')
    expect(calls[0]!.init.method).toBe('POST')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ expiresIn: 600 })
    expect(headersOf(calls[0]!).get('Authorization')).toBe('Bearer service-key')
    expect(url).toBe('https://ref.supabase.co/storage/v1/object/sign/payment-proofs/proofs/a/b.jpg?token=t')
  })

  it('a failed sign throws', async () => {
    mockFetch([new Response('nope', { status: 404 })])
    await expect(store().signedUrl('proofs/a/b.jpg', 60)).rejects.toThrow(/404/)
  })
})

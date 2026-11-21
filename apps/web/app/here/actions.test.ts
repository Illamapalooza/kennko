import { beforeEach, describe, expect, it, vi } from 'vitest'

const userFetch = vi.fn()
vi.mock('@/lib/api/client', () => ({ userFetch: (...a: unknown[]) => userFetch(...a) }))

import { checkIn } from './actions'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const err = vi.spyOn(console, 'error').mockImplementation(() => {})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('checkIn', () => {
  it('maps 401 to SIGNED_OUT without logging', async () => {
    userFetch.mockResolvedValue(json(401, {}))
    expect(await checkIn('abcd2345')).toEqual({ status: 'error', reason: 'SIGNED_OUT' })
    expect(err).not.toHaveBeenCalled()
  })
  it('maps the signed-out throw to SIGNED_OUT without logging', async () => {
    userFetch.mockRejectedValue(new Error('You are not signed in.'))
    expect(await checkIn('abcd2345')).toEqual({ status: 'error', reason: 'SIGNED_OUT' })
    expect(err).not.toHaveBeenCalled()
  })
  it('keeps a network error as FAILED', async () => {
    userFetch.mockRejectedValue(new Error('fetch failed'))
    expect(await checkIn('abcd2345')).toEqual({ status: 'error', reason: 'FAILED' })
  })
  it('maps 429 and a good answer', async () => {
    userFetch.mockResolvedValue(json(429, {}))
    expect(await checkIn('abcd2345')).toEqual({ status: 'error', reason: 'RATE_LIMITED' })
    userFetch.mockResolvedValue(json(200, { onWall: true, endsAt: '2026-11-21T07:30:00.000Z' }))
    expect(await checkIn('abcd2345')).toEqual({ status: 'ok', onWall: true, endsAt: '2026-11-21T07:30:00.000Z' })
  })
})

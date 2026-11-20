import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MeView } from '@kennko/core'

const userFetch = vi.fn()
vi.mock('@/lib/api/client', () => ({ userFetch: (...a: unknown[]) => userFetch(...a) }))

import { loadMe, stampCircles } from './me'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

type Customer = NonNullable<MeView['customer']>
const customer = (card: Customer['card']): Customer => ({
  publicCode: 'KC-7F3-K9Q-XAM',
  displayName: 'Ana',
  joinedAt: '2026-11-01T00:00:00.000Z',
  stampMode: card ? 'digital' : 'paper',
  card,
  points: 4,
})

beforeEach(() => vi.clearAllMocks())

describe('loadMe', () => {
  it('returns the view from /v1/me', async () => {
    const view: MeView = { customer: customer({ stamps: [], fullCards: 0 }) }
    userFetch.mockResolvedValue(json(200, view))
    expect(await loadMe()).toEqual(view)
    expect(userFetch).toHaveBeenCalledWith('/v1/me')
  })

  it('returns a view with no customer as it is', async () => {
    userFetch.mockResolvedValue(json(200, { customer: null }))
    expect(await loadMe()).toEqual({ customer: null })
  })

  it('throws on a 500', async () => {
    userFetch.mockResolvedValue(json(500, { error: 'x' }))
    await expect(loadMe()).rejects.toThrow('Could not load your Kennko card')
  })
})

describe('stampCircles', () => {
  it('shows 3 stamps as 3 filled with dates and 5 empty', () => {
    const c = customer({
      stamps: [
        { stampedAt: '2026-11-02T02:00:00.000Z' },
        { stampedAt: '2026-11-05T02:00:00.000Z' },
        { stampedAt: '2026-11-09T02:00:00.000Z' },
      ],
      fullCards: 0,
    })
    const r = stampCircles(c.card!)
    expect(r.circles).toHaveLength(8)
    expect(r.circles.filter((x) => x.filled)).toHaveLength(3)
    expect(r.circles[0]!.date).toBe('Nov 2')
    expect(r.circles[3]).toEqual({ filled: false, date: null })
    expect(r.freeDrinkReady).toBe(false)
  })

  it('shows a waiting full card as 8 filled and a free drink ready', () => {
    const r = stampCircles({ stamps: [{ stampedAt: '2026-11-02T02:00:00.000Z' }], fullCards: 1 })
    expect(r.circles).toHaveLength(8)
    expect(r.circles.every((x) => x.filled)).toBe(true)
    expect(r.freeDrinkReady).toBe(true)
  })

  it('shows an empty card as 8 empty circles', () => {
    const r = stampCircles({ stamps: [], fullCards: 0 })
    expect(r.circles).toHaveLength(8)
    expect(r.circles.some((x) => x.filled)).toBe(false)
  })
})

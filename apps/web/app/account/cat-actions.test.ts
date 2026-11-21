import { beforeEach, describe, expect, it, vi } from 'vitest'

const userFetch = vi.fn()
const revalidatePath = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }))
vi.mock('@/lib/api/client', () => ({ userFetch: (...a: unknown[]) => userFetch(...a) }))

import { buyCosmetic, saveCat } from './cat-actions'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const form = (values: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(values)) f.set(k, v)
  return f
}
const sent = () => JSON.parse(userFetch.mock.calls[0]![1].body as string)

beforeEach(() => vi.clearAllMocks())

describe('saveCat', () => {
  it('puts the name, the look and the switch, leaving empty slots out', async () => {
    userFetch.mockResolvedValue(json(200, {}))
    const r = await saveCat(form({ name: '  Mochi ', coat: 'tabby', hat: 'beanie', face: '', showOnWall: 'on' }))
    expect(r).toEqual({ ok: true })
    expect(userFetch.mock.calls[0]![0]).toBe('/v1/me/cat')
    expect(userFetch.mock.calls[0]![1].method).toBe('PUT')
    expect(sent()).toEqual({ name: 'Mochi', look: { coat: 'tabby', hat: 'beanie' }, showOnWall: true })
    expect(revalidatePath).toHaveBeenCalledWith('/account')
  })

  it('sends showOnWall false when the switch is off', async () => {
    userFetch.mockResolvedValue(json(200, {}))
    await saveCat(form({ name: 'Mochi', coat: 'tabby' }))
    expect(sent().showOnWall).toBe(false)
  })

  it('refuses a bad name without a call', async () => {
    const r = await saveCat(form({ name: '09171234567', coat: 'tabby' }))
    expect(r.ok).toBe(false)
    expect(userFetch).not.toHaveBeenCalled()
  })

  it('shows the API name message on 400 BAD_NAME', async () => {
    userFetch.mockResolvedValue(json(400, { code: 'BAD_NAME', message: 'Up to 16 letters or numbers.' }))
    expect(await saveCat(form({ name: 'Mochi', coat: 'tabby' }))).toEqual({ ok: false, message: 'Up to 16 letters or numbers.' })
  })

  it('maps 409 NOT_OWNED to "Buy it first."', async () => {
    userFetch.mockResolvedValue(json(409, { code: 'NOT_OWNED', message: 'x' }))
    expect(await saveCat(form({ name: 'Mochi', coat: 'tabby', hat: 'crown' }))).toEqual({ ok: false, message: 'Buy it first.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('has friendly copy for a network failure', async () => {
    userFetch.mockRejectedValue(new Error('timeout'))
    const r = await saveCat(form({ name: 'Mochi', coat: 'tabby' }))
    expect(r.ok).toBe(false)
  })
})

describe('buyCosmetic', () => {
  it('posts to the buy route and refreshes', async () => {
    userFetch.mockResolvedValue(json(200, {}))
    expect(await buyCosmetic('abc')).toEqual({ ok: true })
    expect(userFetch.mock.calls[0]![0]).toBe('/v1/me/cosmetics/abc/buy')
    expect(userFetch.mock.calls[0]![1].method).toBe('POST')
    expect(revalidatePath).toHaveBeenCalledWith('/account')
  })

  it('maps 409 NOT_ENOUGH_POINTS to "You need N more points."', async () => {
    userFetch.mockResolvedValue(json(409, { code: 'NOT_ENOUGH_POINTS', message: 'You need 12 more points.' }))
    expect(await buyCosmetic('abc')).toEqual({ ok: false, message: 'You need 12 more points.' })
  })

  it('falls back when the points message is missing', async () => {
    userFetch.mockResolvedValue(json(409, { code: 'NOT_ENOUGH_POINTS' }))
    const r = await buyCosmetic('abc')
    expect(r).toEqual({ ok: false, message: 'You need more points for that.' })
  })

  it('maps UNKNOWN_COSMETIC', async () => {
    userFetch.mockResolvedValue(json(404, { code: 'UNKNOWN_COSMETIC' }))
    expect((await buyCosmetic('abc')).ok).toBe(false)
  })
})

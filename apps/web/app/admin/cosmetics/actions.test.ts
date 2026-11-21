import { beforeEach, describe, expect, it, vi } from 'vitest'

const staffFetch = vi.fn()
const revalidatePath = vi.fn()
const requireOwner = vi.fn(async () => ({ id: 's1', role: 'owner' }))

vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }))
vi.mock('@/lib/auth/session', () => ({ requireOwner: () => requireOwner() }))
vi.mock('@/lib/api/client', () => ({ staffFetch: (...a: unknown[]) => staffFetch(...a) }))

import { saveCosmetic } from './actions'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const sent = () => ({
  path: staffFetch.mock.calls[0]![0] as string,
  method: staffFetch.mock.calls[0]![1].method as string,
  body: JSON.parse(staffFetch.mock.calls[0]![1].body as string),
})
const ID = '0b7c1f0e-1111-4222-8333-444455556666'

beforeEach(() => {
  vi.clearAllMocks()
  requireOwner.mockResolvedValue({ id: 's1', role: 'owner' })
})

describe('saveCosmetic', () => {
  it('sends the price as an integer, with the name, the switch and the order', async () => {
    staffFetch.mockResolvedValue(json(200, {}))
    const r = await saveCosmetic(ID, { name: ' Party hat ', price: '50', isActive: true, sortOrder: '3' })
    expect(r).toEqual({ ok: true })
    const s = sent()
    expect(s.path).toBe(`/v1/cosmetics/${ID}`)
    expect(s.method).toBe('PATCH')
    expect(s.body).toEqual({ name: 'Party hat', pricePoints: 50, isActive: true, sortOrder: 3 })
    expect(Number.isInteger(s.body.pricePoints)).toBe(true)
    expect(revalidatePath).toHaveBeenCalledWith('/admin/cosmetics')
  })

  it('refuses a price that is not whole points, without a call', async () => {
    for (const price of ['4.5', '-1', '', 'abc', '10001', '1e2']) {
      const r = await saveCosmetic(ID, { name: 'Hat', price, isActive: true, sortOrder: '0' })
      expect(r.ok, price).toBe(false)
    }
    expect(staffFetch).not.toHaveBeenCalled()
  })

  it('refuses an empty name or an order that is not a whole number', async () => {
    expect((await saveCosmetic(ID, { name: '  ', price: '5', isActive: true, sortOrder: '0' })).ok).toBe(false)
    expect((await saveCosmetic(ID, { name: 'Hat', price: '5', isActive: true, sortOrder: '1.5' })).ok).toBe(false)
    expect(staffFetch).not.toHaveBeenCalled()
  })

  it('maps 409 STARTER_ITEM to "Starter items stay free and on."', async () => {
    staffFetch.mockResolvedValue(json(409, { code: 'STARTER_ITEM', message: 'A starter item is always free.' }))
    expect(await saveCosmetic(ID, { name: 'Ginger', price: '10', isActive: true, sortOrder: '0' })).toEqual({
      ok: false,
      message: 'Starter items stay free and on.',
    })
  })

  it('is owner only', async () => {
    requireOwner.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(saveCosmetic(ID, { name: 'Hat', price: '5', isActive: true, sortOrder: '0' })).rejects.toThrow()
    expect(staffFetch).not.toHaveBeenCalled()
  })
})

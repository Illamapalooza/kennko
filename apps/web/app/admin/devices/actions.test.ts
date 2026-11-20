import { beforeEach, describe, expect, it, vi } from 'vitest'

const staffFetch = vi.fn()
const revalidatePath = vi.fn()
const requireOwner = vi.fn(async () => ({ id: 's1', role: 'owner' }))

vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }))
vi.mock('@/lib/auth/session', () => ({ requireOwner: () => requireOwner() }))
vi.mock('@/lib/api/client', () => ({ staffFetch: (...a: unknown[]) => staffFetch(...a) }))

import { addTill, revokeTill } from './actions'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  requireOwner.mockResolvedValue({ id: 's1', role: 'owner' })
})

describe('addTill', () => {
  it('posts the trimmed name and returns the code', async () => {
    staffFetch.mockResolvedValue(json(201, { id: 'd1', name: 'Counter till', code: '482913', expiresAt: '2026-11-20T10:10:00.000Z' }))
    const result = await addTill(' Counter till ')
    expect(result).toEqual({ ok: true, code: '482913', expiresAt: '2026-11-20T10:10:00.000Z' })
    expect(staffFetch.mock.calls[0]![0]).toBe('/v1/devices')
    expect(staffFetch.mock.calls[0]![1].method).toBe('POST')
    expect(JSON.parse(staffFetch.mock.calls[0]![1].body as string)).toEqual({ name: 'Counter till' })
    expect(revalidatePath).toHaveBeenCalledWith('/admin/devices')
  })

  it('refuses an empty name without calling the API', async () => {
    expect((await addTill('   ')).ok).toBe(false)
    expect(staffFetch).not.toHaveBeenCalled()
  })

  it('maps a 403 to the owner-only message', async () => {
    staffFetch.mockResolvedValue(json(403, { code: 'FORBIDDEN', message: 'no' }))
    expect(await addTill('Counter till')).toEqual({ ok: false, message: 'Only the owner can add tills.' })
  })

  it('maps a 401 to the session message', async () => {
    staffFetch.mockResolvedValue(json(401, {}))
    expect(await addTill('Counter till')).toEqual({ ok: false, message: 'Your session ended. Sign in again.' })
  })

  it('fails cleanly when the success body has no code', async () => {
    staffFetch.mockResolvedValue(json(201, {}))
    expect((await addTill('Counter till')).ok).toBe(false)
  })

  it('says the server is unreachable when the fetch throws', async () => {
    staffFetch.mockRejectedValue(new Error('network'))
    expect(await addTill('Counter till')).toEqual({ ok: false, message: "Couldn't reach the server. Try again." })
  })
})

describe('revokeTill', () => {
  it('sends DELETE and revalidates', async () => {
    staffFetch.mockResolvedValue(new Response(null, { status: 204 }))
    expect(await revokeTill('d1')).toEqual({ ok: true })
    expect(staffFetch.mock.calls[0]![0]).toBe('/v1/devices/d1')
    expect(staffFetch.mock.calls[0]![1].method).toBe('DELETE')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/devices')
  })

  it('says the till is gone on a 404', async () => {
    staffFetch.mockResolvedValue(json(404, { code: 'NOT_FOUND', message: 'Not found' }))
    expect(await revokeTill('d1')).toEqual({ ok: false, message: 'That till no longer exists. Refresh the page.' })
  })
})

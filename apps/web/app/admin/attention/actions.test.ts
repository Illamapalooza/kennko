import { beforeEach, describe, expect, it, vi } from 'vitest'

const staffFetch = vi.fn()
const revalidatePath = vi.fn()
const requireOwner = vi.fn(async () => ({ id: 's1', role: 'owner' }))

vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }))
vi.mock('@/lib/auth/session', () => ({ requireOwner: () => requireOwner() }))
vi.mock('@/lib/api/client', () => ({ staffFetch: (...a: unknown[]) => staffFetch(...a) }))

import { closeShift, discardEvent, markEventSeen, markOrderSeen, retryTill } from './actions'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
const sent = () => ({ path: staffFetch.mock.calls[0]![0] as string, method: staffFetch.mock.calls[0]![1].method as string, body: JSON.parse(staffFetch.mock.calls[0]![1].body as string) })

beforeEach(() => {
  vi.clearAllMocks()
  requireOwner.mockResolvedValue({ id: 's1', role: 'owner' })
})

describe('discardEvent', () => {
  it('posts the discard and the trimmed note, then revalidates', async () => {
    staffFetch.mockResolvedValue(json(200, { ok: true }))
    expect(await discardEvent('D', 'E', ' duplicate sale ')).toEqual({ ok: true })
    expect(sent()).toEqual({ path: '/v1/attention/events/D/E', method: 'POST', body: { action: 'discard', note: 'duplicate sale' } })
    expect(revalidatePath).toHaveBeenCalledWith('/admin/attention')
  })
  it('refuses an empty note before any call', async () => {
    expect((await discardEvent('D', 'E', '   ')).ok).toBe(false)
    expect(staffFetch).not.toHaveBeenCalled()
  })
  it('refuses a note over 200 characters before any call', async () => {
    expect((await discardEvent('D', 'E', 'x'.repeat(201))).ok).toBe(false)
    expect(staffFetch).not.toHaveBeenCalled()
  })
  it('does not revalidate on failure', async () => {
    staffFetch.mockResolvedValue(json(409, { code: 'NOT_HELD', message: 'Only a held receipt can be set aside.' }))
    expect(await discardEvent('D', 'E', 'n')).toEqual({ ok: false, message: 'That receipt was already dealt with, or is not held. Refresh.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe('markEventSeen', () => {
  it('posts seen with a note', async () => {
    staffFetch.mockResolvedValue(json(200, { ok: true }))
    expect(await markEventSeen('D', 'E', 'checked')).toEqual({ ok: true })
    expect(sent().body).toEqual({ action: 'seen', note: 'checked' })
  })
  it('needs a note', async () => {
    expect((await markEventSeen('D', 'E', '')).ok).toBe(false)
    expect(staffFetch).not.toHaveBeenCalled()
  })
})

describe('retryTill', () => {
  it('posts the retry and revalidates', async () => {
    staffFetch.mockResolvedValue(json(200, { held: 1 }))
    expect(await retryTill('D')).toEqual({ ok: true })
    expect(sent().path).toBe('/v1/attention/devices/D/retry')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/attention')
  })
})

describe('closeShift', () => {
  it('posts the counted cash in centavos with the note', async () => {
    staffFetch.mockResolvedValue(json(200, { ok: true }))
    expect(await closeShift('s1', '1,480.50', 'x')).toEqual({ ok: true })
    expect(sent()).toEqual({ path: '/v1/attention/shifts/s1/close', method: 'POST', body: { countedCentavos: 148050, note: 'x' } })
    expect(revalidatePath).toHaveBeenCalledWith('/admin/attention')
  })
  it('makes no call for a bad number', async () => {
    expect(await closeShift('s1', 'abc', 'x')).toEqual({ ok: false, message: 'Enter the counted cash in pesos.' })
    expect(staffFetch).not.toHaveBeenCalled()
  })
  it('needs a reason', async () => {
    expect((await closeShift('s1', '10', ' ')).ok).toBe(false)
    expect(staffFetch).not.toHaveBeenCalled()
  })
  it('gives ALREADY_CLOSED its message', async () => {
    staffFetch.mockResolvedValue(json(409, { code: 'ALREADY_CLOSED', message: 'This shift is already closed.' }))
    expect(await closeShift('s1', '10', 'x')).toEqual({ ok: false, message: 'That shift is already closed. Refresh.' })
  })
  it('says owner only on a 403', async () => {
    staffFetch.mockResolvedValue(json(403, { code: 'FORBIDDEN', message: 'no' }))
    expect(await closeShift('s1', '10', 'x')).toEqual({ ok: false, message: 'Only the owner can do that.' })
  })
})

describe('owner guard', () => {
  it('makes no call when requireOwner rejects', async () => {
    requireOwner.mockRejectedValue(new Error('redirect'))
    await expect(discardEvent('D', 'E', 'n')).rejects.toThrow('redirect')
    await expect(closeShift('s1', '10', 'x')).rejects.toThrow('redirect')
    expect(staffFetch).not.toHaveBeenCalled()
  })
})

describe('markOrderSeen', () => {
  it('posts to the order and revalidates', async () => {
    staffFetch.mockResolvedValue(json(200, { ok: true }))
    expect(await markOrderSeen('o1')).toEqual({ ok: true })
    expect(sent().path).toBe('/v1/attention/orders/o1/seen')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/attention')
  })
  it('maps NOT_OPEN to a refresh message', async () => {
    staffFetch.mockResolvedValue(json(409, { code: 'NOT_OPEN', message: 'x' }))
    expect((await markOrderSeen('o1')).ok).toBe(false)
  })
})

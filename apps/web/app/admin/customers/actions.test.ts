import { beforeEach, describe, expect, it, vi } from 'vitest'

const staffFetch = vi.fn()
const revalidatePath = vi.fn()
const requireOwner = vi.fn(async () => ({ id: 's1', role: 'owner' }))
const requireManager = vi.fn(async () => ({ id: 's2', role: 'manager' }))

vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }))
vi.mock('@/lib/auth/session', () => ({ requireOwner: () => requireOwner(), requireManager: () => requireManager() }))
vi.mock('@/lib/api/client', () => ({ staffFetch: (...a: unknown[]) => staffFetch(...a) }))

import { adjustPoints, applyStamp, discardStamp, setStampMode } from './actions'
import { parsePoints } from './points'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
const sent = () => ({
  path: staffFetch.mock.calls[0]![0] as string,
  method: staffFetch.mock.calls[0]![1].method as string,
  body: JSON.parse(staffFetch.mock.calls[0]![1].body as string),
})

beforeEach(() => {
  vi.clearAllMocks()
  requireOwner.mockResolvedValue({ id: 's1', role: 'owner' })
  requireManager.mockResolvedValue({ id: 's2', role: 'manager' })
})

describe('parsePoints', () => {
  it('reads signed and bare whole numbers', () => {
    expect(parsePoints('+50')).toBe(50)
    expect(parsePoints('-20')).toBe(-20)
    expect(parsePoints('50')).toBe(50)
    expect(parsePoints(' 10000 ')).toBe(10000)
    expect(parsePoints('-10000')).toBe(-10000)
  })
  it('refuses zero, decimals, junk and anything over 10,000', () => {
    for (const bad of ['0', '+0', '-0', '1.5', '1e3', '', 'abc', '10001', '-10001', '5 0']) {
      expect(parsePoints(bad), bad).toBeNull()
    }
  })
})

describe('setStampMode', () => {
  it('posts the mode and revalidates the list and the detail page', async () => {
    staffFetch.mockResolvedValue(json(200, { stampMode: 'paper', changed: true }))
    expect(await setStampMode('C1', 'paper')).toEqual({ ok: true })
    expect(sent()).toEqual({ path: '/v1/customers/C1/stamp-mode', method: 'POST', body: { mode: 'paper' } })
    expect(revalidatePath).toHaveBeenCalledWith('/admin/customers')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/customers/C1')
  })
  it('explains a free drink waiting', async () => {
    staffFetch.mockResolvedValue(json(409, { code: 'FREE_DRINK_WAITING', message: 'x' }))
    expect(await setStampMode('C1', 'paper')).toEqual({
      ok: false,
      message: 'They have a free drink waiting. Claim it at the till first.',
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
  it('needs a manager', async () => {
    requireManager.mockRejectedValue(new Error('redirect'))
    await expect(setStampMode('C1', 'digital')).rejects.toThrow()
    expect(staffFetch).not.toHaveBeenCalled()
  })
})

describe('adjustPoints', () => {
  it('posts the parsed delta and the trimmed note', async () => {
    staffFetch.mockResolvedValue(json(200, { points: 70 }))
    expect(await adjustPoints('C1', '+50', ' goodwill ')).toEqual({ ok: true, points: 70 })
    expect(sent()).toEqual({ path: '/v1/customers/C1/points', method: 'POST', body: { delta: 50, note: 'goodwill' } })
    expect(revalidatePath).toHaveBeenCalledWith('/admin/customers')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/customers/C1')
  })
  it('sends a negative delta', async () => {
    staffFetch.mockResolvedValue(json(200, { points: -5 }))
    await adjustPoints('C1', '-20', 'mistake')
    expect(sent().body).toEqual({ delta: -20, note: 'mistake' })
  })
  it('refuses a bad amount before any call', async () => {
    for (const bad of ['0', '1.5', '10001', '']) {
      expect(await adjustPoints('C1', bad, 'why')).toEqual({ ok: false, message: 'Enter whole points, up to 10,000.' })
    }
    expect(staffFetch).not.toHaveBeenCalled()
  })
  it('refuses an empty note before any call', async () => {
    expect(await adjustPoints('C1', '5', '   ')).toEqual({ ok: false, message: 'Say why.' })
    expect(staffFetch).not.toHaveBeenCalled()
  })
  it('says only the owner on a 403', async () => {
    staffFetch.mockResolvedValue(json(403, { code: 'FORBIDDEN' }))
    expect(await adjustPoints('C1', '5', 'why')).toEqual({ ok: false, message: 'Only the owner can adjust points.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
  it('checks the owner role first', async () => {
    requireOwner.mockRejectedValue(new Error('redirect'))
    await expect(adjustPoints('C1', '5', 'why')).rejects.toThrow()
    expect(staffFetch).not.toHaveBeenCalled()
  })
})

describe('applyStamp and discardStamp', () => {
  it('applies and revalidates', async () => {
    staffFetch.mockResolvedValue(json(200, { ok: true }))
    expect(await applyStamp('S1')).toEqual({ ok: true })
    expect(sent()).toMatchObject({ path: '/v1/stamps/S1/apply', method: 'POST' })
    expect(revalidatePath).toHaveBeenCalledWith('/admin/customers', 'layout')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/attention')
  })
  it('says to switch them to digital first', async () => {
    staffFetch.mockResolvedValue(json(409, { code: 'STILL_PAPER', message: 'x' }))
    expect(await applyStamp('S1')).toEqual({ ok: false, message: 'Switch them to the digital card first.' })
  })
  it('says a stamp already dealt with', async () => {
    staffFetch.mockResolvedValue(json(409, { code: 'NOT_OPEN', message: 'x' }))
    expect(await discardStamp('S1')).toEqual({ ok: false, message: 'That was already dealt with. Refresh.' })
  })
  it('discards', async () => {
    staffFetch.mockResolvedValue(json(200, { ok: true }))
    expect(await discardStamp('S1')).toEqual({ ok: true })
    expect(sent()).toMatchObject({ path: '/v1/stamps/S1/discard', method: 'POST' })
  })
})

import { setCatHidden } from './actions'

describe('setCatHidden', () => {
  it('posts the flag as a manager and refreshes the customer', async () => {
    staffFetch.mockResolvedValue(json(200, {}))
    const r = await setCatHidden('0b7c1f0e-1111-4222-8333-444455556666', true)
    expect(r).toEqual({ ok: true })
    expect(requireManager).toHaveBeenCalled()
    expect(sent().path).toBe('/v1/customers/0b7c1f0e-1111-4222-8333-444455556666/cat/hidden')
    expect(sent().method).toBe('POST')
    expect(sent().body).toEqual({ hidden: true })
    expect(revalidatePath).toHaveBeenCalledWith('/admin/customers/0b7c1f0e-1111-4222-8333-444455556666')
  })
  it('shows the forbidden wording for a barista-level answer', async () => {
    staffFetch.mockResolvedValue(json(403, {}))
    const r = await setCatHidden('0b7c1f0e-1111-4222-8333-444455556666', false)
    expect(r).toEqual({ ok: false, message: 'Only a manager or the owner can do that.' })
  })
})

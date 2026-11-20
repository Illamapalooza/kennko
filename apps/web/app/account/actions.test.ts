import { beforeEach, describe, expect, it, vi } from 'vitest'

const userFetch = vi.fn()
const revalidatePath = vi.fn()
const signOut = vi.fn(async () => ({ error: null }))
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`)
})

vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }))
vi.mock('next/navigation', () => ({ redirect: (u: string) => redirect(u) }))
vi.mock('@/lib/api/client', () => ({ userFetch: (...a: unknown[]) => userFetch(...a) }))
vi.mock('@/lib/supabase/server', () => ({ getServerClient: async () => ({ auth: { signOut } }) }))

import { deleteAccount, joinKennko, renameCard } from './actions'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const form = (values: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(values)) f.set(k, v)
  return f
}
const sent = () => JSON.parse(userFetch.mock.calls[0]![1].body as string)

beforeEach(() => vi.clearAllMocks())

describe('joinKennko', () => {
  it('asks for both boxes and calls nothing without the age box', async () => {
    const r = await joinKennko(form({ privacy: 'on' }))
    expect(r).toEqual({ ok: false, message: 'Tick both boxes to get your card.' })
    expect(userFetch).not.toHaveBeenCalled()
  })

  it('asks for both boxes without the privacy box', async () => {
    const r = await joinKennko(form({ age: 'on' }))
    expect(r.ok).toBe(false)
    expect(userFetch).not.toHaveBeenCalled()
  })

  it('posts the confirmation and the privacy version, then refreshes', async () => {
    userFetch.mockResolvedValue(json(200, { customer: {} }))
    const r = await joinKennko(form({ age: 'on', privacy: 'on' }))
    expect(r).toEqual({ ok: true })
    expect(userFetch.mock.calls[0]![0]).toBe('/v1/me/join')
    expect(userFetch.mock.calls[0]![1].method).toBe('POST')
    expect(sent()).toEqual({ ageConfirmed: true, privacyVersion: '2026-11' })
    expect(revalidatePath).toHaveBeenCalledWith('/account')
  })

  it('reports a failed join', async () => {
    userFetch.mockResolvedValue(json(500, {}))
    const r = await joinKennko(form({ age: 'on', privacy: 'on' }))
    expect(r.ok).toBe(false)
  })
})

describe('renameCard', () => {
  it('patches the trimmed name', async () => {
    userFetch.mockResolvedValue(json(200, { customer: {} }))
    expect(await renameCard('  Ana  ')).toEqual({ ok: true })
    expect(userFetch.mock.calls[0]![1].method).toBe('PATCH')
    expect(sent()).toEqual({ displayName: 'Ana' })
  })

  it('refuses an empty or over-long name without a call', async () => {
    expect((await renameCard('   ')).ok).toBe(false)
    expect((await renameCard('x'.repeat(41))).ok).toBe(false)
    expect(userFetch).not.toHaveBeenCalled()
  })
})

describe('deleteAccount', () => {
  it('needs DELETE typed exactly', async () => {
    expect(await deleteAccount('delete')).toEqual({ ok: false, message: 'Type DELETE to confirm.' })
    expect(userFetch).not.toHaveBeenCalled()
  })

  it('signs out and goes home on success', async () => {
    userFetch.mockResolvedValue(json(200, { deleted: true }))
    await expect(deleteAccount('DELETE')).rejects.toThrow('REDIRECT:/?account=deleted')
    expect(userFetch.mock.calls[0]![0]).toBe('/v1/me')
    expect(userFetch.mock.calls[0]![1].method).toBe('DELETE')
    expect(sent()).toEqual({ confirm: 'DELETE' })
    expect(signOut).toHaveBeenCalled()
  })

  it('still redirects when sign-out fails after the delete', async () => {
    userFetch.mockResolvedValue(json(200, { deleted: true }))
    signOut.mockRejectedValueOnce(new Error('gone'))
    await expect(deleteAccount('DELETE')).rejects.toThrow('REDIRECT:/?account=deleted')
  })

  it('explains a staff login', async () => {
    userFetch.mockResolvedValue(json(409, { code: 'IS_STAFF' }))
    expect(await deleteAccount('DELETE')).toEqual({
      ok: false,
      message: 'Staff logins are removed by the owner in admin.',
    })
    expect(signOut).not.toHaveBeenCalled()
  })

  it('explains a half-finished delete on 502', async () => {
    userFetch.mockResolvedValue(json(502, { code: 'AUTH_DELETE_FAILED' }))
    const r = await deleteAccount('DELETE')
    expect(r).toEqual({
      ok: false,
      message: 'Your card is deleted, but the sign-in could not be removed. Try again.',
    })
    expect(redirect).not.toHaveBeenCalled()
  })
})

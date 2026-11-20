import { beforeEach, describe, expect, it, vi } from 'vitest'

const staffFetch = vi.fn()
const revalidatePath = vi.fn()
const inviteUserByEmail = vi.fn()
const deleteUser = vi.fn()
const requireOwner = vi.fn(async () => ({ id: 's1', role: 'owner' }))
const serverFrom = vi.fn()

vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }))
vi.mock('@/lib/auth/session', () => ({ requireOwner: () => requireOwner() }))
vi.mock('@/lib/api/client', () => ({ staffFetch: (...a: unknown[]) => staffFetch(...a) }))
vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    auth: {
      admin: {
        inviteUserByEmail: (...a: unknown[]) => inviteUserByEmail(...a),
        deleteUser: (...a: unknown[]) => deleteUser(...a),
      },
    },
  }),
}))
vi.mock('@/lib/supabase/server', () => ({
  getServerClient: async () => ({ from: (...a: unknown[]) => serverFrom(...a) }),
}))

import { addStaff, updateStaff, issuePin } from './actions'

function form(values: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(values)) f.set(k, v)
  return f
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const sentBody = (call: number) => JSON.parse(staffFetch.mock.calls[call]![1].body as string)

beforeEach(() => {
  vi.clearAllMocks()
  requireOwner.mockResolvedValue({ id: 's1', role: 'owner' })
})

describe('addStaff', () => {
  it('adds a barista through the API with no email or user id and never invites', async () => {
    staffFetch.mockResolvedValue(json(201, { id: 'p1' }))
    const result = await addStaff(form({ full_name: ' Ana ', role: 'barista', email: 'ana@example.com' }))
    expect(result).toEqual({ ok: true })
    expect(inviteUserByEmail).not.toHaveBeenCalled()
    expect(staffFetch).toHaveBeenCalledTimes(1)
    expect(staffFetch.mock.calls[0]![0]).toBe('/v1/staff')
    expect(staffFetch.mock.calls[0]![1].method).toBe('POST')
    const body = sentBody(0)
    expect(body).toEqual({ fullName: 'Ana', role: 'barista' })
    expect(body).not.toHaveProperty('email')
    expect(body).not.toHaveProperty('userId')
    expect(revalidatePath).toHaveBeenCalledWith('/admin/staff')
  })

  it('refuses an owner without an email, with no fetch', async () => {
    const result = await addStaff(form({ full_name: 'Kenn', role: 'owner', email: '  ' }))
    expect(result.ok).toBe(false)
    expect(staffFetch).not.toHaveBeenCalled()
    expect(inviteUserByEmail).not.toHaveBeenCalled()
  })

  it('invites a manager with an email, then posts the returned user id', async () => {
    inviteUserByEmail.mockResolvedValue({ data: { user: { id: 'u-9' } }, error: null })
    staffFetch.mockResolvedValue(json(201, { id: 'p2' }))
    const result = await addStaff(form({ full_name: 'Mia', role: 'manager', email: 'mia@example.com' }))
    expect(result).toEqual({ ok: true })
    expect(inviteUserByEmail).toHaveBeenCalledWith('mia@example.com')
    expect(sentBody(0)).toEqual({ fullName: 'Mia', role: 'manager', email: 'mia@example.com', userId: 'u-9' })
  })

  it('adds a manager without an email as a till-only person', async () => {
    staffFetch.mockResolvedValue(json(201, { id: 'p3' }))
    const result = await addStaff(form({ full_name: 'Leo', role: 'manager', email: '' }))
    expect(result).toEqual({ ok: true })
    expect(inviteUserByEmail).not.toHaveBeenCalled()
    expect(sentBody(0)).toEqual({ fullName: 'Leo', role: 'manager' })
  })

  it('returns the API message on a 409', async () => {
    inviteUserByEmail.mockResolvedValue({ data: { user: { id: 'u-9' } }, error: null })
    staffFetch.mockResolvedValue(json(409, { code: 'ALREADY_STAFF', message: 'That login already belongs to a staff member.' }))
    const result = await addStaff(form({ full_name: 'Mia', role: 'manager', email: 'mia@example.com' }))
    expect(result).toEqual({ ok: false, message: 'That login already belongs to a staff member.' })
  })

  it('keeps the login when the API says it already belongs to staff (ALREADY_STAFF, EMAIL_TAKEN)', async () => {
    // Supabase re-sends an invite to an unconfirmed user and returns the same, older user: not ours to delete.
    inviteUserByEmail.mockResolvedValue({ data: { user: { id: 'u-9' } }, error: null })
    staffFetch.mockResolvedValueOnce(json(409, { code: 'ALREADY_STAFF', message: 'That login already belongs to a staff member.' }))
    expect(await addStaff(form({ full_name: 'Mia', role: 'manager', email: 'mia@example.com' }))).toEqual({
      ok: false,
      message: 'That login already belongs to a staff member.',
    })
    staffFetch.mockResolvedValueOnce(json(409, { code: 'EMAIL_TAKEN', message: 'That email already belongs to a staff member.' }))
    expect(await addStaff(form({ full_name: 'Mia', role: 'manager', email: 'mia@example.com' }))).toEqual({
      ok: false,
      message: 'That email already belongs to a staff member.',
    })
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('deletes the just-invited login when the API fails with a 500', async () => {
    inviteUserByEmail.mockResolvedValue({ data: { user: { id: 'u-9' } }, error: null })
    deleteUser.mockResolvedValue({ data: {}, error: null })
    staffFetch.mockResolvedValue(json(500, { code: 'INTERNAL', message: 'boom' }))
    const result = await addStaff(form({ full_name: 'Mia', role: 'manager', email: 'mia@example.com' }))
    expect(result).toEqual({ ok: false, message: 'Something went wrong. Try again.' })
    expect(deleteUser).toHaveBeenCalledWith('u-9')
  })

  it('still returns the API error when deleting the invited login fails', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    inviteUserByEmail.mockResolvedValue({ data: { user: { id: 'u-9' } }, error: null })
    deleteUser.mockRejectedValue(new Error('auth down'))
    staffFetch.mockRejectedValue(new Error('network'))
    const result = await addStaff(form({ full_name: 'Mia', role: 'manager', email: 'mia@example.com' }))
    expect(result).toEqual({ ok: false, message: "Couldn't reach the server. Try again." })
    expect(deleteUser).toHaveBeenCalledWith('u-9')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('does not delete any login when there was no invite', async () => {
    staffFetch.mockResolvedValue(json(400, { code: 'BAD_REQUEST', message: 'Name is too long.' }))
    const result = await addStaff(form({ full_name: 'Ana', role: 'barista' }))
    expect(result).toEqual({ ok: false, message: 'Name is too long.' })
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('reports an invite failure without calling the API', async () => {
    inviteUserByEmail.mockResolvedValue({ data: { user: null }, error: { message: 'rate limited' } })
    const result = await addStaff(form({ full_name: 'Mia', role: 'owner', email: 'mia@example.com' }))
    expect(result.ok).toBe(false)
    expect(staffFetch).not.toHaveBeenCalled()
  })

  it('rejects an empty name and an unknown role', async () => {
    expect((await addStaff(form({ full_name: ' ', role: 'barista' }))).ok).toBe(false)
    expect((await addStaff(form({ full_name: 'X', role: 'admin' }))).ok).toBe(false)
    expect(staffFetch).not.toHaveBeenCalled()
  })

  it('says the server is unreachable when the fetch throws', async () => {
    staffFetch.mockRejectedValue(new Error('network'))
    const result = await addStaff(form({ full_name: 'Ana', role: 'barista' }))
    expect(result).toEqual({ ok: false, message: "Couldn't reach the server. Try again." })
  })
})

describe('updateStaff', () => {
  it('patches the person through the API', async () => {
    staffFetch.mockResolvedValue(json(200, { id: 'p1' }))
    const result = await updateStaff('p1', { role: 'manager' })
    expect(result).toEqual({ ok: true })
    expect(staffFetch.mock.calls[0]![0]).toBe('/v1/staff/p1')
    expect(staffFetch.mock.calls[0]![1].method).toBe('PATCH')
    expect(sentBody(0)).toEqual({ role: 'manager' })
    expect(revalidatePath).toHaveBeenCalledWith('/admin/staff')
  })

  it('returns the API message for LAST_OWNER', async () => {
    staffFetch.mockResolvedValue(
      json(409, { code: 'LAST_OWNER', message: 'There must always be at least one active owner.' }),
    )
    const result = await updateStaff('p1', { isActive: false })
    expect(result).toEqual({ ok: false, message: 'There must always be at least one active owner.' })
  })
})

describe('issuePin', () => {
  it('returns the PIN from the body', async () => {
    staffFetch.mockResolvedValue(json(201, { pin: '482913' }))
    const result = await issuePin('p1')
    expect(result).toEqual({ ok: true, pin: '482913' })
    expect(staffFetch.mock.calls[0]![0]).toBe('/v1/staff/p1/pin')
    expect(staffFetch.mock.calls[0]![1].method).toBe('POST')
  })

  it('returns the API message when the person is inactive', async () => {
    staffFetch.mockResolvedValue(json(409, { code: 'INACTIVE', message: 'Reactivate this person before giving them a PIN.' }))
    const result = await issuePin('p1')
    expect(result).toEqual({ ok: false, message: 'Reactivate this person before giving them a PIN.' })
  })

  it('fails cleanly when the success body has no PIN', async () => {
    staffFetch.mockResolvedValue(json(201, {}))
    expect((await issuePin('p1')).ok).toBe(false)
  })
})

describe('no direct staff writes', () => {
  it('never writes the staff table through the Supabase server client', async () => {
    staffFetch.mockResolvedValue(json(200, { pin: '482913' }))
    await updateStaff('p1', { fullName: 'New' })
    await issuePin('p1')
    await addStaff(form({ full_name: 'Ana', role: 'barista' }))
    expect(serverFrom).not.toHaveBeenCalled()
  })
})

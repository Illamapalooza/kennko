import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const staffFetch = vi.fn()
const revalidatePath = vi.fn()
const requireOwner = vi.fn(async () => ({ id: 's1', role: 'owner' }))
const serverFrom = vi.fn()

vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }))
vi.mock('@/lib/auth/session', () => ({ requireOwner: () => requireOwner() }))
vi.mock('@/lib/api/client', () => ({ staffFetch: (...a: unknown[]) => staffFetch(...a) }))
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
  })

  it('posts a manager with an email as { fullName, role, email }, no userId: the API sends the invite', async () => {
    staffFetch.mockResolvedValue(json(201, { id: 'p2' }))
    const result = await addStaff(form({ full_name: 'Mia', role: 'manager', email: ' mia@example.com ' }))
    expect(result).toEqual({ ok: true })
    expect(staffFetch).toHaveBeenCalledTimes(1)
    expect(sentBody(0)).toEqual({ fullName: 'Mia', role: 'manager', email: 'mia@example.com' })
    expect(sentBody(0)).not.toHaveProperty('userId')
  })

  it('posts an owner with an email the same way', async () => {
    staffFetch.mockResolvedValue(json(201, { id: 'p4' }))
    expect(await addStaff(form({ full_name: 'Kenn', role: 'owner', email: 'kenn@example.com' }))).toEqual({ ok: true })
    expect(sentBody(0)).toEqual({ fullName: 'Kenn', role: 'owner', email: 'kenn@example.com' })
  })

  it('adds a manager without an email as a till-only person', async () => {
    staffFetch.mockResolvedValue(json(201, { id: 'p3' }))
    const result = await addStaff(form({ full_name: 'Leo', role: 'manager', email: '' }))
    expect(result).toEqual({ ok: true })
    expect(sentBody(0)).toEqual({ fullName: 'Leo', role: 'manager' })
  })

  it.each([
    ['ALREADY_REGISTERED', 'That email already has a website login. Use a different email, or ask them to sign in first.'],
    ['EMAIL_TAKEN', 'That email already belongs to a staff member.'],
    ['ALREADY_STAFF', 'That login already belongs to a staff member.'],
  ])('shows the API message for %s', async (code, message) => {
    staffFetch.mockResolvedValue(json(409, { code, message }))
    const result = await addStaff(form({ full_name: 'Mia', role: 'manager', email: 'mia@example.com' }))
    expect(result).toEqual({ ok: false, message })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('INVITE_FAILED reads "Could not send the invite. Try again."', async () => {
    staffFetch.mockResolvedValue(json(502, { code: 'INVITE_FAILED', message: 'upstream said no' }))
    const result = await addStaff(form({ full_name: 'Mia', role: 'owner', email: 'mia@example.com' }))
    expect(result).toEqual({ ok: false, message: 'Could not send the invite. Try again.' })
  })

  it('any other 5xx is the generic message', async () => {
    staffFetch.mockResolvedValue(json(500, { code: 'INTERNAL', message: 'boom' }))
    const result = await addStaff(form({ full_name: 'Mia', role: 'manager', email: 'mia@example.com' }))
    expect(result).toEqual({ ok: false, message: 'Something went wrong. Try again.' })
  })

  it('returns the API message on a 400', async () => {
    staffFetch.mockResolvedValue(json(400, { code: 'BAD_REQUEST', message: 'Name is too long.' }))
    const result = await addStaff(form({ full_name: 'Ana', role: 'barista' }))
    expect(result).toEqual({ ok: false, message: 'Name is too long.' })
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

describe('no service key', () => {
  it('the staff actions never import the admin client or invite or delete logins themselves', () => {
    const src = readFileSync(path.join(__dirname, 'actions.ts'), 'utf8')
    expect(src).not.toMatch(/getAdminClient|supabase\/admin|inviteUserByEmail|deleteUser/)
  })
})

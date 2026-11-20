'use server'

import { revalidatePath } from 'next/cache'
import { getAdminClient } from '@/lib/supabase/admin'
import { requireOwner } from '@/lib/auth/session'
import { staffFetch } from '@/lib/api/client'
import type { StaffRole } from '@/lib/auth/types'

type Result = { ok: true } | { ok: false; message: string }
type PinResult = { ok: true; pin: string } | { ok: false; message: string }

const UNREACHABLE = "Couldn't reach the server. Try again."
const ROLES: StaffRole[] = ['owner', 'manager', 'barista']

/** Every staff write goes through the API; this turns its answer into a message the owner can act on. */
async function callApi(
  path: string,
  method: 'POST' | 'PATCH',
  body?: unknown,
): Promise<{ ok: true; body: unknown } | { ok: false; message: string }> {
  let res: Response
  try {
    res = await staffFetch(path, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
  } catch {
    return { ok: false, message: UNREACHABLE }
  }
  const parsed = (await res.json().catch(() => null)) as { message?: unknown } | null
  if (res.ok) return { ok: true, body: parsed }
  if (res.status === 409 && typeof parsed?.message === 'string') return { ok: false, message: parsed.message }
  if (res.status === 401) return { ok: false, message: 'Your session ended. Sign in again.' }
  if (res.status === 403) return { ok: false, message: 'Only the owner can do that.' }
  if (res.status === 404) return { ok: false, message: 'That person no longer exists. Refresh the page.' }
  return { ok: false, message: 'Something went wrong. Try again.' }
}

export async function addStaff(formData: FormData): Promise<Result> {
  await requireOwner()

  const fullName = String(formData.get('full_name') ?? '').trim()
  const role = String(formData.get('role') ?? 'barista') as StaffRole
  const email = String(formData.get('email') ?? '').trim()

  if (!fullName) return { ok: false, message: 'Enter a name.' }
  if (!ROLES.includes(role)) return { ok: false, message: 'Choose a role.' }
  if (role === 'owner' && !email) return { ok: false, message: 'An owner needs an email address for the website login.' }

  const body: { fullName: string; role: StaffRole; email?: string; userId?: string } = { fullName, role }

  if (role !== 'barista' && email) {
    // Creating an auth user needs the service role; requireOwner() above is what makes that safe.
    let userId: string | undefined
    try {
      const { data, error } = await getAdminClient().auth.admin.inviteUserByEmail(email)
      if (error) return { ok: false, message: `Could not send the invite: ${error.message}` }
      userId = data.user?.id
    } catch {
      return { ok: false, message: 'Could not send the invite. Try again.' }
    }
    if (!userId) return { ok: false, message: 'Could not send the invite. Try again.' }
    body.email = email
    body.userId = userId
  }

  const result = await callApi('/v1/staff', 'POST', body)
  if (!result.ok) return result
  revalidatePath('/admin/staff')
  return { ok: true }
}

export async function updateStaff(
  id: string,
  patch: { fullName?: string; role?: StaffRole; isActive?: boolean },
): Promise<Result> {
  await requireOwner()
  const result = await callApi(`/v1/staff/${encodeURIComponent(id)}`, 'PATCH', patch)
  if (!result.ok) return result
  revalidatePath('/admin/staff')
  return { ok: true }
}

export async function issuePin(id: string): Promise<PinResult> {
  await requireOwner()
  const result = await callApi(`/v1/staff/${encodeURIComponent(id)}/pin`, 'POST')
  if (!result.ok) return result
  const pin = (result.body as { pin?: unknown } | null)?.pin
  if (typeof pin !== 'string') return { ok: false, message: 'Something went wrong. Try again.' }
  revalidatePath('/admin/staff')
  return { ok: true, pin }
}

'use server'

import { revalidatePath } from 'next/cache'
import { getAdminClient } from '@/lib/supabase/admin'
import { requireOwner } from '@/lib/auth/session'
import { callApi, callApiWithCode } from '@/lib/api/call'
import type { StaffRole } from '@/lib/auth/types'

type Result = { ok: true } | { ok: false; message: string }
type PinResult = { ok: true; pin: string } | { ok: false; message: string }

const ROLES: StaffRole[] = ['owner', 'manager', 'barista']
const KEEP_LOGIN_CODES = new Set(['ALREADY_STAFF', 'EMAIL_TAKEN'])
const STAFF_MESSAGES = { notFound: 'That person no longer exists. Refresh the page.' }

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

  const result = await callApiWithCode('/v1/staff', 'POST', body, STAFF_MESSAGES)
  if (!result.ok) {
    // The invite above may have made a login nobody can use without a staff row; take it back so a retry can
    // invite again. Not on ALREADY_STAFF or EMAIL_TAKEN: Supabase re-sends an invite to an existing unconfirmed
    // user and returns that same user, so the login was there before this call.
    if (body.userId && !KEEP_LOGIN_CODES.has(result.code ?? '')) await deleteInvitedUser(body.userId)
    return { ok: false, message: result.message }
  }
  revalidatePath('/admin/staff')
  return { ok: true }
}

/** Best effort: a failure here is logged and the API's error is still what the owner sees. */
async function deleteInvitedUser(userId: string): Promise<void> {
  try {
    const { error } = await getAdminClient().auth.admin.deleteUser(userId)
    if (error) console.error(`Could not delete the invited login ${userId}: ${error.message}`)
  } catch (err) {
    console.error(`Could not delete the invited login ${userId}:`, err)
  }
}

export async function updateStaff(
  id: string,
  patch: { fullName?: string; role?: StaffRole; isActive?: boolean },
): Promise<Result> {
  await requireOwner()
  const result = await callApi(`/v1/staff/${encodeURIComponent(id)}`, 'PATCH', patch, STAFF_MESSAGES)
  if (!result.ok) return result
  revalidatePath('/admin/staff')
  return { ok: true }
}

export async function issuePin(id: string): Promise<PinResult> {
  await requireOwner()
  const result = await callApi(`/v1/staff/${encodeURIComponent(id)}/pin`, 'POST', undefined, STAFF_MESSAGES)
  if (!result.ok) return result
  const pin = (result.body as { pin?: unknown } | null)?.pin
  if (typeof pin !== 'string') return { ok: false, message: 'Something went wrong. Try again.' }
  revalidatePath('/admin/staff')
  return { ok: true, pin }
}

'use server'

import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/auth/session'
import { callApi, callApiWithCode } from '@/lib/api/call'
import type { StaffRole } from '@/lib/auth/types'

type Result = { ok: true } | { ok: false; message: string }
type PinResult = { ok: true; pin: string } | { ok: false; message: string }

const ROLES: StaffRole[] = ['owner', 'manager', 'barista']
const INVITE_FAILED = 'Could not send the invite. Try again.'
const STAFF_MESSAGES = { notFound: 'That person no longer exists. Refresh the page.' }

export async function addStaff(formData: FormData): Promise<Result> {
  await requireOwner()

  const fullName = String(formData.get('full_name') ?? '').trim()
  const role = String(formData.get('role') ?? 'barista') as StaffRole
  const email = String(formData.get('email') ?? '').trim()

  if (!fullName) return { ok: false, message: 'Enter a name.' }
  if (!ROLES.includes(role)) return { ok: false, message: 'Choose a role.' }
  if (role === 'owner' && !email) return { ok: false, message: 'An owner needs an email address for the website login.' }

  // An owner or manager with an email gets a website login: the API invites them (Ruling 15), and takes the
  // login back itself if the staff row then fails. A barista never gets one.
  const body: { fullName: string; role: StaffRole; email?: string } = { fullName, role }
  if (role !== 'barista' && email) body.email = email

  const result = await callApiWithCode('/v1/staff', 'POST', body, STAFF_MESSAGES)
  if (!result.ok) {
    // ALREADY_REGISTERED, EMAIL_TAKEN and other 4xx carry the API's own message; INVITE_FAILED is a 502.
    return { ok: false, message: result.code === 'INVITE_FAILED' ? INVITE_FAILED : result.message }
  }
  revalidatePath('/admin/staff')
  return { ok: true }
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

'use server'

import { revalidatePath } from 'next/cache'
import { getServerClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { requireOwner } from '@/lib/auth/session'
import { canDemote, type RoleRow } from './guards'
import type { StaffRole } from '@/lib/auth/types'

export async function inviteStaff(formData: FormData) {
  await requireOwner()

  const email = String(formData.get('email') ?? '').trim()
  const fullName = String(formData.get('full_name') ?? '').trim()
  const role = String(formData.get('role') ?? 'barista') as StaffRole

  if (!email || !fullName) throw new Error('Enter a name and an email address')
  if (role !== 'owner' && role !== 'barista') throw new Error('Invalid role')

  // Creating an auth user requires the service role; requireOwner() above is
  // what makes that safe.
  const admin = getAdminClient()
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email)
  if (error) throw new Error(`Could not send the invite: ${error.message}`)

  const { error: insertError } = await admin.from('staff').insert({
    id: data.user.id,
    email,
    full_name: fullName,
    role,
    is_active: true,
  })
  if (insertError) throw new Error(`Could not add the staff row: ${insertError.message}`)

  revalidatePath('/admin/staff')
}

export async function setStaffRole(id: string, role: StaffRole) {
  await requireOwner()
  const db = await getServerClient()

  const { data: all } = await db.from('staff').select('id, role')
  if (role !== 'owner' && !canDemote((all ?? []) as RoleRow[], id)) {
    throw new Error('There must always be at least one owner')
  }

  const { error } = await db.from('staff').update({ role }).eq('id', id)
  if (error) throw new Error(`Could not change the role: ${error.message}`)

  revalidatePath('/admin/staff')
}

export async function setStaffActive(id: string, isActive: boolean) {
  await requireOwner()
  const db = await getServerClient()

  if (!isActive) {
    const { data: all } = await db.from('staff').select('id, role')
    if (!canDemote((all ?? []) as RoleRow[], id)) {
      throw new Error('There must always be at least one active owner')
    }
  }

  const { error } = await db.from('staff').update({ is_active: isActive }).eq('id', id)
  if (error) throw new Error(`Could not update the account: ${error.message}`)

  revalidatePath('/admin/staff')
}

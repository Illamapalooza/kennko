import { redirect } from 'next/navigation'
import { getServerClient } from '@/lib/supabase/server'
import type { StaffMember, StaffRole } from './types'

type StaffRow = {
  id: string
  email: string
  full_name: string
  role: StaffRole
  is_active: boolean
}

export function mapStaffRow(row: StaffRow | null): StaffMember | null {
  if (!row || !row.is_active) return null
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    isActive: row.is_active,
  }
}

export async function getCurrentStaff(): Promise<StaffMember | null> {
  const db = await getServerClient()

  const {
    data: { user },
  } = await db.auth.getUser()
  if (!user) return null

  const { data } = await db
    .from('staff')
    .select('id, email, full_name, role, is_active')
    .eq('id', user.id)
    .maybeSingle()

  return mapStaffRow(data as StaffRow | null)
}

export async function requireStaff(): Promise<StaffMember> {
  const staff = await getCurrentStaff()
  if (!staff) redirect('/admin/login')
  return staff
}

export async function requireOwner(): Promise<StaffMember> {
  const staff = await requireStaff()
  if (staff.role !== 'owner') redirect('/admin/menu?denied=owner-only')
  return staff
}

import 'server-only'
import { getServerClient } from '@/lib/supabase/server'

export type Customer = {
  id: string
  email: string
  name: string
  avatarUrl: string | null
  emailConfirmed: boolean
}

/**
 * The signed-in customer, or null. Distinct from getCurrentStaff(): a customer
 * is any authenticated user, staff or not, and carries no admin rights. Staff
 * permissions come only from the `staff` table.
 */
export async function getCurrentCustomer(): Promise<Customer | null> {
  const db = await getServerClient()
  const {
    data: { user },
  } = await db.auth.getUser()

  if (!user?.email) return null

  const meta = user.user_metadata ?? {}
  return {
    id: user.id,
    email: user.email,
    name: (meta.full_name as string) || (meta.name as string) || user.email.split('@')[0],
    avatarUrl: (meta.avatar_url as string) ?? (meta.picture as string) ?? null,
    emailConfirmed: Boolean(user.email_confirmed_at),
  }
}

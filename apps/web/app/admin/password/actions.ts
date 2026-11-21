'use server'

import { requireStaff } from '@/lib/auth/session'
import { getServerClient } from '@/lib/supabase/server'
import { validateNewPassword } from './validate'

export type PasswordState = { error: string | null; done: boolean }

/**
 * Sets a password on the signed-in staff member's own login, so someone who joined through Google can also
 * sign in at /admin/login with email + password. Uses their own session; no service key involved.
 */
export async function setPassword(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  await requireStaff()
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')

  const invalid = validateNewPassword(password, confirm)
  if (invalid) return { error: invalid, done: false }

  const db = await getServerClient()
  const { error } = await db.auth.updateUser({ password })
  if (error) {
    if (error.code === 'same_password') return { error: 'That is already your password.', done: false }
    if (error.code === 'weak_password') return { error: 'Choose a stronger password.', done: false }
    if (error.code === 'reauthentication_needed') {
      return { error: 'Sign out and sign in again, then set your password.', done: false }
    }
    console.error('admin password: update failed', error.code ?? error.status)
    return { error: 'Could not set your password. Try again.', done: false }
  }
  return { error: null, done: true }
}

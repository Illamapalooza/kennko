'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getServerClient } from '@/lib/supabase/server'

export type LoginState = { error: string | null }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateCredentials(email: string, password: string): string | null {
  if (!email) return 'Enter your email address.'
  if (!EMAIL_PATTERN.test(email)) return 'Enter a valid email address.'
  if (!password) return 'Enter your password.'
  return null
}

export async function signIn(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  const invalid = validateCredentials(email, password)
  if (invalid) return { error: invalid }

  const db = await getServerClient()
  const { error } = await db.auth.signInWithPassword({ email, password })

  // Deliberately vague: a distinct "no such account" message would let anyone
  // enumerate which addresses are staff.
  if (error) return { error: 'Those details did not match. Try again.' }

  redirect('/admin/menu')
}

export async function signOut() {
  const db = await getServerClient()
  await db.auth.signOut()
  revalidatePath('/admin', 'layout')
  redirect('/admin/login')
}

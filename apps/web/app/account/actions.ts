'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getServerClient } from '@/lib/supabase/server'

export async function signOutCustomer() {
  const db = await getServerClient()
  await db.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/')
}

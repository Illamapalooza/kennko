'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getServerClient } from '@/lib/supabase/server'
import { userFetch } from '@/lib/api/client'
import { PRIVACY_VERSION } from '@/lib/privacy'

type ActionResult = { ok: true } | { ok: false; message: string }

const NAME_MAX = 40

export async function signOutCustomer() {
  const db = await getServerClient()
  await db.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/')
}

/** Calls the API as the customer; a network failure or timeout becomes null. */
async function call(path: string, method: string, body: unknown): Promise<Response | null> {
  try {
    return await userFetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    console.error(`[account] ${method} ${path} failed:`, (err as Error).message)
    return null
  }
}

/** "Get my Kennko card": both boxes (13 or older, privacy notice) must be ticked. */
export async function joinKennko(form: FormData): Promise<ActionResult> {
  if (!form.get('age') || !form.get('privacy')) {
    return { ok: false, message: 'Tick both boxes to get your card.' }
  }
  const res = await call('/v1/me/join', 'POST', { ageConfirmed: true, privacyVersion: PRIVACY_VERSION })
  if (!res || !res.ok) return { ok: false, message: 'We could not make your card. Try again in a minute.' }
  revalidatePath('/account')
  return { ok: true }
}

export async function renameCard(name: string): Promise<ActionResult> {
  const displayName = name.trim()
  if (displayName.length < 1 || displayName.length > NAME_MAX) {
    return { ok: false, message: 'A name is 1 to 40 characters.' }
  }
  const res = await call('/v1/me', 'PATCH', { displayName })
  if (!res || !res.ok) return { ok: false, message: 'We could not save the name. Try again.' }
  revalidatePath('/account')
  return { ok: true }
}

/** Hard deletion. The API removes the card data and then the login; on success the customer is signed out. */
export async function deleteAccount(confirm: string): Promise<ActionResult> {
  if (confirm !== 'DELETE') return { ok: false, message: 'Type DELETE to confirm.' }
  const res = await call('/v1/me', 'DELETE', { confirm: 'DELETE' })
  if (!res) return { ok: false, message: 'We could not reach Kennko. Try again.' }
  if (res.ok) {
    try {
      // The login is already gone, so this may complain; the cookies are cleared either way.
      await (await getServerClient()).auth.signOut()
    } catch (err) {
      console.error('[account] sign-out after deletion failed:', (err as Error).message)
    }
    revalidatePath('/', 'layout')
    redirect('/?account=deleted')
  }
  const code = ((await res.json().catch(() => null)) as { code?: string } | null)?.code
  if (res.status === 409 && code === 'IS_STAFF') {
    return { ok: false, message: 'Staff logins are removed by the owner in admin.' }
  }
  if (res.status === 502) {
    return { ok: false, message: 'Your card is deleted, but the sign-in could not be removed. Try again.' }
  }
  return { ok: false, message: 'We could not delete your account. Try again.' }
}

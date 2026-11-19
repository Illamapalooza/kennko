import 'server-only'
import { getServerClient } from '@/lib/supabase/server'

export type PublishResult = { ok: true; version: number } | { ok: false; message: string }

/**
 * Asks the API to publish the current menu as the snapshot the website and till read. Uses the
 * signed-in user's access token. Never throws for an API or network failure.
 */
export async function publishMenu(): Promise<PublishResult> {
  const base = process.env.KENNKO_API_URL
  if (!base) return { ok: false, message: 'The menu API is not configured (KENNKO_API_URL).' }

  try {
    const db = await getServerClient()
    const token = (await db.auth.getSession()).data.session?.access_token
    if (!token) return { ok: false, message: 'You are not signed in.' }

    const res = await fetch(`${base.replace(/\/+$/, '')}/v1/menu/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    })
    const body = (await res.json().catch(() => null)) as
      | { version?: number; message?: string }
      | null

    if (!res.ok) {
      return { ok: false, message: body?.message ?? `The menu API responded ${res.status}.` }
    }
    if (typeof body?.version !== 'number') {
      return { ok: false, message: 'The menu API sent an unexpected answer.' }
    }
    return { ok: true, version: body.version }
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : 'Could not reach the menu API.',
    }
  }
}

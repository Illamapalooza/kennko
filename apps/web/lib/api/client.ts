import 'server-only'
import { getServerClient } from '@/lib/supabase/server'

/** The API's base URL without a trailing slash, or null when it is not configured. */
export function apiBase(): string | null {
  const base = process.env.KENNKO_API_URL
  return base ? base.replace(/\/+$/, '') : null
}

/**
 * Calls the API as the signed-in staff member, using their Supabase access token. Throws when the
 * API is not configured or nobody is signed in; network failures and timeouts propagate too.
 */
export async function staffFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const base = apiBase()
  if (!base) throw new Error('The API is not configured (KENNKO_API_URL).')

  const db = await getServerClient()
  const token = (await db.auth.getSession()).data.session?.access_token
  if (!token) throw new Error('You are not signed in.')

  const { timeoutMs = 15000, ...rest } = init
  const headers = { ...Object.fromEntries(new Headers(rest.headers)), Authorization: `Bearer ${token}` }

  return fetch(`${base}${path}`, {
    ...rest,
    headers,
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  })
}

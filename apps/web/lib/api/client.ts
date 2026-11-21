import 'server-only'
import { getServerClient } from '@/lib/supabase/server'

/** The API's base URL without a trailing slash, or null when it is not configured. */
export function apiBase(): string | null {
  const base = process.env.KENNKO_API_URL
  return base ? base.replace(/\/+$/, '') : null
}

type FetchInit = RequestInit & { timeoutMs?: number }

function requireBase(): string {
  const base = apiBase()
  if (!base) throw new Error('The API is not configured (KENNKO_API_URL).')
  return base
}

function send(base: string, path: string, init: FetchInit, extra: Record<string, string>): Promise<Response> {
  const { timeoutMs = 15000, ...rest } = init
  const headers = { ...Object.fromEntries(new Headers(rest.headers)), ...extra }
  return fetch(`${base}${path}`, {
    ...rest,
    headers,
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  })
}

/** Thrown when a call needs a signed-in user and there is none (callers can tell it from a network failure). */
export class NotSignedInError extends Error {
  constructor() {
    super('You are not signed in.')
    this.name = 'NotSignedInError'
  }
}

/** The signed-in user's Supabase access token (staff or customer), or a throw when nobody is signed in. */
async function accessToken(): Promise<string> {
  const db = await getServerClient()
  const token = (await db.auth.getSession()).data.session?.access_token
  if (!token) throw new NotSignedInError()
  return token
}

/** Calls a public API route: no credentials. Throws when the API is not configured; network failures and timeouts propagate. */
export async function publicFetch(path: string, init: FetchInit = {}): Promise<Response> {
  return send(requireBase(), path, init, {})
}

/**
 * Calls the API as the signed-in staff member, using their Supabase access token. Throws when the
 * API is not configured or nobody is signed in; network failures and timeouts propagate too.
 */
export async function staffFetch(path: string, init: FetchInit = {}): Promise<Response> {
  const base = requireBase()
  return send(base, path, init, { Authorization: `Bearer ${await accessToken()}` })
}

/** Calls the API as the signed-in customer (the same token as staffFetch, for `/v1/me/*`). Throws when nobody is signed in. */
export async function userFetch(path: string, init: FetchInit = {}): Promise<Response> {
  const base = requireBase()
  return send(base, path, init, { Authorization: `Bearer ${await accessToken()}` })
}

/**
 * Calls a route guarded by the shared `KENNKO_WEB_KEY` (`X-Kennko-Web-Key`), for server work with no
 * signed-in user (the checkout's staff alert). The key is trimmed, as the API trims its copy. Returns
 * null without a fetch when the key or the API URL is unset, so the caller can skip the work.
 */
export async function webKeyFetch(path: string): Promise<Response | null> {
  const key = process.env.KENNKO_WEB_KEY?.trim()
  const base = apiBase()
  if (!key || !base) return null
  return send(base, path, {}, { 'X-Kennko-Web-Key': key })
}

/**
 * Supabase Auth admin calls over the GoTrue REST API, plain `fetch`. With `storage.ts`, the only
 * module that uses the service-role key (Ruling 12). Errors carry the status only: GoTrue's bodies
 * can echo an email, and these messages reach the logs.
 */
export type AuthAdmin = {
  /** Null when no such user exists. */
  getUser(id: string): Promise<{ email: string | null; emailConfirmed: boolean } | null>
  invite(email: string): Promise<{ userId: string }>
  deleteUser(id: string): Promise<void>
}

/**
 * A failed Auth admin call: the HTTP status, or `'timeout'` / `'network'`. Never the body (it can echo
 * an email), so callers can branch on the status and log the message safely.
 */
export class AuthAdminError extends Error {
  constructor(
    readonly call: string,
    readonly status: number | 'timeout' | 'network',
  ) {
    super(`Auth ${call} failed (${status})`)
    this.name = 'AuthAdminError'
  }
}

type GoTrueUser = { id?: string; email?: string | null; email_confirmed_at?: string | null }

/** Long enough for a slow Auth, short enough that the customer sees "try again" rather than a hang. */
const TIMEOUT_MS = 8000

export function createAuthAdmin(supabaseUrl: string, serviceKey: string, timeoutMs = TIMEOUT_MS): AuthAdmin {
  const base = `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`
  const auth = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey }
  const userUrl = (id: string) => `${base}/admin/users/${encodeURIComponent(id)}`

  function failed(what: string, res: Response): AuthAdminError {
    return new AuthAdminError(what, res.status)
  }

  /** Every call is bounded; a timeout or network error becomes a plain, email-free error. */
  async function call(what: string, url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
      throw new AuthAdminError(what, timedOut ? 'timeout' : 'network')
    }
  }

  return {
    async getUser(id) {
      const res = await call('getUser', userUrl(id), { method: 'GET', headers: auth })
      if (res.status === 404) return null
      if (!res.ok) throw failed('getUser', res)
      const user = (await res.json()) as GoTrueUser
      return { email: user.email || null, emailConfirmed: Boolean(user.email_confirmed_at) }
    },

    async invite(email) {
      const res = await call('invite', `${base}/invite`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) throw failed('invite', res)
      const user = (await res.json()) as GoTrueUser
      if (!user.id) throw new Error('Auth invite failed (no user id)')
      return { userId: user.id }
    },

    async deleteUser(id) {
      const res = await call('deleteUser', userUrl(id), { method: 'DELETE', headers: auth })
      if (!res.ok) throw failed('deleteUser', res)
    },
  }
}

import { staffFetch } from '@/lib/api/client'

export type ApiResult = { ok: true; body: unknown } | { ok: false; message: string }

type Messages = { forbidden?: string; notFound?: string }

const UNREACHABLE = "Couldn't reach the server. Try again."

/**
 * Sends an owner's write to the API and turns its answer into a message they can act on. A 409
 * carries the API's own message; the 403 and 404 wording is per screen, so callers pass it in.
 */
export async function callApi(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
  messages: Messages = {},
): Promise<ApiResult> {
  let res: Response
  try {
    res = await staffFetch(path, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
  } catch {
    return { ok: false, message: UNREACHABLE }
  }
  const parsed = (await res.json().catch(() => null)) as { message?: unknown } | null
  if (res.ok) return { ok: true, body: parsed }
  if (res.status === 409 && typeof parsed?.message === 'string') return { ok: false, message: parsed.message }
  if (res.status === 401) return { ok: false, message: 'Your session ended. Sign in again.' }
  if (res.status === 403) return { ok: false, message: messages.forbidden ?? 'Only the owner can do that.' }
  if (res.status === 404) return { ok: false, message: messages.notFound ?? 'That no longer exists. Refresh the page.' }
  return { ok: false, message: 'Something went wrong. Try again.' }
}

import { staffFetch } from '@/lib/api/client'

export type ApiResult = { ok: true; body: unknown } | { ok: false; message: string }
/** The same, with the API's error `code` (when its body has one) for a caller that must tell errors apart. */
export type ApiResultWithCode = { ok: true; body: unknown } | { ok: false; message: string; code: string | null }

type Messages = { forbidden?: string; notFound?: string }

const UNREACHABLE = "Couldn't reach the server. Try again."

/**
 * Sends an owner's write to the API and turns its answer into a message they can act on. The 401,
 * 403 and 404 wording is the website's (per screen, so callers pass it in); any other 4xx with a
 * string `message` (a 400 or 409, say) shows the API's own message.
 */
export async function callApi(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
  messages: Messages = {},
): Promise<ApiResult> {
  const result = await callApiWithCode(path, method, body, messages)
  return result.ok ? result : { ok: false, message: result.message }
}

/** callApi, keeping the API's error code (null when unreachable or the body has none). */
export async function callApiWithCode(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
  messages: Messages = {},
): Promise<ApiResultWithCode> {
  const fail = (message: string, code: string | null = null) => ({ ok: false as const, message, code })
  let res: Response
  try {
    res = await staffFetch(path, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
  } catch {
    return fail(UNREACHABLE)
  }
  const parsed = (await res.json().catch(() => null)) as { message?: unknown; code?: unknown } | null
  if (res.ok) return { ok: true, body: parsed }
  const code = typeof parsed?.code === 'string' ? parsed.code : null
  if (res.status === 401) return fail('Your session ended. Sign in again.', code)
  if (res.status === 403) return fail(messages.forbidden ?? 'Only the owner can do that.', code)
  if (res.status === 404) return fail(messages.notFound ?? 'That no longer exists. Refresh the page.', code)
  if (res.status >= 400 && res.status < 500 && typeof parsed?.message === 'string') return fail(parsed.message, code)
  return fail('Something went wrong. Try again.', code)
}

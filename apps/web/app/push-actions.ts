'use server'

import { apiBase, staffFetch } from '@/lib/api/client'
import { getCurrentCustomer } from '@/lib/auth/customer'
import { getServerClient } from '@/lib/supabase/server'

type Result = { ok: boolean; message?: string }

const PATH = '/v1/push/subscriptions'
const TURN_OFF_FAILED = "Couldn't turn off notifications. Try again."
const FAILED = "Couldn't turn on notifications. Try again."
const UNAVAILABLE = "Notifications aren't available right now."

/** The API's own words for a refusal the customer can act on (push off, order full); else the fallback. */
async function refusal(res: Response, fallback: string): Promise<string> {
  if (res.status !== 503 && res.status !== 429) return fallback
  const body = (await res.json().catch(() => null)) as { errors?: unknown } | null
  const first = Array.isArray(body?.errors) ? body.errors[0] : undefined
  if (typeof first === 'string' && first) return first
  return res.status === 503 ? UNAVAILABLE : fallback
}

/** Only what the API needs: the endpoint and its two keys. */
function wire(subscription: PushSubscriptionJSON): { endpoint: string; keys: { p256dh: string; auth: string } } | null {
  const { endpoint, keys } = subscription
  if (!endpoint || !keys?.p256dh || !keys.auth) return null
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }
}

/** Follows the order to its updates. A signed-in customer's token links it to their account. */
export async function subscribeToOrder(orderCode: string, subscription: PushSubscriptionJSON): Promise<Result> {
  const body = wire(subscription)
  const base = apiBase()
  if (!body || !base) return { ok: false, message: FAILED }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  // The token comes from the session, never from the request.
  if (await getCurrentCustomer()) {
    const token = (await (await getServerClient()).auth.getSession()).data.session?.access_token
    if (token) headers.Authorization = `Bearer ${token}`
  }

  try {
    const res = await fetch(`${base}${PATH}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ subscription: body, orderCode }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    })
    if (res.ok) return { ok: true }
    if (res.status === 404) return { ok: false, message: "We couldn't find that order." }
    return { ok: false, message: await refusal(res, FAILED) }
  } catch (cause) {
    console.error('[push] subscribe to order failed', cause)
    return { ok: false, message: FAILED }
  }
}

/** Staff alerts for new orders; the API checks the staff token. */
export async function subscribeStaffAlerts(subscription: PushSubscriptionJSON): Promise<Result> {
  const body = wire(subscription)
  if (!body) return { ok: false, message: FAILED }
  try {
    const res = await staffFetch(PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: body }),
    })
    return res.ok ? { ok: true } : { ok: false, message: await refusal(res, FAILED) }
  } catch (cause) {
    console.error('[push] staff subscribe failed', cause)
    return { ok: false, message: FAILED }
  }
}

/** Stops following one order on this device; the browser subscription and other watches stay. */
export async function unwatchOrder(orderCode: string, endpoint: string): Promise<Result> {
  const base = apiBase()
  if (!base || !endpoint || !orderCode) return { ok: false, message: TURN_OFF_FAILED }
  try {
    const res = await fetch(`${base}${PATH}/watch`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, orderCode }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    })
    return res.ok ? { ok: true } : { ok: false, message: TURN_OFF_FAILED }
  } catch (cause) {
    console.error('[push] unwatch failed', cause)
    return { ok: false, message: TURN_OFF_FAILED }
  }
}

/** The endpoint is the secret that identifies the subscription, so the API needs nothing else to remove it. */
export async function unsubscribePush(endpoint: string): Promise<Result> {
  const base = apiBase()
  if (!base || !endpoint) return { ok: false, message: FAILED }
  try {
    const res = await fetch(`${base}${PATH}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    })
    return res.ok ? { ok: true } : { ok: false, message: TURN_OFF_FAILED }
  } catch (cause) {
    console.error('[push] unsubscribe failed', cause)
    return { ok: false, message: TURN_OFF_FAILED }
  }
}

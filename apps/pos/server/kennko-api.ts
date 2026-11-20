import { randomUUID } from 'node:crypto'
import { OrderError, formatPublicCode, normalisePublicCode, type Menu, type Order, type TillCustomer } from '@kennko/core'
import { REVOKED_CODES, loadDevice } from './device.ts'
import { TYPO_MESSAGE, tillCustomer, type By, type NewOrder, type Store } from './store.ts'

/**
 * The till's only direct calls to the Kennko API outside the sync loop: the customer lookup and the free-drink claim
 * and release. Linking and stamping never come here; they go through the outbox and never wait on the network.
 */
export type DeviceAnswer =
  | { kind: 'ok'; body: any }
  | { kind: 'refused'; status: number; code: string | null; message: string | null }
  | { kind: 'offline' }
  | { kind: 'revoked' }

export const FREE_DRINK_OFFLINE = 'The free drink needs the internet. Charge it normally, or try again when online.'
export const CLAIM_WAIT_MS = 5_000
const LOOKUP_WAIT_MS = 5_000
const OFFLINE_NOTE = 'Will confirm when back online'
const RATE_LIMITED_NOTE = 'Too many card lookups this minute. Will confirm when back online'

const base = (apiUrl: string) => apiUrl.trim().replace(/\/+$/, '')

/**
 * One request with this till's device token, waiting at most `timeoutMs`. Never throws. Unpaired, disconnected in
 * admin, no website address, unreachable, too slow, a 5xx or an answer that is not JSON: `offline`. A 4xx is `refused`
 * with the API's `{ code, message }` when it sent one; the API's own revoked 401 is `revoked`.
 */
export async function deviceCall(
  dataDir: string,
  apiUrl: string,
  path: string,
  init: RequestInit,
  timeoutMs: number,
  fetchFn: typeof fetch = fetch,
): Promise<DeviceAnswer> {
  const device = loadDevice(dataDir)
  if (!device || device.revokedAt !== null || !apiUrl.trim()) return { kind: 'offline' }
  let res: Response
  let body: any
  try {
    res = await fetchFn(`${base(apiUrl)}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${device.token}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    body = await res.json().catch(() => undefined)
  } catch {
    return { kind: 'offline' }
  }
  if (res.status === 401 && REVOKED_CODES.has(body?.code)) return { kind: 'revoked' }
  if (res.ok) return body === undefined ? { kind: 'offline' } : { kind: 'ok', body }
  if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 408) {
    const code = typeof body?.code === 'string' ? body.code : null
    const message = typeof body?.message === 'string' && body.message.trim() ? body.message.trim().slice(0, 300) : null
    return { kind: 'refused', status: res.status, code, message }
  }
  return { kind: 'offline' }
}

export type LookupAnswer = { customer: TillCustomer } | { customer: null; code: string; note: string }

/**
 * `GET /api/customers/:code`. A typo is refused here, before anything else. Online, the customer (only `TillCustomer`
 * fields) is answered and cached. Offline, an API from before the loyalty plan, or the per-till lookup limit: the code
 * with a note; staff can still link it, and the server checks it when the sale syncs.
 */
export async function lookupCustomer(store: Store, dataDir: string, apiUrl: string, input: string, fetchFn: typeof fetch = fetch): Promise<LookupAnswer> {
  const bare = normalisePublicCode(input)
  if (!bare) throw new OrderError(TYPO_MESSAGE)
  const code = formatPublicCode(bare)
  const a = await deviceCall(dataDir, apiUrl, `/v1/customers/by-code/${bare}`, { method: 'GET' }, LOOKUP_WAIT_MS, fetchFn)
  if (a.kind === 'ok') {
    const found = tillCustomer(a.body)
    if (found) {
      store.cacheCustomer(found.customer)
      return { customer: found.customer }
    }
  }
  if (a.kind === 'refused' && a.status === 404 && a.code === 'UNKNOWN_CUSTOMER') throw new OrderError('No Kennko card has that code. Check it with the customer.')
  if (a.kind === 'refused' && a.status === 400 && a.code === 'BAD_CODE') throw new OrderError(TYPO_MESSAGE)
  if (a.kind === 'refused' && a.status === 429) return { customer: null, code, note: a.message ?? RATE_LIMITED_NOTE }
  return { customer: null, code, note: OFFLINE_NOTE }
}

/** The till's words for a refused claim. */
function claimRefusal(a: Extract<DeviceAnswer, { kind: 'refused' }>): string {
  if (a.code === 'NO_FREE_DRINK') return 'No free drink waiting on this card.'
  if (a.code === 'PAPER_CARD') return 'On a paper card: use their paper card.'
  if (a.code === 'UNKNOWN_CUSTOMER') return 'No Kennko card has that code. Check it with the customer.'
  if (a.code === 'BAD_CODE') return TYPO_MESSAGE
  return a.message ?? `Kennko refused the free drink (${a.status}). Charge it normally.`
}

/**
 * A sale with the free drink, in one till request (Ruling 10). The caller has already checked the manager PIN.
 *  1. The sale is checked as it will be saved (`prepareOrder`), so no claim is made for a sale that cannot be saved.
 *  2. The claim is made online with a till-made `claimId`, waiting at most 5 s. Refused or offline: nothing is saved.
 *  3. The sale is saved with the ₱0-base line, linked, with `reward.used`. If that fails, the claim is released
 *     (best effort) and the sale's own error is shown.
 */
export async function chargeWithFreeDrink(o: {
  store: Store
  menu: Menu
  dataDir: string
  apiUrl: string
  fetchFn?: typeof fetch
  input: NewOrder
  reward: { lineIndex: unknown; code: unknown }
  now: number
  by: By
  managerStaffId: string | null
}): Promise<Order> {
  const { store, menu, dataDir, apiUrl, input, reward, now } = o
  const fetchFn = o.fetchFn ?? fetch
  const lines = Array.isArray(input?.lines) ? input.lines : []
  const index = reward?.lineIndex
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= lines.length) throw new OrderError('Choose the free drink again.')
  const bare = typeof reward.code === 'string' ? normalisePublicCode(reward.code) : null
  if (!bare) throw new OrderError(TYPO_MESSAGE)
  const typed = input.customerCode === undefined || input.customerCode === null || input.customerCode === '' ? null : normalisePublicCode(input.customerCode)
  if (typed !== null && typed !== bare) throw new OrderError('The free drink must be for the customer on this sale.')
  // Only the chosen line is the free one, whatever the request said about the others.
  const sale: NewOrder = { ...input, customerCode: bare, lines: lines.map((l, i) => ({ ...l, reward: i === index })) }
  store.prepareOrder(menu, sale)

  const claimId = randomUUID()
  const post = (path: string, body: unknown) => deviceCall(dataDir, apiUrl, path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, CLAIM_WAIT_MS, fetchFn)
  const release = async () => { await post('/v1/stamp-cards/release', { claimId }) }

  const claimed = await post('/v1/stamp-cards/claim', { claimId, code: bare, staffId: o.managerStaffId })
  if (claimed.kind === 'refused') throw new OrderError(claimRefusal(claimed))
  if (claimed.kind !== 'ok') {
    // A timeout may have claimed on the server all the same: let it go again, without making staff wait for it.
    if (claimed.kind === 'offline') void release().catch(() => {})
    throw new OrderError(claimed.kind === 'revoked' ? 'This till is disconnected from Kennko. Charge the drink normally.' : FREE_DRINK_OFFLINE)
  }
  const after = tillCustomer(claimed.body?.customer)
  if (after) store.cacheCustomer(after.customer)

  try {
    return store.createOrder(menu, sale, now, o.by, { rewardClaimId: claimId })
  } catch (err) {
    await release().catch(() => {})
    throw err
  }
}

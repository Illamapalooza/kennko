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
/**
 * How long after a claim attempt a `released: false` still might mean "the claim has not committed yet". Far longer
 * than any claim could take; after it, `released: false` means the claim never happened (or a sale used it) and the
 * pending release is dropped (Ruling P7-3).
 */
export const RELEASE_WINDOW_MS = 10 * 60_000
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
  /** Asks the sync loop to run soon, so a queued release goes out. */
  kick?: () => void
  claimWaitMs?: number
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
  const claimed = await deviceCall(dataDir, apiUrl, '/v1/stamp-cards/claim', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ claimId, code: bare, staffId: o.managerStaffId }),
  }, o.claimWaitMs ?? CLAIM_WAIT_MS, fetchFn)
  if (claimed.kind === 'refused') throw new OrderError(claimRefusal(claimed))
  if (claimed.kind === 'revoked') throw new OrderError('This till is disconnected from Kennko. Charge the drink normally.')
  if (claimed.kind === 'offline') {
    // A timeout or a lost answer may have claimed on the server all the same, and a release sent now could reach it
    // before the claim commits. So the release is queued and retried by the sync loop until it is definitive (P7-3).
    store.queueRelease(claimId, now)
    o.kick?.()
    throw new OrderError(FREE_DRINK_OFFLINE)
  }
  const after = tillCustomer(claimed.body?.customer)
  if (after) store.cacheCustomer(after.customer)

  try {
    return store.createOrder(menu, sale, now, o.by, { rewardClaimId: claimId })
  } catch (err) {
    // Queued first, so the release is never lost; one try now usually settles it before staff charge again.
    store.queueRelease(claimId, now)
    await releasePending(store, dataDir, apiUrl, now, fetchFn, claimId)
    o.kick?.()
    throw err
  }
}

/**
 * Tries each queued release once (or only `only`), oldest first. `released: true` drops it; `released: false` drops it
 * once the claim attempt is older than `RELEASE_WINDOW_MS`, else keeps it (the claim may not have committed yet). A
 * refusal (any 4xx but 429) is permanent, so it is dropped and the queue moves on: one bad entry never holds up the
 * others, and the server sweeps a claim nobody released after 30 minutes anyway (Ruling P7-6). No answer, a 429 or a
 * disconnected till keeps it and stops this round. A claim a sale was written under is dropped without a call.
 * Never throws.
 */
export async function releasePending(store: Store, dataDir: string, apiUrl: string, now: number, fetchFn: typeof fetch = fetch, only?: string): Promise<void> {
  for (const { claimId, claimedAt } of store.pendingReleases()) {
    if (only !== undefined && claimId !== only) continue
    if (store.db.prepare('select 1 from orders where reward_claim_id = ?').get(claimId)) { store.dropRelease(claimId); continue }
    const a = await deviceCall(dataDir, apiUrl, '/v1/stamp-cards/release', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ claimId }),
    }, CLAIM_WAIT_MS, fetchFn)
    if (a.kind === 'ok' && a.body?.released === true) store.dropRelease(claimId)
    else if (a.kind === 'ok' && a.body?.released === false && now - claimedAt > RELEASE_WINDOW_MS) store.dropRelease(claimId)
    else if (a.kind === 'refused' && a.status !== 429) {
      console.warn(`  A free-drink release was refused (${a.status}${a.code ? ` ${a.code}` : ''}); the website lets the claim go by itself.`)
      store.dropRelease(claimId)
    } else if (a.kind !== 'ok') return
  }
}

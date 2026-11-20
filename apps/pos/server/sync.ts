import { BACKOFF_MS, KICK_DEBOUNCE_MS, SYNC_EVERY_MS, isOnlineQueueOrder, type PullState, type SyncEvent } from '@kennko/core'
import { REVOKED_CODES, applyDeviceInfo, cleanStaff, loadDevice, type DeviceFile } from './device.ts'
import { ackImportChunk, assignLegacyIds, importRemaining, nextImportChunk, noteImportSend } from './legacy-import.ts'
import { isMenuSnapshot, loadSnapshot, saveSnapshot } from './menu.ts'
import type { PinDirectory } from './pins.ts'
import type { Sessions } from './sessions.ts'
import type { Store } from './store.ts'

/** What the till shows about its connection to the website. `offline` = paired, not revoked, and the last run failed. */
export type SyncStatus = {
  paired: boolean
  revoked: boolean
  offline: boolean
  pendingSales: number
  pendingEvents: number
  lastSyncAt: number | null
  clockSkewMs: number | null
  problem: string | null
  menuVersion: number | null
  /** Rows from before this version still to be imported (Ruling 9). */
  importing: number
}

export type SyncChange = { menu: boolean; staff: boolean; online: boolean; status: boolean }

const TIMEOUT_MS = 15_000
const UNREACHABLE = 'Could not reach the website.'
const SLOW = 'The website did not answer in time.'
const GARBLED = 'The website gave an answer the till could not understand.'
const base = (apiUrl: string) => apiUrl.trim().replace(/\/+$/, '')

/** How far the website's clock is ahead of the till's: its `Date` header minus the middle of the request. */
export function clockSkew(res: Response, sentAt: number, receivedAt: number): number | null {
  const header = res.headers.get('date')
  if (!header) return null
  const server = Date.parse(header)
  if (!Number.isFinite(server)) return null
  return Math.round(server - (sentAt + receivedAt) / 2)
}

/** The till can sync with the website: its address is set, and the till is paired and not disconnected in admin. */
export const syncReady = (device: DeviceFile | null, apiUrl: string): boolean =>
  Boolean(apiUrl.trim()) && device !== null && device.revokedAt === null

/** The wait before the next run: every 15 s while things work, then 15, 30, 60, 120 and 300 s after failures in a row. */
export function nextDelay(failures: number): number {
  if (failures <= 0) return SYNC_EVERY_MS
  return BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)]!
}

/**
 * `failed.offline`: the website could not be reached or answered 5xx (or something that was not the API). A 4xx from
 * the API itself is a sync problem instead (Ruling P4-5): the till is online, the batch is kept and retried.
 */
type Answer = { kind: 'ok'; body: any } | { kind: 'failed'; problem: string; offline: boolean } | { kind: 'revoked' } | { kind: 'stale' }
type Failure = { problem: string; offline: boolean }

const ACKED = new Set(['applied', 'flagged', 'held', 'duplicate'])

/** An import answer that accounts for exactly the rows sent; anything else is not trusted as an ack. */
const isImportResponse = (b: any, sent: number): boolean =>
  Boolean(b) && ['inserted', 'existing', 'rejected'].every((k) => Number.isInteger(b[k]) && b[k] >= 0)
  && b.inserted + b.existing + b.rejected === sent

const isPullState = (b: any): b is PullState =>
  Boolean(b)
  && Array.isArray(b.soldOut) && b.soldOut.every((id: unknown) => typeof id === 'string')
  && Array.isArray(b.staff)
  && Boolean(b.shop) && typeof b.shop.name === 'string' && typeof b.shop.address === 'string' && (b.shop.phone === null || typeof b.shop.phone === 'string')
  && (b.menu === null || (Boolean(b.menu) && Number.isInteger(b.menu.version) && (b.menu.snapshot === null || isMenuSnapshot(b.menu.snapshot))))
  && (b.onlineOrders === undefined || isOnlineList(b.onlineOrders))

/** Every entry a well-formed online order, no id twice. Anything else garbles the whole pull (Plan 5 Ruling 9). */
const isOnlineList = (list: unknown): boolean =>
  Array.isArray(list) && list.every(isOnlineQueueOrder) && new Set(list.map((o) => o.id)).size === list.length

/**
 * The till's sync with the Kennko API, in the background. Each run first imports any history from before this version
 * (once, in chunks of 100), then pushes the outbox (50 events a request, oldest
 * first; every answered id is deleted, whatever the answer), then pulls the menu, sold-out marks, staff, shop
 * details and paid online orders. Nothing here is awaited by a till request: a sale never waits on the network.
 */
export function createSync(opts: {
  store: Store
  sessions: Sessions
  pins: PinDirectory
  dataDir: string
  apiUrl: string
  fetchFn?: typeof fetch
  now?: () => number
  timers?: { set: typeof setTimeout; clear: typeof clearTimeout }
  onChange: (what: SyncChange) => void
}) {
  const { store, sessions, pins, dataDir } = opts
  const fetchFn = opts.fetchFn ?? fetch
  const now = opts.now ?? Date.now
  const timers = opts.timers ?? { set: setTimeout, clear: clearTimeout }
  const api = base(opts.apiUrl)

  let failures = 0
  let problem: string | null = null
  let offline = false
  let lastLogged: string | null = null
  let lastSyncAt: number | null = null
  let clockSkewMs: number | null = null
  let menuVersion: number | null = loadSnapshot(dataDir)?.version ?? null

  let running: Promise<void> | null = null
  let again = false
  let kicked = false
  let started = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let dueAt = 0

  function status(): SyncStatus {
    const device = loadDevice(dataDir)
    const paired = device !== null
    const revoked = device?.revokedAt != null
    const pending = store.pending()
    return {
      paired, revoked, offline: paired && !revoked && failures > 0 && offline,
      pendingSales: pending.sales, pendingEvents: pending.events,
      lastSyncAt, clockSkewMs, problem, menuVersion, importing: store.kvGet('import_done') === '1' ? 0 : importRemaining(store),
    }
  }

  /** One request to the API. Never throws. `stale` = the till was forgotten or paired again while it was asking. */
  async function call(device: DeviceFile, path: string, init: RequestInit): Promise<Answer> {
    if (!api) return { kind: 'failed', problem: 'The website connection is not set up on this computer.', offline: true }
    const sentAt = now()
    let res: Response
    try {
      res = await fetchFn(`${api}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${device.token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err: any) {
      return loadDevice(dataDir)?.token !== device.token ? { kind: 'stale' }
        : { kind: 'failed', problem: err?.name === 'TimeoutError' || err?.name === 'AbortError' ? SLOW : UNREACHABLE, offline: true }
    }
    clockSkewMs = clockSkew(res, sentAt, now())
    const body: any = await res.json().catch(() => undefined)
    if (loadDevice(dataDir)?.token !== device.token) return { kind: 'stale' }
    // Only the API's own codes mean revoked; any other 401 (a hosting protection page, say) is just offline.
    if (res.status === 401 && REVOKED_CODES.has(body?.code)) return { kind: 'revoked' }
    const message = typeof body?.message === 'string' && body.message.trim() ? body.message.trim().slice(0, 300) : null
    // 408 and 429 are transient: offline, like a timeout.
    if (res.status === 408 || res.status === 429) {
      return { kind: 'failed', problem: `The website is busy (${res.status}).`, offline: true }
    }
    if (res.status >= 400 && res.status < 500 && res.status !== 401) {
      return { kind: 'failed', problem: message ?? `The website refused the request (${res.status}).`, offline: false }
    }
    // A 5xx carrying the API's own { code, message } means the API is up and failed on this request: a sync
    // problem staff should report, not the Wi-Fi. A plain or HTML 5xx (hosting, gateway) stays offline.
    if (res.status >= 500 && message !== null && typeof body?.code === 'string') {
      return { kind: 'failed', problem: message, offline: false }
    }
    if (!res.ok) return { kind: 'failed', problem: `The website refused the request (${res.status}).`, offline: true }
    if (body === undefined) return { kind: 'failed', problem: GARBLED, offline: true }
    return { kind: 'ok', body }
  }

  /** One run. Returns what changed for the tablets. */
  async function cycle(): Promise<{ menu: boolean; staff: boolean; online: boolean }> {
    const changed = { menu: false, staff: false, online: false }
    const device = loadDevice(dataDir)
    if (!device || device.revokedAt !== null) {
      failures = 0
      problem = null
      offline = false
      return changed
    }
    let failure: Failure | null = null

    const revoke = () => {
      applyDeviceInfo(store, sessions, pins, { status: 'revoked' }, dataDir, now())
      failures = 0
      problem = null
      offline = false
      console.warn('  This till was disconnected in admin. It keeps selling; connect it again from the Menu screen.')
      return changed
    }

    // Import the history from before this version first (Ruling 9). A 200 acks the chunk, rows counted `rejected`
    // included: the API keeps those as held receipts. A failure stops the run before any push, like a failed push.
    // Once the import has finished it never has work again (new rows get their uid at insert), so skip the scans.
    const importDone = store.kvGet('import_done') === '1'
    if (!importDone) assignLegacyIds(store, device.deviceId)
    for (; !importDone;) {
      const next = nextImportChunk(store)
      if (!next) break
      const { shifts, orders, cashMoves } = next.chunk
      const sent = shifts.length + orders.length + cashMoves.length
      if (sent === 0) { ackImportChunk(store, next.rows, next.upTo); continue }
      noteImportSend(store, next.upTo)
      const a = await call(device, '/v1/sync/import', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next.chunk),
      })
      if (a.kind === 'stale') return changed
      if (a.kind === 'revoked') return revoke()
      if (a.kind === 'failed') { failure = a; break }
      if (!isImportResponse(a.body, sent)) { failure = { problem: GARBLED, offline: true }; break }
      ackImportChunk(store, next.rows, next.upTo)
    }
    if (!failure && !importDone && importRemaining(store) === 0) store.kvSet('import_done', '1')

    // Push. `held` in the answer is for information only: held rows can stay held for good, so they are never waited on.
    for (; !failure;) {
      const events: SyncEvent[] = store.outboxEvents()
      if (events.length === 0) break
      const a = await call(device, '/v1/sync/push', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events }),
      })
      if (a.kind === 'stale') return changed
      if (a.kind === 'revoked') return revoke()
      if (a.kind === 'failed') { failure = a; break }
      if (!Array.isArray(a.body?.results)) { failure = { problem: GARBLED, offline: true }; break }
      // Only an id this batch sent, answered with one of the four results, is deleted; anything else is sent again.
      const sent = new Set(events.map((e) => e.id))
      const answered = a.body.results
        .filter((r: any) => typeof r?.id === 'string' && sent.has(r.id) && ACKED.has(r.result))
        .map((r: any) => r.id as string)
      store.ackOutbox(answered)
      if (answered.length === 0) { failure = { problem: 'The website did not take the waiting changes.', offline: false }; break } // never loop on one batch
    }

    // Pull, even after a failed push: the sold-out replay keeps the till's own unsent marks on top (Ruling 14).
    const loaded = loadSnapshot(dataDir)
    menuVersion = loaded?.version ?? null
    const a = await call(device, `/v1/sync/pull${loaded ? `?version=${loaded.version}` : ''}`, { method: 'GET' })
    if (a.kind === 'stale') return changed
    if (a.kind === 'revoked') return revoke()
    if (a.kind === 'failed') failure ??= a
    else if (!isPullState(a.body)) failure ??= { problem: GARBLED, offline: true }
    else {
      const state = a.body
      const snapshot = state.menu?.snapshot
      if (snapshot && (!loaded || snapshot.version > loaded.version)) {
        saveSnapshot(dataDir, snapshot)
        menuVersion = snapshot.version
        changed.menu = true
      }
      store.replaceSoldOut(state.soldOut)
      const before = JSON.stringify(store.staffCache())
      applyDeviceInfo(store, sessions, pins, { status: 'ok', staff: cleanStaff(state.staff) }, dataDir, now())
      changed.staff = JSON.stringify(store.staffCache()) !== before
      store.kvSet('shop', JSON.stringify({ name: state.shop.name, address: state.shop.address, phone: state.shop.phone }))
      // No key = an API from before Plan 5: keep the online orders the till has (Ruling 9).
      if (state.onlineOrders !== undefined) {
        const before = JSON.stringify(store.onlineOrders())
        store.replaceOnlineOrders(state.onlineOrders)
        changed.online = JSON.stringify(store.onlineOrders()) !== before
      }
    }

    if (failure) {
      failures++
      problem = failure.problem
      offline = failure.offline
      if (!failure.offline && problem !== lastLogged) console.warn(`  The website refused the till's sync: ${problem}`)
      lastLogged = failure.offline ? null : problem
    } else {
      failures = 0
      problem = null
      offline = false
      lastLogged = null
      lastSyncAt = now()
    }
    return changed
  }

  function schedule(ms: number) {
    if (timer !== null) timers.clear(timer)
    dueAt = now() + ms
    timer = timers.set(() => { timer = null; void runOnce() }, ms)
    ;(timer as any)?.unref?.()
  }

  /** Runs one sync now; one at a time. Called during a run, it queues exactly one more and resolves after it. */
  function runOnce(): Promise<void> {
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      do {
        again = false
        kicked = false
        let before: string | null = null
        let changed = { menu: false, staff: false, online: false }
        try {
          before = JSON.stringify(status())
          changed = await cycle()
        } catch (err: any) {
          failures++
          offline = true
          problem = `The sync stopped: ${err?.message ?? err}`
          console.error(`  Sync failed: ${err?.message ?? err}`)
        }
        try {
          const statusChanged = before === null || JSON.stringify(status()) !== before
          if (changed.menu || changed.staff || changed.online || statusChanged) opts.onChange({ ...changed, status: statusChanged })
        } catch (err: any) {
          console.error(`  Sync could not report a change: ${err?.message ?? err}`)
        }
        // A kick during a failing run waits for the backoff like everything else; a success runs it straight away.
      } while (again || (kicked && failures === 0))
    })().finally(() => {
      running = null
      if (started) schedule(nextDelay(failures))
    })
    return running
  }

  return {
    /** Runs at once, then again `nextDelay(failures)` after each run. */
    start(): void {
      started = true
      void runOnce()
    },
    /**
     * Something changed on the till: sync in 300 ms (a burst of changes makes one run). While failing, a kick never
     * brings the next try forward: it waits out the rest of the backoff.
     */
    kick(): void {
      if (running) { kicked = true; return }
      const remaining = failures > 0 && timer !== null ? dueAt - now() : 0
      schedule(Math.max(KICK_DEBOUNCE_MS, remaining))
    },
    runOnce,
    status,
    stop(): void {
      started = false
      again = false
      kicked = false
      if (timer !== null) timers.clear(timer)
      timer = null
    },
  }
}

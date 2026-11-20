import { BACKOFF_MS, KICK_DEBOUNCE_MS, SYNC_EVERY_MS, type PullState, type SyncEvent } from '@kennko/core'
import { REVOKED_CODES, applyDeviceInfo, cleanStaff, loadDevice, type DeviceFile } from './device.ts'
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
}

export type SyncChange = { menu: boolean; staff: boolean; status: boolean }

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

/** The wait before the next run: every 15 s while things work, then 15, 30, 60, 120 and 300 s after failures in a row. */
export function nextDelay(failures: number): number {
  if (failures <= 0) return SYNC_EVERY_MS
  return BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)]!
}

type Answer = { kind: 'ok'; body: any } | { kind: 'failed'; problem: string } | { kind: 'revoked' } | { kind: 'stale' }

const isPullState = (b: any): b is PullState =>
  Boolean(b)
  && Array.isArray(b.soldOut) && b.soldOut.every((id: unknown) => typeof id === 'string')
  && Array.isArray(b.staff)
  && Boolean(b.shop) && typeof b.shop.name === 'string' && typeof b.shop.address === 'string' && (b.shop.phone === null || typeof b.shop.phone === 'string')
  && (b.menu === null || (Boolean(b.menu) && Number.isInteger(b.menu.version) && (b.menu.snapshot === null || isMenuSnapshot(b.menu.snapshot))))

/**
 * The till's sync with the Kennko API, in the background. Each run pushes the outbox (50 events a request, oldest
 * first; every answered id is deleted, whatever the answer), then pulls the menu, sold-out marks, staff and shop
 * details. Nothing here is awaited by a till request: a sale never waits on the network.
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
  let lastSyncAt: number | null = null
  let clockSkewMs: number | null = null
  let menuVersion: number | null = loadSnapshot(dataDir)?.version ?? null

  let running: Promise<void> | null = null
  let again = false
  let started = false
  let timer: ReturnType<typeof setTimeout> | null = null

  function status(): SyncStatus {
    const device = loadDevice(dataDir)
    const paired = device !== null
    const revoked = device?.revokedAt != null
    const pending = store.pending()
    return {
      paired, revoked, offline: paired && !revoked && failures > 0,
      pendingSales: pending.sales, pendingEvents: pending.events,
      lastSyncAt, clockSkewMs, problem, menuVersion,
    }
  }

  /** One request to the API. Never throws. `stale` = the till was forgotten or paired again while it was asking. */
  async function call(device: DeviceFile, path: string, init: RequestInit): Promise<Answer> {
    if (!api) return { kind: 'failed', problem: 'The website connection is not set up on this computer.' }
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
        : { kind: 'failed', problem: err?.name === 'TimeoutError' || err?.name === 'AbortError' ? SLOW : UNREACHABLE }
    }
    clockSkewMs = clockSkew(res, sentAt, now())
    const body: any = await res.json().catch(() => undefined)
    if (loadDevice(dataDir)?.token !== device.token) return { kind: 'stale' }
    // Only the API's own codes mean revoked; any other 401 (a hosting protection page, say) is just offline.
    if (res.status === 401 && REVOKED_CODES.has(body?.code)) return { kind: 'revoked' }
    if (!res.ok) return { kind: 'failed', problem: `The website refused the request (${res.status}).` }
    if (body === undefined) return { kind: 'failed', problem: GARBLED }
    return { kind: 'ok', body }
  }

  /** One run. Returns what changed for the tablets. */
  async function cycle(): Promise<{ menu: boolean; staff: boolean }> {
    const changed = { menu: false, staff: false }
    const device = loadDevice(dataDir)
    if (!device || device.revokedAt !== null) {
      failures = 0
      problem = null
      return changed
    }
    let failure: string | null = null

    const revoke = () => {
      applyDeviceInfo(store, sessions, pins, { status: 'revoked' }, dataDir, now())
      failures = 0
      problem = null
      console.warn('  This till was disconnected in admin. It keeps selling; connect it again from the Menu screen.')
      return changed
    }

    // Push. `held` in the answer is for information only: held rows can stay held for good, so they are never waited on.
    for (;;) {
      const events: SyncEvent[] = store.outboxEvents()
      if (events.length === 0) break
      const a = await call(device, '/v1/sync/push', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events }),
      })
      if (a.kind === 'stale') return changed
      if (a.kind === 'revoked') return revoke()
      if (a.kind === 'failed') { failure = a.problem; break }
      if (!Array.isArray(a.body?.results)) { failure = GARBLED; break }
      const sent = new Set(events.map((e) => e.id))
      const answered = a.body.results.map((r: any) => r?.id).filter((id: unknown): id is string => typeof id === 'string' && sent.has(id))
      store.ackOutbox(answered)
      if (answered.length === 0) { failure = 'The website did not take the waiting changes.'; break } // never loop on one batch
    }

    // Pull, even after a failed push: the sold-out replay keeps the till's own unsent marks on top (Ruling 14).
    const loaded = loadSnapshot(dataDir)
    menuVersion = loaded?.version ?? null
    const a = await call(device, `/v1/sync/pull${loaded ? `?version=${loaded.version}` : ''}`, { method: 'GET' })
    if (a.kind === 'stale') return changed
    if (a.kind === 'revoked') return revoke()
    if (a.kind === 'failed') failure ??= a.problem
    else if (!isPullState(a.body)) failure ??= GARBLED
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
    }

    if (failure) {
      failures++
      problem = failure
    } else {
      failures = 0
      problem = null
      lastSyncAt = now()
    }
    return changed
  }

  function schedule(ms: number) {
    if (timer !== null) timers.clear(timer)
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
        let before: string | null = null
        let changed = { menu: false, staff: false }
        try {
          before = JSON.stringify(status())
          changed = await cycle()
        } catch (err: any) {
          failures++
          problem = `The sync stopped: ${err?.message ?? err}`
          console.error(`  Sync failed: ${err?.message ?? err}`)
        }
        try {
          const statusChanged = before === null || JSON.stringify(status()) !== before
          if (changed.menu || changed.staff || statusChanged) opts.onChange({ ...changed, status: statusChanged })
        } catch (err: any) {
          console.error(`  Sync could not report a change: ${err?.message ?? err}`)
        }
      } while (again)
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
    /** Something changed on the till: sync in 300 ms (a burst of changes makes one run), and restart the wait. */
    kick(): void {
      if (running) { again = true; return }
      schedule(KICK_DEBOUNCE_MS)
    },
    runOnce,
    status,
    stop(): void {
      started = false
      again = false
      if (timer !== null) timers.clear(timer)
      timer = null
    },
  }
}

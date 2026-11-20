import type { CashMove, Discount, Menu, OnlineQueueOrder, Order, PrepStatus, Shift, Summary } from '@kennko/core'

export type Bootstrap = {
  shop: { name: string; address: string; phone: string; receiptFooter: string }
  discounts: Discount[]
  /** off: no PIN to open the till; shared: the PINs in config.json; per-person: each person's own PIN. */
  pinMode: 'off' | 'shared' | 'per-person'
  websiteConfigured: boolean
  /** The https address of this same till, when it is running; installing as an app needs it. */
  secureUrl: string | null
  /** This till's connection to the Kennko API: null until paired; revoked once the owner disconnects it in admin. */
  device: { name: string; revoked: boolean } | null
  /** Paired, not revoked and the website address set: "Check now" runs one sync with no PIN. */
  syncConfigured: boolean
}

/** The till's connection to the website, as the server's sync.ts reports it (copied here: the screens import no server code). */
export type SyncStatus = {
  paired: boolean
  revoked: boolean
  /** Paired, not revoked, and the last try failed to reach the website. */
  offline: boolean
  pendingSales: number
  pendingEvents: number
  lastSyncAt: number | null
  clockSkewMs: number | null
  problem: string | null
  menuVersion: number | null
  /** Rows from before this version still to be copied to Kennko. */
  importing: number
}

export type Live = { version: number; now: number; day: string; active: Order[]; online: OnlineQueueOrder[]; shift: Shift | null; menuKey: string; sync: SyncStatus }

export type TillState = {
  shift: Shift | null
  summary: Summary | null
  moves: CashMove[]
  recent: { shift: Shift; summary: Summary }[]
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

/** Who opened the till in this browser. The session itself is an HttpOnly cookie the page never sees. */
export type Session = { role: 'staff' | 'manager'; name: string | null }

// Older versions kept the PIN itself in the browser. The till now uses a session cookie, so forget it.
try { localStorage.removeItem('kennko-pos-pin') } catch { /* nothing stored */ }

let onLocked: () => void = () => {}
/** Called when the till no longer knows this browser's session, so the app can ask for the PIN again. */
export const setOnLocked = (fn: () => void) => { onLocked = fn }

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError("Can't reach the till computer. Check the wifi.", 0)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // 401 means the session is gone. A 429 lockout only stops PIN checks; sales go on with the session.
    if (res.status === 401) onLocked()
    throw new ApiError(data.error || "That didn't work. Try again.", res.status)
  }
  return data as T
}

export const api = {
  bootstrap: () => call<Bootstrap>('GET', '/api/bootstrap'),
  startSession: (pin: string) => call<Session>('POST', '/api/session', { pin }),
  session: () => call<Session>('GET', '/api/session'),
  endSession: () => call<{ ok: true }>('POST', '/api/session/end', {}),
  menu: () => call<Menu>('GET', '/api/menu'),
  orders: (day: string) => call<Order[]>('GET', `/api/orders?day=${day}`),
  createOrder: (body: unknown) => call<Order>('POST', '/api/orders', body),
  /** `from` is the step on screen, so a double tap or a second tablet cannot move the order twice. */
  advanceOnline: (id: string, from: PrepStatus) => call<OnlineQueueOrder>('POST', `/api/online/${id}/advance`, { from }),
  advance: (id: number) => call<Order>('POST', `/api/orders/${id}/advance`, {}),
  undo: (id: number) => call<Order>('POST', `/api/orders/${id}/undo`, {}),
  voidOrder: (id: number, reason: string, managerPin: string) => call<Order>('POST', `/api/orders/${id}/void`, { reason, managerPin }),
  /** `pin`: the person's own PIN, asked for in per-person mode so the change is credited to them. */
  setAvailable: (itemId: string, available: boolean, pin?: string) => call<Menu>('POST', '/api/menu/availability', { itemId, available, pin }),
  /**
   * Paired: "Check now", no PIN. Not connected: the manager-PIN pull of the published menu. `notice` is set when the
   * check is still running after 10 s ("Still checking — the menu updates by itself."): show it instead of "up to date".
   */
  syncMenu: (managerPin?: string) => call<Menu & { notice?: string }>('POST', '/api/menu/sync', { managerPin }),
  pairDevice: (code: string, managerPin: string) => call<{ name: string }>('POST', '/api/device/pair', { code, managerPin }),
  till: () => call<TillState>('GET', '/api/till'),
  openTill: (floatCentavos: number) => call<Shift>('POST', '/api/till/open', { floatCentavos }),
  cashMove: (kind: 'in' | 'out', amountCentavos: number, reason: string, managerPin: string) =>
    call<CashMove>('POST', '/api/till/cash', { kind, amountCentavos, reason, managerPin }),
  closeTill: (countedCentavos: number, note: string, managerPin: string) =>
    call<{ shift: Shift; summary: Summary }>('POST', '/api/till/close', { countedCentavos, note, managerPin }),
  report: (day: string) => call<{ day: string; summary: Summary }>('GET', `/api/report?day=${day}`),
  csvUrl: (day: string) => `/api/report.csv?day=${day}`,
  eventsUrl: () => '/api/events',
}

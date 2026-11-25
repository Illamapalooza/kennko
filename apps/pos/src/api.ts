import type { CashMove, CatLook, Discount, Menu, OnlineQueueOrder, Order, PendingPaymentOrder, PrepStatus, Shift, Summary, TillCustomer, WallVisitor } from '@kennko/core'
import { getTransport } from './transport.ts'

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
  host: 'node' | 'android'
  firstRun: 'pins' | 'connect'
  noLeads: boolean
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

export type OnDutyBarista = { staffId: string; name: string; role: 'owner' | 'manager' | 'barista'; catLook: CatLook | null }
export type PinChoice = { id: string; name: string; role: string; catLook: CatLook | null }
export type Live = { version: number; now: number; day: string; active: Order[]; seated?: Order[]; onDuty?: OnDutyBarista[]; online: OnlineQueueOrder[]; pendingPayments?: PendingPaymentOrder[]; shift: Shift | null; menuKey: string; sync: SyncStatus }

export type TillState = {
  shift: Shift | null
  summary: Summary | null
  moves: CashMove[]
  recent: { shift: Shift; summary: Summary }[]
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly data?: any) { super(message) }
}

/** Who opened the till in this browser. The session itself is an HttpOnly cookie the page never sees. */
export type Session = { role: 'staff' | 'manager'; name: string | null }

// Older versions kept the PIN itself in the browser. The till now uses a session cookie, so forget it.
try { localStorage.removeItem('kennko-pos-pin') } catch { /* nothing stored */ }

let onLocked: () => void = () => {}
/** Called when the till no longer knows this browser's session, so the app can ask for the PIN again. */
export const setOnLocked = (fn: () => void) => { onLocked = fn }

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let status: number
  let data: any
  try {
    const res = await getTransport().call(method, path, body, signal)
    status = res.status
    data = res.data
  } catch {
    throw new ApiError("Can't reach the till computer. Check the wifi.", 0)
  }
  if (status < 200 || status >= 300) {
    // 401 means the session is gone. A 429 lockout only stops PIN checks; sales go on with the session.
    if (status === 401) onLocked()
    throw new ApiError(data?.error || "That didn't work. Try again.", status, data)
  }
  return data as T
}

export const api = {
  bootstrap: () => call<Bootstrap>('GET', '/api/bootstrap'),
  startSession: (pin: string, staffId?: string) => call<Session>('POST', '/api/session', { pin, ...(staffId ? { staffId } : {}) }),
  joinBarista: (pin: string, staffId?: string) => call<{ onDuty: OnDutyBarista[]; joined: string | null }>('POST', '/api/baristas/join', { pin, ...(staffId ? { staffId } : {}) }),
  leaveBarista: (staffId: string) => call<{ onDuty: OnDutyBarista[] }>('POST', '/api/baristas/leave', { staffId }),
  session: () => call<Session>('GET', '/api/session'),
  endSession: () => call<{ ok: true }>('POST', '/api/session/end', {}),
  menu: () => call<Menu>('GET', '/api/menu'),
  visitors: () => call<WallVisitor[]>('GET', '/api/visitors'),
  orders: (day: string) => call<Order[]>('GET', `/api/orders?day=${day}`),
  createOrder: (body: unknown) => call<Order>('POST', '/api/orders', body),
  /** `from` is the step on screen, so a double tap or a second tablet cannot move the order twice. */
  advanceOnline: (id: string, from: PrepStatus) => call<OnlineQueueOrder>('POST', `/api/online/${id}/advance`, { from }),
  decideOnlinePayment: (paymentId: string, decision: 'verify' | 'reject') => call<{ ok: true }>('POST', `/api/online/payment/${paymentId}/${decision}`, {}),
  advance: (id: number) => call<Order>('POST', `/api/orders/${id}/advance`, {}),
  undo: (id: number) => call<Order>('POST', `/api/orders/${id}/undo`, {}),
  /** A Kennko card by code. `customer` is null (with a `note`) when the till could not ask Kennko just now. */
  customer: (code: string, signal?: AbortSignal) => call<{ customer: TillCustomer | null; code: string; note?: string }>('GET', `/api/customers/${encodeURIComponent(code)}`, undefined, signal),
  linkCustomer: (id: number, code: string) => call<Order>('POST', `/api/orders/${id}/customer`, { code }),
  unlinkCustomer: (id: number) => call<Order>('POST', `/api/orders/${id}/customer/remove`, {}),
  /** With `visitorKey` the order is tied to that walking cat; the till takes its look and name from the visit. */
  assignOrderCat: (id: number, catLook: CatLook | null, customerName?: string, visitorKey?: string | null) => call<Order>('POST', `/api/orders/${id}/cat`, { catLook, customerName, visitorKey: visitorKey ?? null }),
  setOrderTable: (id: number, tableNumber: number | null) => call<Order>('POST', `/api/orders/${id}/table`, { tableNumber }),
  removeFromWall: (id: number) => call<Order>('POST', `/api/orders/${id}/wall-remove`, {}),
  stampOrder: (id: number) => call<Order>('POST', `/api/orders/${id}/stamp`, {}),
  stampOnline: (id: string) => call<OnlineQueueOrder>('POST', `/api/online/${id}/stamp`, {}),
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
  shopStatus: () => call<{ isOpen: boolean; closingTime: string | null; updatedAt: number; openNow: boolean }>('GET', '/api/shop'),
  setShopStatus: (patch: { isOpen?: boolean; closingTime?: string | null }) =>
    call<{ isOpen: boolean; closingTime: string | null; updatedAt: number; openNow: boolean }>('POST', '/api/shop', patch),
  openTill: (floatCentavos: number) => call<Shift>('POST', '/api/till/open', { floatCentavos }),
  cashMove: (kind: 'in' | 'out', amountCentavos: number, reason: string, managerPin: string) =>
    call<CashMove>('POST', '/api/till/cash', { kind, amountCentavos, reason, managerPin }),
  closeTill: (countedCentavos: number, note: string, managerPin: string) =>
    call<{ shift: Shift; summary: Summary }>('POST', '/api/till/close', { countedCentavos, note, managerPin }),
  report: (day: string) => call<{ day: string; summary: Summary }>('GET', `/api/report?day=${day}`),
  csvUrl: (day: string) => `/api/report.csv?day=${day}`,
  eventsUrl: () => '/api/events',
  events: (onLive: (live: Live) => void, onDown: (closed: boolean) => void): (() => void) =>
    getTransport().follow((json) => onLive(JSON.parse(json) as Live), onDown),
  exportCsv: (day: string): Promise<void> =>
    getTransport().download(`/api/report.csv?day=${day}`, `kennko-sales-${day}.csv`),
  exportBackup: (): Promise<void> => {
    const fn = getTransport().exportBackup
    if (!fn) return Promise.reject(new Error('Only in the Kennko POS app.'))
    return fn()
  },
}

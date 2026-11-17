import type { CashMove, Discount, Menu, Order, Shift, Summary } from '@kennko/core'

export type Bootstrap = {
  shop: { name: string; address: string; phone: string; receiptFooter: string }
  discounts: Discount[]
  pinRequired: boolean
  websiteConfigured: boolean
  /** The https address of this same till, when it is running; installing as an app needs it. */
  secureUrl: string | null
}

export type Live = { version: number; now: number; day: string; active: Order[]; shift: Shift | null; menuKey: string }

export type TillState = {
  shift: Shift | null
  summary: Summary | null
  moves: CashMove[]
  recent: { shift: Shift; summary: Summary }[]
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

const PIN_KEY = 'kennko-pos-pin'
let pin = ''
try { pin = localStorage.getItem(PIN_KEY) ?? '' } catch { /* private mode: ask every time */ }

export const getPin = () => pin
export function setPin(next: string) {
  pin = next
  try { if (next) localStorage.setItem(PIN_KEY, next); else localStorage.removeItem(PIN_KEY) } catch { /* not remembered */ }
}

let onLocked: () => void = () => {}
/** Called when the server stops accepting this device's PIN, so the app can ask again. */
export const setOnLocked = (fn: () => void) => { onLocked = fn }

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers: { 'x-pin': pin, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError("Can't reach the till computer. Check the wifi.", 0)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 || res.status === 429) onLocked()
    throw new ApiError(data.error || "That didn't work. Try again.", res.status)
  }
  return data as T
}

export const api = {
  bootstrap: () => call<Bootstrap>('GET', '/api/bootstrap'),
  checkPin: (candidate: string) => call<{ ok: true; role: 'staff' | 'manager' }>('POST', '/api/pin', { pin: candidate }),
  menu: () => call<Menu>('GET', '/api/menu'),
  orders: (day: string) => call<Order[]>('GET', `/api/orders?day=${day}`),
  createOrder: (body: unknown) => call<Order>('POST', '/api/orders', body),
  advance: (id: number) => call<Order>('POST', `/api/orders/${id}/advance`, {}),
  undo: (id: number) => call<Order>('POST', `/api/orders/${id}/undo`, {}),
  voidOrder: (id: number, reason: string, managerPin: string) => call<Order>('POST', `/api/orders/${id}/void`, { reason, managerPin }),
  setAvailable: (itemId: string, available: boolean) => call<Menu>('POST', '/api/menu/availability', { itemId, available }),
  syncMenu: (managerPin: string) => call<Menu>('POST', '/api/menu/sync', { managerPin }),
  till: () => call<TillState>('GET', '/api/till'),
  openTill: (floatCentavos: number) => call<Shift>('POST', '/api/till/open', { floatCentavos }),
  cashMove: (kind: 'in' | 'out', amountCentavos: number, reason: string, managerPin: string) =>
    call<CashMove>('POST', '/api/till/cash', { kind, amountCentavos, reason, managerPin }),
  closeTill: (countedCentavos: number, note: string, managerPin: string) =>
    call<{ shift: Shift; summary: Summary }>('POST', '/api/till/close', { countedCentavos, note, managerPin }),
  report: (day: string) => call<{ day: string; summary: Summary }>('GET', `/api/report?day=${day}`),
  csvUrl: (day: string) => `/api/report.csv?day=${day}&pin=${encodeURIComponent(pin)}`,
  eventsUrl: () => `/api/events?pin=${encodeURIComponent(pin)}`,
}

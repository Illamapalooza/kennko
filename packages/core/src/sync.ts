import { cleanDiscount, lineTotal, totals, type Discount, type PricedLine, type Totals } from './cart.ts'
import type { OrderStatus, OrderType, PaymentMethod } from './order.ts'
import type { IceLevel, IceServe } from './ice.ts'
import { canMovePrep, type Fulfilment, type PaymentStatus, type PrepStatus } from './order-status.ts'
import type { MenuSnapshot } from './snapshot.ts'
import type { WallVisitor } from './cats.ts'
import { formatPublicCode, normalisePublicCode, type StampMode } from './loyalty.ts'

export const MAX_PUSH_EVENTS = 50
export const IMPORT_CHUNK_MAX = 100
export const MAX_HELD_RETRY = 200
export const CLOCK_WARN_MS = 300_000
export const SYNC_EVERY_MS = 15_000
export const BACKOFF_MS = [15_000, 30_000, 60_000, 120_000, 300_000]
export const KICK_DEBOUNCE_MS = 300
export const ONLINE_PULL_MAX = 200
export const ONLINE_RECENT_MS = 86_400_000

/** What the API sets on a stored event that needs a human's eye. */
export const SYNC_FLAGS = ['reprice_mismatch', 'unknown_version', 'ticket_duplicate', 'clock_skew', 'legacy'] as const
export type SyncFlag = (typeof SYNC_FLAGS)[number]

/** The till's order status expressed as the website's prep status. */
export const TILL_TO_PREP: Record<OrderStatus, PrepStatus> = {
  queued: 'placed',
  preparing: 'preparing',
  serving: 'ready',
  done: 'completed',
  voided: 'cancelled',
}

export type SyncEventKind =
  | 'order.created'
  | 'order.prep_status'
  | 'order.cancelled'
  | 'shift.opened'
  | 'shift.closed'
  | 'cash.moved'
  | 'menu.availability'
  | 'customer.linked'
  | 'customer.unlinked'
  | 'stamp.added'
  | 'reward.used'

export type CounterOrderPayload = {
  orderId: string
  shiftId: string
  businessDay: string
  ticketNumber: number
  fulfilment: OrderType
  customerName: string
  menuVersion: number | null
  lines: PricedLine[]
  discount: Discount | null
  subtotalCentavos: number
  discountCentavos: number
  totalCentavos: number
  payment: {
    id: string
    method: PaymentMethod
    tenderedCentavos: number | null
    changeCentavos: number | null
    reference: string | null
  }
}

export type SyncEvent = { id: string; seq: number; occurredAt: string; staffId: string | null } & (
  | { kind: 'order.created'; payload: CounterOrderPayload }
  | { kind: 'order.prep_status'; payload: { orderId: string; to: PrepStatus } }
  | { kind: 'order.cancelled'; payload: { orderId: string; reason: string } }
  | { kind: 'shift.opened'; payload: { shiftId: string; openingFloatCentavos: number } }
  | { kind: 'shift.closed'; payload: { shiftId: string; countedCentavos: number; expectedCentavos: number; note: string } }
  | { kind: 'cash.moved'; payload: { id: string; shiftId: string; kind: 'in' | 'out'; amountCentavos: number; reason: string } }
  | { kind: 'menu.availability'; payload: { itemId: string; available: boolean } }
  | { kind: 'customer.linked'; payload: { orderId: string; publicCode: string } }
  | { kind: 'customer.unlinked'; payload: { orderId: string } }
  | { kind: 'stamp.added'; payload: { orderId: string; stampId: string } }
  | { kind: 'reward.used'; payload: { claimId: string; orderId: string } }
)

export type PushResult = 'applied' | 'flagged' | 'held' | 'duplicate'
export type PushResponse = { results: { id: string; result: PushResult; reason: string | null; flags: string[] }[]; held: number }

export type PulledStaff = { id: string; fullName: string; role: 'owner' | 'manager' | 'barista'; pinHash: string }
export type OnlineQueueLine = {
  name: string
  size: string
  quantity: number
  options: string[]
  iceLevel: IceLevel | null
  iceServe: IceServe | null
  note: string
}
/** A paid online order as the till sees it. No money, email, payment or order-code fields, by design. */
export type OnlineQueueOrder = {
  id: string
  businessDay: string
  ticketNumber: number
  customerName: string
  fulfilment: 'pickup' | 'delivery'
  fulfilAt: string
  customerNote: string | null
  prepStatus: PrepStatus
  createdAt: string
  updatedAt: string
  lines: OnlineQueueLine[]
  delivery: { address: string; barangay: string; phone: string } | null
  /** Stamp at pickup: `stamp` = to stamp, `stamped` = done, `paper` = a paper card, null = no card. Absent = older API. */
  card?: 'stamp' | 'stamped' | 'paper' | null
}

/** The only customer fields the till ever receives. No real name, email, phone or point balance. */
export type TillCustomer = {
  /** Formatted, `KC-XXX-XXX-XXX`. */
  code: string
  /** The customer's cat name; null when Kennko has hidden the cat. */
  catName: string | null
  stampMode: StampMode
  stamps: number
  fullCards: number
}

export type PullState = {
  /** null = nothing published; snapshot null = the till already has that version. */
  menu: { version: number; snapshot: MenuSnapshot | null } | null
  soldOut: string[]
  staff: PulledStaff[]
  shop: { name: string; address: string; phone: string | null }
  /** Absent = an API from before Plan 5: the till keeps the online orders it has. */
  onlineOrders?: OnlineQueueOrder[]
  /** Customers linked through this till recently. Absent = an API from before the loyalty plan. */
  customers?: TillCustomer[]
  /** The wall check-in secret and URL. null = none yet; absent = an API from before the cats plan. */
  checkin?: { secret: string; url: string } | null
  /** Cats visiting now (no real names or ids). Absent = an API from before the cats plan: keep the cache. */
  visitors?: WallVisitor[]
}

export type ImportShift = {
  id: string
  openedAt: string
  openingFloatCentavos: number
  closedAt: string | null
  countedCentavos: number | null
  expectedCentavos: number | null
  note: string
  openedByStaff: string | null
  closedByStaff: string | null
}
export type ImportOrder = {
  id: string
  shiftId: string | null
  businessDay: string
  ticketNumber: number
  fulfilment: OrderType
  customerName: string
  status: OrderStatus
  lines: PricedLine[]
  subtotalCentavos: number
  discountCentavos: number
  discountLabel: string | null
  totalCentavos: number
  payment: CounterOrderPayload['payment']
  createdAt: string
  voidedAt: string | null
  voidReason: string | null
  cancelledByStaff: string | null
}
export type ImportCashMove = {
  id: string
  shiftId: string
  kind: 'in' | 'out'
  amountCentavos: number
  reason: string
  at: string
  staffId: string | null
}
export type ImportChunk = { shifts: ImportShift[]; orders: ImportOrder[]; cashMoves: ImportCashMove[] }
export type ImportResponse = { inserted: number; existing: number; rejected: number }

type RepriceInput = Pick<CounterOrderPayload, 'lines' | 'discount' | 'subtotalCentavos' | 'discountCentavos' | 'totalCentavos'>

/**
 * Re-prices a counter order against the menu version it was rung on. Availability is ignored on
 * purpose: a sold-out mark never makes a sale that already happened wrong.
 */
export function repriceCounterOrder(
  snapshot: MenuSnapshot,
  order: RepriceInput,
): { matches: boolean; expected: Totals; mismatchedLines: number[] } {
  const items = new Map(snapshot.categories.flatMap((c) => c.items).map((i) => [i.id, i]))
  const groups = new Map(snapshot.optionGroups.map((g) => [g.id, g]))

  const mismatchedLines: number[] = []
  const expectedLines = order.lines.map((line, index) => {
    const priced = priceFromSnapshot(line)
    if (!priced || !priced.pricesAgree || priced.total !== line.lineTotalCentavos) mismatchedLines.push(index)
    return { lineTotalCentavos: priced?.total ?? 0 }
  })

  /** The snapshot's price for a line, and whether the line's own base and option prices agree with it. */
  function priceFromSnapshot(line: PricedLine): { total: number; pricesAgree: boolean } | null {
    const item = items.get(line.menuItemId)
    const variant = item?.variants.find((v) => v.code === line.size)
    if (!item || !variant) return null
    // A free drink has no base price; its add-ons are still charged.
    const basePriceCentavos = line.reward ? 0 : variant.priceCentavos
    const options = item.optionGroupIds.flatMap((id) => groups.get(id)?.options ?? [])
    let pricesAgree = basePriceCentavos === line.basePriceCentavos
    const modifiers: { priceCentavos: number }[] = []
    for (const m of line.modifiers) {
      const option = options.find((o) => o.id === m.id)
      if (!option) return null
      if (option.priceCentavos !== m.priceCentavos) pricesAgree = false
      modifiers.push({ priceCentavos: option.priceCentavos })
    }
    try {
      return { total: lineTotal({ basePriceCentavos, modifiers, quantity: line.quantity }), pricesAgree }
    } catch {
      return null
    }
  }

  let discount: Discount | null = null
  let discountValid = true
  try {
    discount = cleanDiscount(order.discount)
  } catch {
    discountValid = false
  }
  const expected = totals(expectedLines, discount)
  const matches =
    discountValid &&
    mismatchedLines.length === 0 &&
    expected.subtotalCentavos === order.subtotalCentavos &&
    expected.discountCentavos === order.discountCentavos &&
    expected.totalCentavos === order.totalCentavos
  return { matches, expected, mismatchedLines }
}

const PREP_STATUSES: readonly string[] = ['placed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const isStr = (x: unknown): x is string => typeof x === 'string'

function isOnlineQueueLine(x: unknown): x is OnlineQueueLine {
  return (
    isObj(x) &&
    isStr(x.name) &&
    isStr(x.size) &&
    Number.isInteger(x.quantity) &&
    (x.quantity as number) >= 1 &&
    Array.isArray(x.options) &&
    x.options.every(isStr) &&
    (x.iceLevel === null || x.iceLevel === 'regular' || x.iceLevel === 'less' || x.iceLevel === 'none') &&
    (x.iceServe === null || x.iceServe === 'mixed' || x.iceServe === 'side') &&
    isStr(x.note)
  )
}

/**
 * Shape check for one pulled online order. A pickup has no delivery details; a delivery still to be handed over has
 * them. A completed delivery may come either way (the API drops them; an older one did not), and the till stores it
 * without them.
 */
export function isOnlineQueueOrder(x: unknown): x is OnlineQueueOrder {
  if (!isObj(x)) return false
  if (!isStr(x.id) || !UUID.test(x.id)) return false
  if (!isStr(x.businessDay) || !isStr(x.customerName) || !isStr(x.fulfilAt)) return false
  if (!isStr(x.createdAt) || !isStr(x.updatedAt)) return false
  if (!Number.isInteger(x.ticketNumber) || (x.ticketNumber as number) < 1) return false
  if (x.fulfilment !== 'pickup' && x.fulfilment !== 'delivery') return false
  if (x.customerNote !== null && !isStr(x.customerNote)) return false
  if (x.card !== undefined && x.card !== null && x.card !== 'stamp' && x.card !== 'stamped' && x.card !== 'paper') return false
  if (!isStr(x.prepStatus) || !PREP_STATUSES.includes(x.prepStatus)) return false
  if (!Array.isArray(x.lines) || !x.lines.every(isOnlineQueueLine)) return false
  if (x.fulfilment === 'delivery') {
    const d = x.delivery
    if (d === null && x.prepStatus === 'completed') return true
    return isObj(d) && isStr(d.address) && isStr(d.barangay) && isStr(d.phone)
  }
  return x.delivery === null
}

export type OnlinePrepDecision = 'move' | 'same' | 'conflict' | 'cancelled' | 'not_paid' | 'refused'

/** What to do with a prep step on an online order, checked against the order's state when it is received. */
export function onlinePrepDecision(
  current: PrepStatus,
  to: PrepStatus,
  fulfilment: Fulfilment,
  paymentStatus: PaymentStatus,
): OnlinePrepDecision {
  if (current === 'cancelled') return 'cancelled'
  if (paymentStatus !== 'paid') return 'not_paid'
  if (to === 'cancelled') return 'refused'
  if (to === current) return 'same'
  return canMovePrep(current, to, fulfilment) ? 'move' : 'conflict'
}

/** One receipt in a sentence, with the money it carries as sent (null when it carries none or it cannot be read). */
export type EventSummary = { label: string; amountCentavos: number | null }

/** A receipt that needs, or had, the owner's eye. `action` is what the owner can still do with it. */
export type AttentionEvent = {
  deviceId: string
  deviceName: string
  deviceRevoked: boolean
  id: string
  seq: number
  kind: string
  result: 'held' | 'flagged' | 'discarded'
  reason: string | null
  summary: EventSummary
  staffName: string | null
  occurredAt: string
  receivedAt: string
  resolvedAt: string | null
  resolvedByName: string | null
  resolveNote: string | null
  action: 'discard' | 'seen' | null
}

/** A stored order with a flag other than `legacy`. */
export type FlaggedOrder = {
  id: string
  ticket: string
  channel: 'counter' | 'online'
  businessDay: string
  flags: string[]
  totalCentavos: number
  deviceName: string | null
  seenAt: string | null
}

/** An open shift. `blocking` counts that device's events held `another_shift_open`. */
export type OpenShift = {
  id: string
  deviceId: string
  deviceName: string
  deviceRevoked: boolean
  openedAt: string
  openedByName: string | null
  openingFloatCentavos: number
  blocking: number
}

/** A stamp rung up for a customer who has since gone on paper cards; an owner or manager applies or discards it. */
export type PaperStamp = {
  id: string
  orderId: string
  ticket: string
  customerId: string
  customerCode: string
  displayName: string
  customerMode: StampMode
  stampedAt: string
  deviceName: string | null
  staffName: string | null
}

export type AttentionView = { events: AttentionEvent[]; orders: FlaggedOrder[]; shifts: OpenShift[]; stamps: PaperStamp[] }

const money = (x: unknown): number | null => (Number.isInteger(x) ? (x as number) : null)
const ticketOf = (p: Record<string, unknown>): string | null =>
  Number.isInteger(p.ticketNumber) && Array.isArray(p.lines) ? `C${p.ticketNumber as number}` : null
const cashOf = (p: Record<string, unknown>): string | null =>
  (p.kind === 'in' || p.kind === 'out') && isStr(p.reason) ? `cash ${p.kind}: ${p.reason}` : null

/**
 * Describes a receipt for Needs a look and the report. The payload is whatever the till sent (it may
 * have failed validation), so every field is checked; a payload that cannot be read is just its kind.
 */
export function eventSummary(kind: string, payload: unknown): EventSummary {
  const garbled: EventSummary = { label: kind, amountCentavos: null }
  if (!isObj(payload)) return garbled
  const p = payload
  const say = (label: string | null, amount: unknown = null): EventSummary =>
    label === null ? garbled : { label, amountCentavos: money(amount) }
  switch (kind) {
    case 'order.created': {
      const ticket = ticketOf(p)
      if (ticket === null) return garbled
      const n = (p.lines as unknown[]).length
      return say(`Sale ${ticket}, ${n} ${n === 1 ? 'line' : 'lines'}`, p.totalCentavos)
    }
    case 'order.prep_status':
      return say(isStr(p.to) ? `Step to ${p.to}` : null)
    case 'order.cancelled':
      return say(isStr(p.reason) ? `Void: ${p.reason}` : null)
    case 'shift.opened':
      return say('Shift opened', p.openingFloatCentavos)
    case 'shift.closed':
      return say('Shift closed', p.countedCentavos)
    case 'cash.moved': {
      const cash = cashOf(p)
      return say(cash && `C${cash.slice(1)}`, p.amountCentavos)
    }
    case 'menu.availability':
      return say(typeof p.available === 'boolean' ? (p.available ? 'Back on sale' : 'Sold out') : null)
    case 'customer.linked': {
      if (!isStr(p.publicCode)) return garbled
      // A code that fails its check is shown as sent: the receipt says what the till said.
      const code = normalisePublicCode(p.publicCode)
      return say(`Customer added: ${code ? formatPublicCode(code) : p.publicCode}`)
    }
    case 'customer.unlinked':
      return say('Customer removed')
    case 'stamp.added':
      return say('Stamp')
    case 'reward.used':
      return say('Free drink used')
    case 'import.order': {
      const ticket = ticketOf(p)
      return say(ticket && `Old sale ${ticket} (before sync)`, p.totalCentavos)
    }
    case 'import.shift':
      return say('Old shift (before sync)', p.openingFloatCentavos)
    case 'import.cash_move': {
      const cash = cashOf(p)
      return say(cash && `Old ${cash} (before sync)`, p.amountCentavos)
    }
    default:
      return garbled
  }
}

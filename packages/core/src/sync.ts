import { cleanDiscount, lineTotal, totals, type Discount, type PricedLine, type Totals } from './cart.ts'
import type { OrderStatus, OrderType, PaymentMethod } from './order.ts'
import type { IceLevel, IceServe } from './ice.ts'
import { canMovePrep, type Fulfilment, type PaymentStatus, type PrepStatus } from './order-status.ts'
import type { MenuSnapshot } from './snapshot.ts'

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
}

export type PullState = {
  /** null = nothing published; snapshot null = the till already has that version. */
  menu: { version: number; snapshot: MenuSnapshot | null } | null
  soldOut: string[]
  staff: PulledStaff[]
  shop: { name: string; address: string; phone: string | null }
  /** Absent = an API from before Plan 5: the till keeps the online orders it has. */
  onlineOrders?: OnlineQueueOrder[]
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
    const options = item.optionGroupIds.flatMap((id) => groups.get(id)?.options ?? [])
    let pricesAgree = variant.priceCentavos === line.basePriceCentavos
    const modifiers: { priceCentavos: number }[] = []
    for (const m of line.modifiers) {
      const option = options.find((o) => o.id === m.id)
      if (!option) return null
      if (option.priceCentavos !== m.priceCentavos) pricesAgree = false
      modifiers.push({ priceCentavos: option.priceCentavos })
    }
    try {
      return { total: lineTotal({ basePriceCentavos: variant.priceCentavos, modifiers, quantity: line.quantity }), pricesAgree }
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

/** Shape check for one pulled online order. Delivery details exist exactly when it is a delivery. */
export function isOnlineQueueOrder(x: unknown): x is OnlineQueueOrder {
  if (!isObj(x)) return false
  if (!isStr(x.id) || !UUID.test(x.id)) return false
  if (!isStr(x.businessDay) || !isStr(x.customerName) || !isStr(x.fulfilAt)) return false
  if (!isStr(x.createdAt) || !isStr(x.updatedAt)) return false
  if (!Number.isInteger(x.ticketNumber) || (x.ticketNumber as number) < 1) return false
  if (x.fulfilment !== 'pickup' && x.fulfilment !== 'delivery') return false
  if (x.customerNote !== null && !isStr(x.customerNote)) return false
  if (!isStr(x.prepStatus) || !PREP_STATUSES.includes(x.prepStatus)) return false
  if (!Array.isArray(x.lines) || !x.lines.every(isOnlineQueueLine)) return false
  if (x.fulfilment === 'delivery') {
    const d = x.delivery
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

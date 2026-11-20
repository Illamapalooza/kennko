import type { PricedLine } from './cart.ts'

/** The same steps the wall's cats follow, so the wall can be driven straight from the till. */
export const FLOW = ['queued', 'preparing', 'serving', 'done'] as const

export type OrderStatus = (typeof FLOW)[number] | 'voided'
export type OrderType = 'dine_in' | 'takeout'
export type PaymentMethod = 'cash' | 'gcash'

export const ORDER_TYPE_LABELS: Record<OrderType, string> = { dine_in: 'Dine in', takeout: 'Take out' }
export const PAYMENT_LABELS: Record<PaymentMethod, string> = { cash: 'Cash', gcash: 'GCash' }
export const STATUS_LABELS: Record<OrderStatus, string> = {
  queued: 'Queued', preparing: 'Preparing', serving: 'Serving', done: 'Done', voided: 'Voided',
}

export type Order = {
  id: number
  /** Manila calendar day, YYYY-MM-DD. */
  day: string
  /** Counts up from 1 each day; this is the number said to the customer. */
  number: number
  type: OrderType
  customerName: string
  status: OrderStatus
  lines: PricedLine[]
  subtotalCentavos: number
  discountCentavos: number
  discountLabel: string | null
  totalCentavos: number
  paymentMethod: PaymentMethod
  tenderedCentavos: number | null
  changeCentavos: number | null
  paymentRef: string | null
  shiftId: number
  createdAt: number
  updatedAt: number
  voidedAt: number | null
  voidReason: string | null
  /** Who approved the void, when the till knows them (counter orders only). */
  voidedByName?: string | null
}

export type Shift = {
  id: number
  openedAt: number
  openingFloatCentavos: number
  closedAt: number | null
  countedCentavos: number | null
  note: string
}

export type CashMove = {
  id: number
  shiftId: number
  kind: 'in' | 'out'
  amountCentavos: number
  reason: string
  at: number
  /** Who is credited with the cash move, when the till knows them. */
  staffName?: string | null
}

/** Calendar day in Manila (UTC+8, no daylight saving). */
export function manilaDay(ms: number): string {
  return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

export function nextStatus(status: OrderStatus): OrderStatus | null {
  const i = FLOW.indexOf(status as (typeof FLOW)[number])
  return i === -1 || i === FLOW.length - 1 ? null : FLOW[i + 1]
}

export function prevStatus(status: OrderStatus): OrderStatus | null {
  const i = FLOW.indexOf(status as (typeof FLOW)[number])
  return i <= 0 ? null : FLOW[i - 1]
}

export type ItemSales = { name: string; size: string; quantity: number; salesCentavos: number }

export type Summary = {
  orderCount: number
  /** Before discounts. */
  grossCentavos: number
  discountCentavos: number
  /** What customers actually paid. */
  netCentavos: number
  cash: { count: number; totalCentavos: number }
  gcash: { count: number; totalCentavos: number }
  dineInCount: number
  takeoutCount: number
  voidCount: number
  voidCentavos: number
  cashInCentavos: number
  cashOutCentavos: number
  openingFloatCentavos: number
  /** Float + cash sales + cash in - cash out: what should be in the drawer. */
  expectedCashCentavos: number
  /** Best sellers first. Sales are before order-level discounts. */
  items: ItemSales[]
}

export function summarise(orders: Order[], moves: CashMove[], openingFloatCentavos: number): Summary {
  const s: Summary = {
    orderCount: 0, grossCentavos: 0, discountCentavos: 0, netCentavos: 0,
    cash: { count: 0, totalCentavos: 0 }, gcash: { count: 0, totalCentavos: 0 },
    dineInCount: 0, takeoutCount: 0, voidCount: 0, voidCentavos: 0,
    cashInCentavos: 0, cashOutCentavos: 0, openingFloatCentavos, expectedCashCentavos: 0, items: [],
  }
  const items = new Map<string, ItemSales>()
  for (const order of orders) {
    if (order.status === 'voided') {
      s.voidCount += 1
      s.voidCentavos += order.totalCentavos
      continue
    }
    s.orderCount += 1
    s.grossCentavos += order.subtotalCentavos
    s.discountCentavos += order.discountCentavos
    s.netCentavos += order.totalCentavos
    s[order.paymentMethod].count += 1
    s[order.paymentMethod].totalCentavos += order.totalCentavos
    if (order.type === 'dine_in') s.dineInCount += 1
    else s.takeoutCount += 1
    for (const line of order.lines) {
      const key = `${line.name}|${line.size}`
      const row = items.get(key) ?? { name: line.name, size: line.size, quantity: 0, salesCentavos: 0 }
      row.quantity += line.quantity
      row.salesCentavos += line.lineTotalCentavos
      items.set(key, row)
    }
  }
  for (const move of moves) {
    if (move.kind === 'in') s.cashInCentavos += move.amountCentavos
    else s.cashOutCentavos += move.amountCentavos
  }
  s.expectedCashCentavos = openingFloatCentavos + s.cash.totalCentavos + s.cashInCentavos - s.cashOutCentavos
  s.items = [...items.values()].sort((a, b) => b.quantity - a.quantity || b.salesCentavos - a.salesCentavos || a.name.localeCompare(b.name))
  return s
}

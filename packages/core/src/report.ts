import { ticketLabel, type Fulfilment, type PaymentStatus, type PrepStatus } from './order-status.ts'

/** One order on the day (by `business_day`), with its payments. */
export type DayOrderRow = {
  id: string
  channel: 'counter' | 'online'
  fulfilment: Fulfilment
  ticketSeries: 'C' | 'W'
  ticketNumber: number
  deviceName: string | null
  shiftId: string | null
  prepStatus: PrepStatus
  paymentStatus: PaymentStatus
  subtotalCentavos: number
  discountCentavos: number
  deliveryFeeCentavos: number
  totalCentavos: number
  flags: string[]
  payments: { method: 'cash' | 'gcash'; amountCentavos: number; status: string }[]
}

/** One line of a day's order, as sold. */
export type DayLineRow = { orderId: string; itemName: string; variantLabel: string; quantity: number; lineTotalCentavos: number }

/**
 * A shift opened on the day (Manila day of `openedAt`). `closedAt` is the till's close time (or the owner's, for an
 * admin close); `closeReceivedAt` is when the server stored that close, so it compares with a sale's `receivedAt`.
 */
export type DayShiftRow = {
  id: string
  deviceName: string
  openedAt: string
  closedAt: string | null
  closeReceivedAt: string | null
  openedByName: string | null
  closedByName: string | null
  openingFloatCentavos: number
  countedCentavos: number | null
  expectedCentavos: number | null
  closedInAdmin: boolean
  cashInCentavos: number
  cashOutCentavos: number
}

/** A counted order of one of the day's shifts, whatever its business day, with the cash it took. */
export type ShiftSaleRow = { shiftId: string; orderId: string; cashCentavos: number; receivedAt: string }

/** A sale the server could not store (held) or the owner set aside (discarded), with its ticket and total as sent. */
export type HeldSaleRow = {
  deviceName: string
  eventId: string
  result: 'held' | 'discarded'
  reason: string | null
  ticketNumber: number | null
  totalCentavos: number | null
  note: string | null
}

export type DayRows = {
  date: string
  orders: DayOrderRow[]
  lines: DayLineRow[]
  shifts: DayShiftRow[]
  shiftSales: ShiftSaleRow[]
  heldSales: HeldSaleRow[]
}

type Tally = { orders: number; totalCentavos: number }
type Count = { count: number; totalCentavos: number }

export type DayReport = {
  date: string
  sales: {
    orders: number
    totalCentavos: number
    discountCentavos: number
    deliveryFeeCentavos: number
    counter: {
      orders: number
      totalCentavos: number
      byTill: { deviceName: string; orders: number; totalCentavos: number; firstTicket: string; lastTicket: string }[]
    }
    online: { orders: number; totalCentavos: number; pickup: number; delivery: number }
  }
  payments: { cashCentavos: number; gcashCentavos: number }
  cancelled: { counterVoids: Tally; onlineRefunded: Tally; onlineRejected: Tally }
  awaitingVerification: Tally
  items: { name: string; variant: string; quantity: number; totalCentavos: number }[]
  shifts: {
    id: string
    deviceName: string
    openedAt: string
    closedAt: string | null
    openedByName: string | null
    closedByName: string | null
    floatCentavos: number
    cashSalesCentavos: number
    cashInCentavos: number
    cashOutCentavos: number
    expectedCentavos: number
    countedCentavos: number | null
    overShortCentavos: number | null
    closedInAdmin: boolean
    lateSales: number
  }[]
  flagged: { id: string; ticket: string; channel: 'counter' | 'online'; flags: string[]; totalCentavos: number; deviceName: string | null }[]
  legacy: Tally
  held: { held: Count; setAside: Count; rows: HeldSaleRow[] }
}

/** A sale (Ruling 7): not cancelled and paid. */
const isCounted = (o: DayOrderRow) => o.prepStatus !== 'cancelled' && o.paymentStatus === 'paid'
/** A payment that took money: recorded at the till or verified online. */
const tookMoney = (p: { status: string }) => p.status === 'recorded' || p.status === 'verified'

const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0)
const tally = (xs: DayOrderRow[]): Tally => ({ orders: xs.length, totalCentavos: sum(xs, (o) => o.totalCentavos) })
const count = (xs: HeldSaleRow[]): Count => ({ count: xs.length, totalCentavos: sum(xs, (h) => h.totalCentavos ?? 0) })
const paid = (orders: DayOrderRow[], method: 'cash' | 'gcash') =>
  sum(orders, (o) => sum(o.payments.filter((p) => p.method === method && tookMoney(p)), (p) => p.amountCentavos))

/**
 * Tills on the day: their sales, and the range of tickets they issued (voids included, since a voided ticket was
 * still handed out), so a gap in the numbers shows.
 */
function byTill(counter: DayOrderRow[]): DayReport['sales']['counter']['byTill'] {
  const tills = new Map<string, DayOrderRow[]>()
  for (const o of counter) {
    const name = o.deviceName ?? ''
    tills.set(name, [...(tills.get(name) ?? []), o])
  }
  return [...tills.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([deviceName, orders]) => {
      const sales = orders.filter(isCounted)
      const numbers = orders.map((o) => o.ticketNumber)
      return {
        deviceName,
        orders: sales.length,
        totalCentavos: sum(sales, (o) => o.totalCentavos),
        firstTicket: ticketLabel('C', Math.min(...numbers)),
        lastTicket: ticketLabel('C', Math.max(...numbers)),
      }
    })
}

function items(lines: DayLineRow[], counted: Set<string>): DayReport['items'] {
  const rows = new Map<string, DayReport['items'][number]>()
  for (const l of lines) {
    if (!counted.has(l.orderId)) continue
    const key = JSON.stringify([l.itemName, l.variantLabel])
    const row = rows.get(key) ?? { name: l.itemName, variant: l.variantLabel, quantity: 0, totalCentavos: 0 }
    row.quantity += l.quantity
    row.totalCentavos += l.lineTotalCentavos
    rows.set(key, row)
  }
  return [...rows.values()].sort(
    (a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name) || a.variant.localeCompare(b.variant),
  )
}

function shifts(rows: DayShiftRow[], sales: ShiftSaleRow[]): DayReport['shifts'] {
  return rows.map((s) => {
    const own = sales.filter((x) => x.shiftId === s.id)
    const cashSalesCentavos = sum(own, (x) => x.cashCentavos)
    const expectedCentavos =
      s.expectedCentavos ?? s.openingFloatCentavos + cashSalesCentavos + s.cashInCentavos - s.cashOutCentavos
    const closedAt = s.closeReceivedAt === null ? null : Date.parse(s.closeReceivedAt)
    return {
      id: s.id,
      deviceName: s.deviceName,
      openedAt: s.openedAt,
      closedAt: s.closedAt,
      openedByName: s.openedByName,
      closedByName: s.closedByName,
      floatCentavos: s.openingFloatCentavos,
      cashSalesCentavos,
      cashInCentavos: s.cashInCentavos,
      cashOutCentavos: s.cashOutCentavos,
      expectedCentavos,
      countedCentavos: s.countedCentavos,
      overShortCentavos: s.closedAt === null || s.countedCentavos === null ? null : s.countedCentavos - expectedCentavos,
      closedInAdmin: s.closedInAdmin,
      lateSales: closedAt === null ? 0 : own.filter((x) => Date.parse(x.receivedAt) > closedAt).length,
    }
  })
}

/**
 * The day report (Rulings 4, 7, 8). Pure: the API reads the rows, the web renders the result.
 *
 * - A sale is an order that is not cancelled and is paid; cash and GCash are its recorded or verified payments.
 * - Voids, online refunds, online rejections and payments awaiting verification are each listed apart.
 * - Legacy orders are inside the sales; `legacy` counts those sales. `flagged` lists orders with any other flag.
 * - A shift's cash sales are all its counted orders, whatever their day. Its expected is the till's, or float + cash
 *   sales + in − out when the till sent none (an admin close, or still open). A late sale was stored after the close.
 * - Held and set-aside sales are never in the sales.
 */
export function summariseDay(rows: DayRows): DayReport {
  const counted = rows.orders.filter(isCounted)
  const counter = counted.filter((o) => o.channel === 'counter')
  const online = counted.filter((o) => o.channel === 'online')
  const cancelled = (o: DayOrderRow) => o.prepStatus === 'cancelled'

  return {
    date: rows.date,
    sales: {
      ...tally(counted),
      discountCentavos: sum(counted, (o) => o.discountCentavos),
      deliveryFeeCentavos: sum(counted, (o) => o.deliveryFeeCentavos),
      counter: { ...tally(counter), byTill: byTill(rows.orders.filter((o) => o.channel === 'counter')) },
      online: {
        ...tally(online),
        pickup: online.filter((o) => o.fulfilment === 'pickup').length,
        delivery: online.filter((o) => o.fulfilment === 'delivery').length,
      },
    },
    payments: { cashCentavos: paid(counted, 'cash'), gcashCentavos: paid(counted, 'gcash') },
    cancelled: {
      counterVoids: tally(rows.orders.filter((o) => o.channel === 'counter' && cancelled(o))),
      onlineRefunded: tally(rows.orders.filter((o) => o.channel === 'online' && o.paymentStatus === 'refunded')),
      onlineRejected: tally(rows.orders.filter((o) => o.channel === 'online' && o.paymentStatus === 'rejected')),
    },
    awaitingVerification: tally(rows.orders.filter((o) => !cancelled(o) && o.paymentStatus === 'pending_verification')),
    items: items(rows.lines, new Set(counted.map((o) => o.id))),
    shifts: shifts(rows.shifts, rows.shiftSales),
    flagged: rows.orders
      .filter((o) => o.flags.some((f) => f !== 'legacy'))
      .map((o) => ({
        id: o.id,
        ticket: ticketLabel(o.ticketSeries, o.ticketNumber),
        channel: o.channel,
        flags: o.flags,
        totalCentavos: o.totalCentavos,
        deviceName: o.deviceName,
      })),
    legacy: tally(counted.filter((o) => o.flags.includes('legacy'))),
    held: {
      held: count(rows.heldSales.filter((h) => h.result === 'held')),
      setAside: count(rows.heldSales.filter((h) => h.result === 'discarded')),
      rows: rows.heldSales,
    },
  }
}

import { manilaDay, type Fulfilment, type OnlineQueueOrder, type PrepStatus } from '@kennko/core'

export type OnlineColumn = 'queued' | 'preparing' | 'serving'

/** Which board column an online order sits in; finished and cancelled ones are on no column. */
export function onlineColumn(p: PrepStatus): OnlineColumn | null {
  if (p === 'placed') return 'queued'
  if (p === 'preparing') return 'preparing'
  if (p === 'ready' || p === 'out_for_delivery') return 'serving'
  return null
}

/**
 * The one forward button. Online tickets have no Back and no Void. A delivery order "ready" or a pickup order "out for
 * delivery" should never happen; they get a neutral "Done" (it still completes the order) rather than a wrong promise.
 */
export function onlineAction(p: PrepStatus, fulfilment: Fulfilment): string | null {
  const delivery = fulfilment === 'delivery'
  if (p === 'placed') return 'Start'
  if (p === 'preparing') return delivery ? 'Out for delivery' : 'Ready'
  if (p === 'ready') return delivery ? 'Done' : 'Picked up'
  if (p === 'out_for_delivery') return delivery ? 'Delivered' : 'Done'
  return null
}

/** The serving stage under the ticket number; neutral words for the two impossible pairs (see onlineAction). */
export function onlineStage(p: PrepStatus, fulfilment: Fulfilment): string {
  const delivery = fulfilment === 'delivery'
  if (p === 'ready') return delivery ? 'Ready' : 'Ready for pickup'
  if (p === 'out_for_delivery') return delivery ? 'Out for delivery' : 'Sent out'
  return ''
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Pickup 3:30 PM", with the date first when it is not today. Manila time, whatever the computer's zone. */
export function onlineWhen(o: Pick<OnlineQueueOrder, 'fulfilment' | 'fulfilAt'>, now: number): string {
  const at = Date.parse(o.fulfilAt)
  const kind = o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'
  if (Number.isNaN(at)) return kind
  const m = new Date(at + 8 * 3600 * 1000)
  const h = m.getUTCHours()
  const time = `${h % 12 === 0 ? 12 : h % 12}:${String(m.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
  const date = manilaDay(at) === manilaDay(now) ? '' : `${DAYS[m.getUTCDay()]} ${m.getUTCDate()} ${MONTHS[m.getUTCMonth()]}, `
  return `${kind} ${date}${time}`
}

export function deliveryText(o: Pick<OnlineQueueOrder, 'fulfilment' | 'delivery'>): string | null {
  if (o.fulfilment !== 'delivery' || !o.delivery) return null
  return `${[o.delivery.address, o.delivery.barangay].filter(Boolean).join(', ')} · ${o.delivery.phone}`
}

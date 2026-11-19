import { formatPesos } from '@/lib/money'

export type OrderEmailData = {
  orderCode: string
  /** The customer-facing number, e.g. W3. Leads the staff alert when present. */
  ticket?: string
  customerName: string
  fulfilment: 'pickup' | 'delivery'
  fulfilAt: string
  totalCentavos: number
  deliveryAddress?: string | null
  items: {
    name: string; quantity: number
    variantLabel: string
    ice?: string | null; note?: string | null
  }[]
}

function itemLines(items: OrderEmailData['items']): string {
  return items
    .map((i) => {
      const ice = i.ice ? ` -- ${i.ice}` : ''
      const note = i.note ? `\n      NOTE: ${i.note}` : ''
      return `  ${i.quantity}x ${i.name} (${i.variantLabel})${ice}${note}`
    })
    .join('\n')
}

export function staffAlertSubject(data: OrderEmailData): string {
  const lead = data.ticket ? `${data.ticket} · ${data.orderCode}` : data.orderCode
  return `New order ${lead} — ${formatPesos(data.totalCentavos)} (${data.fulfilment})`
}

export function staffAlertBody(data: OrderEmailData): string {
  const where =
    data.fulfilment === 'delivery'
      ? `Deliver to: ${data.deliveryAddress}`
      : 'For pickup at the counter'

  return [
    `New order ${data.ticket ? `${data.ticket} · ` : ''}${data.orderCode} from ${data.customerName}.`,
    '',
    itemLines(data.items),
    '',
    `Total: ${formatPesos(data.totalCentavos)}`,
    where,
    `Time: ${data.fulfilAt}`,
    '',
    'PAYMENT IS NOT VERIFIED YET. Check the GCash reference against the app,',
    'then confirm the order in the admin before making anything.',
  ].join('\n')
}

export function customerConfirmSubject(data: OrderEmailData): string {
  return `Your Kennko order ${data.orderCode} is confirmed`
}

export function customerConfirmBody(data: OrderEmailData): string {
  const where =
    data.fulfilment === 'delivery'
      ? `We will deliver it to ${data.deliveryAddress}.`
      : 'Pick it up at Kennko, CT. Montalban St., Villa Kananga.'

  return [
    `Hi ${data.customerName},`,
    '',
    `We checked your GCash payment and your order ${data.orderCode} is confirmed.`,
    '',
    itemLines(data.items),
    '',
    `Total paid: ${formatPesos(data.totalCentavos)}`,
    where,
    `Time: ${data.fulfilAt}`,
    '',
    'Thanks for ordering from Kennko Coffee.',
  ].join('\n')
}

export function customerRejectSubject(data: OrderEmailData): string {
  return `We could not verify payment for Kennko order ${data.orderCode}`
}

export function customerRejectBody(data: OrderEmailData, reason: string): string {
  return [
    `Hi ${data.customerName},`,
    '',
    `We could not match a GCash payment to your order ${data.orderCode}, so we`,
    'have not started preparing it.',
    '',
    `Reason: ${reason}`,
    '',
    'If you believe this is a mistake, reply to this email or message us on',
    'Facebook at facebook.com/kennco.cafebxu with your GCash receipt.',
  ].join('\n')
}

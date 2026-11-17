import { ORDER_TYPE_LABELS, PAYMENT_LABELS, iceLabel, type Order } from '@kennko/core'

const cell = (value: string | number | null) => {
  const text = value === null ? '' : String(value)
  // A leading = + - @ would be run as a formula by a spreadsheet.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}
const pesos = (centavos: number | null) => (centavos === null ? '' : (centavos / 100).toFixed(2))
const time = (ms: number) => new Date(ms + 8 * 3600 * 1000).toISOString().slice(11, 16)

/** One row per drink line, with the order's totals repeated on its first line only so column sums stay right. */
export function reportCsv(orders: Order[]): string {
  const rows = [[
    'Day', 'Order #', 'Time', 'Status', 'Type', 'Customer', 'Drink', 'Size', 'Add-ons', 'Instructions', 'Qty', 'Line total',
    'Order subtotal', 'Discount', 'Discount name', 'Order total', 'Payment', 'GCash ref', 'Void reason',
  ].join(',')]
  for (const order of orders) {
    order.lines.forEach((line, index) => {
      const first = index === 0
      rows.push([
        order.day, order.number, time(order.createdAt), order.status, ORDER_TYPE_LABELS[order.type], order.customerName,
        line.name, line.size, line.modifiers.map((m) => m.name).join('; '),
        [iceLabel(line.iceLevel, line.iceServe), line.note].filter(Boolean).join('; '),
        line.quantity, pesos(line.lineTotalCentavos),
        first ? pesos(order.subtotalCentavos) : '', first ? pesos(order.discountCentavos) : '', first ? order.discountLabel : '',
        first ? pesos(order.totalCentavos) : '', first ? PAYMENT_LABELS[order.paymentMethod] : '', first ? order.paymentRef : '',
        first ? order.voidReason : '',
      ].map(cell).join(','))
    })
  }
  return `﻿${rows.join('\r\n')}\r\n`
}

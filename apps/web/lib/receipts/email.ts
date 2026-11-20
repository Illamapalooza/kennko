import { formatPesos } from '@/lib/money'
import type { Receipt, ReceiptLine } from './receipt'

const BLUE = '#0055FF'

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function lineTitle(l: ReceiptLine): string {
  return `${l.quantity}x ${l.itemName}${l.variantLabel ? ` (${l.variantLabel})` : ''}`
}

function totalsRows(r: Receipt): [string, number][] {
  const rows: [string, number][] = [['Subtotal', r.subtotal]]
  if (r.discount > 0) rows.push(['Discount', -r.discount])
  if (r.deliveryFee > 0) rows.push(['Delivery fee', r.deliveryFee])
  rows.push(['TOTAL PAID', r.total])
  return rows
}

function money(c: number): string {
  return c < 0 ? `-${formatPesos(-c)}` : formatPesos(c)
}

/** Monospace-friendly plain text. Same content as the HTML version. */
export function receiptText(r: Receipt): string {
  const rule = '-'.repeat(40)
  const out: string[] = [rule, r.title, r.notice]
  if (r.stamp) out.push(`*** ${r.stamp} ***`)
  out.push(rule, r.seller.registeredName ?? r.seller.name)
  if (r.seller.registeredName) out.push(r.seller.name)
  out.push(r.seller.address)
  if (r.seller.phone) out.push(`Tel: ${r.seller.phone}`)
  if (r.seller.tin) out.push(`TIN: ${r.seller.tin}`)
  if (r.seller.facebookUrl) out.push(r.seller.facebookUrl)
  out.push(rule, `Order: ${r.orderCode}`, `Ticket: ${r.ticket}`, `Customer: ${r.customer}`, `For: ${r.fulfilment}`)
  if (r.paidAt) out.push(`Paid: ${r.paidAt}`)
  if (r.reference) out.push(`GCash ref: ${r.reference}`)
  out.push(rule)
  for (const l of r.lines) {
    out.push(`${lineTitle(l)}  ${money(l.lineTotalCentavos)}`)
    for (const o of l.options) {
      out.push(`   + ${o.name}${o.priceCentavos ? ` ${money(o.priceCentavos)}` : ''}`)
    }
  }
  out.push(rule)
  for (const [label, amount] of totalsRows(r)) out.push(`${label}: ${money(amount)}`)
  out.push(rule, r.footer, r.notice)
  return out.join('\n')
}

/** Table layout, inline styles only. Every dynamic string is escaped. */
export function receiptHtml(r: Receipt): string {
  const e = escapeHtml
  const cell = 'padding:4px 0;font-size:14px;color:#111111;'
  const meta = (label: string, value: string) =>
    value
      ? `<tr><td style="${cell}color:#666666;width:110px;">${e(label)}</td><td style="${cell}">${e(value)}</td></tr>`
      : ''

  const lines = r.lines
    .map((l) => {
      const opts = l.options
        .map(
          (o) =>
            `<div style="font-size:12px;color:#666666;">+ ${e(o.name)}${o.priceCentavos ? ` ${e(money(o.priceCentavos))}` : ''}</div>`,
        )
        .join('')
      return `<tr><td style="${cell}border-bottom:1px solid #eeeeee;">${e(lineTitle(l))}${opts}</td><td align="right" style="${cell}border-bottom:1px solid #eeeeee;vertical-align:top;">${e(money(l.lineTotalCentavos))}</td></tr>`
    })
    .join('')

  const totals = totalsRows(r)
    .map(([label, amount], i, all) => {
      const last = i === all.length - 1
      const style = `${cell}${last ? 'font-weight:bold;font-size:16px;border-top:2px solid #111111;' : ''}`
      return `<tr><td style="${style}">${e(label)}</td><td align="right" style="${style}">${e(money(amount))}</td></tr>`
    })
    .join('')

  const sellerLines = [
    r.seller.registeredName ? r.seller.name : null,
    r.seller.address,
    r.seller.phone ? `Tel: ${r.seller.phone}` : null,
    r.seller.tin ? `TIN: ${r.seller.tin}` : null,
    r.seller.facebookUrl,
  ]
    .filter((x): x is string => !!x)
    .map((x) => e(x))
    .join('<br>')

  const stamp = r.stamp
    ? `<tr><td style="padding:8px 20px;background:#fff3cd;color:#8a5a00;font-weight:bold;text-align:center;font-size:14px;">${e(r.stamp)}</td></tr>`
    : ''

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;border:1px solid #dddddd;font-family:Arial,Helvetica,sans-serif;background:#ffffff;">
<tr><td style="background:${BLUE};color:#ffffff;padding:16px 20px;"><div style="font-size:20px;font-weight:bold;">${e(r.seller.registeredName ?? r.seller.name)}</div><div style="font-size:13px;letter-spacing:1px;">${e(r.title)}</div></td></tr>
<tr><td style="padding:10px 20px;background:#111111;color:#ffffff;text-align:center;font-weight:bold;font-size:14px;letter-spacing:1px;">${e(r.notice)}</td></tr>
${stamp}
<tr><td style="padding:12px 20px;font-size:12px;color:#666666;line-height:1.5;">${sellerLines}</td></tr>
<tr><td style="padding:0 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${meta('Order', r.orderCode)}${meta('Ticket', r.ticket)}${meta('Customer', r.customer)}${meta('For', r.fulfilment)}${meta('Paid', r.paidAt)}${meta('GCash ref', r.reference)}
</table></td></tr>
<tr><td style="padding:12px 20px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${lines}</table></td></tr>
<tr><td style="padding:8px 20px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${totals}</table></td></tr>
<tr><td style="padding:16px 20px;font-size:12px;color:#666666;text-align:center;">${e(r.footer)}<div style="margin-top:8px;font-weight:bold;color:#111111;">${e(r.notice)}</div></td></tr>
</table>`
}

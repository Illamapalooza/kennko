import { ORDER_TYPE_LABELS, PAYMENT_LABELS, formatPesos, iceLabel, sizeTag, type Order } from '@kennko/core'
import type { Bootstrap } from '../api.ts'

const when = (ms: number) => new Date(ms).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })

/** Sized for an 80mm thermal roll when printed; reads as a slip on screen. */
export function Receipt({ order, shop }: { order: Order; shop: Bootstrap['shop'] }) {
  return (
    <div className="receipt">
      <img src="/brand/wordmark-blue.png" alt={shop.name} className="receipt-logo" />
      <p className="receipt-shop">{shop.address}<br />{shop.phone}</p>
      <div className="receipt-number">
        <span>Order</span>
        <b>#{order.number}</b>
      </div>
      <p className="receipt-meta">
        {when(order.createdAt)} · {ORDER_TYPE_LABELS[order.type]}
        {order.customerName ? <> · {order.customerName}</> : null}
      </p>
      {order.status === 'voided' ? <p className="receipt-void">VOIDED{order.voidReason ? `: ${order.voidReason}` : ''}</p> : null}
      <table className="receipt-lines">
        <tbody>
          {order.lines.map((line, i) => {
            const extras = [...line.modifiers.map((m) => m.name), iceLabel(line.iceLevel, line.iceServe), line.note].filter(Boolean).join(', ')
            return (
              <tr key={i}>
                <td>{line.quantity}×</td>
                <td>
                  {line.name}{sizeTag(line.size) ? <> <span className="receipt-size">{sizeTag(line.size)}</span></> : null}
                  {extras ? <small>{extras}</small> : null}
                </td>
                <td>{formatPesos(line.lineTotalCentavos)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <dl className="receipt-totals">
        {order.discountCentavos > 0 ? (
          <>
            <div><dt>Subtotal</dt><dd>{formatPesos(order.subtotalCentavos)}</dd></div>
            <div><dt>{order.discountLabel ?? 'Discount'}</dt><dd>-{formatPesos(order.discountCentavos)}</dd></div>
          </>
        ) : null}
        <div className="receipt-total"><dt>Total</dt><dd>{formatPesos(order.totalCentavos)}</dd></div>
        <div><dt>{PAYMENT_LABELS[order.paymentMethod]}{order.paymentRef ? ` (${order.paymentRef})` : ''}</dt><dd>{formatPesos(order.tenderedCentavos ?? order.totalCentavos)}</dd></div>
        {order.changeCentavos !== null ? <div><dt>Change</dt><dd>{formatPesos(order.changeCentavos)}</dd></div> : null}
      </dl>
      <p className="receipt-foot">{shop.receiptFooter}</p>
    </div>
  )
}

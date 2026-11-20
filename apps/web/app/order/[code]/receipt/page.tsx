import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getCurrentCustomer } from '@/lib/auth/customer'
import { OrderNav } from '@/components/order/OrderNav'
import { formatPesos } from '@/lib/money'
import { loadReceiptOrder, loadShopSettings } from '@/lib/receipts/load'
import { buildReceipt } from '@/lib/receipts/receipt'
import { PrintButton } from './PrintButton'
import '../../order.css'
import './receipt.css'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Order receipt', robots: { index: false, follow: false } }

export default async function ReceiptPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const order = await loadReceiptOrder(code)
  if (!order) notFound()
  const [settings, customer] = await Promise.all([loadShopSettings(), getCurrentCustomer()])
  const receipt = buildReceipt(order, settings, 'public')

  return (
    <div className="order-shell receipt-shell">
      <div className="order-main order-main-nav receipt-hide">
        <OrderNav place="receipt" signedIn={Boolean(customer)} customerName={customer?.name} />
      </div>
      <div className="order-main">
        {!receipt ? (
          <div className="order-card">
            <p>This order has no confirmed payment yet.</p>
            <p><a href={`/order/${order.orderCode}`}>Back to your order status</a></p>
          </div>
        ) : (
          <>
            <article className="receipt" aria-label="Order receipt">
              {receipt.stamp ? <p className="receipt-stamp">{receipt.stamp}</p> : null}
              <header className="receipt-head">
                <h1>{receipt.seller.name}</h1>
                {receipt.seller.registeredName ? <p>{receipt.seller.registeredName}</p> : null}
                {receipt.seller.tin ? <p>TIN {receipt.seller.tin}</p> : null}
                <p>{receipt.seller.address}</p>
                {receipt.seller.phone ? <p>{receipt.seller.phone}</p> : null}
                {receipt.seller.facebookUrl ? <p>{receipt.seller.facebookUrl}</p> : null}
              </header>
              <h2 className="receipt-title">{receipt.title}</h2>
              <p className="receipt-notice">{receipt.notice}</p>

              <dl className="receipt-meta">
                <div><dt>Order</dt><dd>{receipt.orderCode}</dd></div>
                <div><dt>Number</dt><dd>{receipt.ticket}</dd></div>
                <div><dt>Customer</dt><dd>{receipt.customer}</dd></div>
                <div><dt>Type</dt><dd>{receipt.fulfilment}</dd></div>
                {receipt.paidAt ? <div><dt>Paid</dt><dd>{receipt.paidAt}</dd></div> : null}
                {receipt.reference ? <div><dt>GCash ref</dt><dd>{receipt.reference}</dd></div> : null}
              </dl>

              <ul className="receipt-lines">
                {receipt.lines.map((line, i) => (
                  <li key={`${line.itemName}-${i}`}>
                    <div className="receipt-row">
                      <span>{line.quantity} × {line.itemName} ({line.variantLabel})</span>
                      <span>{formatPesos(line.lineTotalCentavos)}</span>
                    </div>
                    <div className="receipt-sub">@ {formatPesos(line.unitPriceCentavos)}</div>
                    {line.options.map((o, j) => (
                      <div className="receipt-sub receipt-row" key={`${j}-${o.name}`}>
                        <span>+ {o.name}</span>
                        <span>{o.priceCentavos > 0 ? formatPesos(o.priceCentavos) : ''}</span>
                      </div>
                    ))}
                  </li>
                ))}
              </ul>

              <div className="receipt-totals">
                <div className="receipt-row"><span>Subtotal</span><span>{formatPesos(receipt.subtotal)}</span></div>
                {receipt.discount > 0 ? (
                  <div className="receipt-row"><span>Discount</span><span>-{formatPesos(receipt.discount)}</span></div>
                ) : null}
                {receipt.deliveryFee > 0 ? (
                  <div className="receipt-row"><span>Delivery fee</span><span>{formatPesos(receipt.deliveryFee)}</span></div>
                ) : null}
                <div className="receipt-row receipt-grand"><span>Total</span><span>{formatPesos(receipt.total)}</span></div>
              </div>

              <p className="receipt-footer">{receipt.footer}</p>
              <p className="receipt-notice">{receipt.notice}</p>
            </article>

            <div className="done-actions receipt-hide">
              <PrintButton />
              <a className="done-secondary" href={`/order/${order.orderCode}`}>Back to order status</a>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

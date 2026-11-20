import { notFound } from 'next/navigation'
import type { OrderStage } from '@kennko/core'
import { lookupOrder } from '@/lib/orders/lookup'
import { formatPesos } from '@/lib/money'
import { formatManilaDateTime } from '@/lib/format/time'
import { getCurrentCustomer } from '@/lib/auth/customer'
import { NotifyButton } from '@/components/order/NotifyButton'
import { OrderNav } from '@/components/order/OrderNav'
import '../order.css'

export const dynamic = 'force-dynamic'

const STATUS_COPY: Record<OrderStage, string> = {
  awaiting_verification:
    'We have your order and are checking your GCash payment. Nothing is being prepared yet.',
  confirmed: 'Payment checked. Your order is queued.',
  preparing: 'A barista is making your drinks now.',
  ready: 'Ready for pickup at CT. Montalban St., Villa Kananga.',
  out_for_delivery: 'On the way to you.',
  completed: 'Completed. Thanks for ordering from Kennko.',
  rejected:
    'We could not match a GCash payment to this order. Message us on Facebook with your receipt.',
  cancelled: 'This order was cancelled. Contact the cafe if that seems wrong.',
}

export default async function OrderStatusPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const order = await lookupOrder(code)
  if (!order) notFound()
  const customer = await getCurrentCustomer()

  return (
    <div className="order-shell">
      <div className="order-main order-main-nav">
        <OrderNav place="status" signedIn={Boolean(customer)} customerName={customer?.name} />
      </div>
      <div className="order-main">
        <h1>Order {order.orderCode}</h1>
        <p className="order-note">Your number: {order.ticket}</p>

        <div className="order-card">
          <p className={order.stage === 'awaiting_verification' ? 'order-note' : undefined}>
            {STATUS_COPY[order.stage]}
          </p>
        </div>

        <div className="order-card">
          {order.items.map((item, index) => (
            <div className="order-total" key={`${item.name}-${index}`}>
              <span>
                {item.quantity}× {item.name} ({item.variantLabel})
                {item.ice ? ` · ${item.ice}` : ''}
              </span>
            </div>
          ))}
          <div className="order-total grand">
            <span>Total</span>
            <span>{formatPesos(order.totalCentavos)}</span>
          </div>
        </div>

        <div className="order-card">
          <p>
            <strong>{order.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}</strong>
            {order.fulfilment === 'delivery' && order.deliveryAddress
              ? ` to ${order.deliveryAddress}`
              : ''}
          </p>
          <p>{formatManilaDateTime(order.fulfilAt)}</p>
        </div>

        <div className="done-actions">
          {order.hasConfirmedPayment ? (
            <a className="sheet-add" href={`/order/${order.orderCode}/receipt`}>View receipt</a>
          ) : null}
          <a className="sheet-add" href={customer ? '/orders' : '/account'}>My orders</a>
          <a className="done-secondary" href="/order">Order again</a>
        </div>
        {order.stage === 'completed' || order.stage === 'cancelled' ? null : (
          <NotifyButton orderCode={order.orderCode} />
        )}
      </div>
    </div>
  )
}

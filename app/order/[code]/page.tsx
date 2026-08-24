import { notFound } from 'next/navigation'
import { lookupOrder } from '@/lib/orders/lookup'
import { formatPesos } from '@/lib/money'
import '../order.css'

export const dynamic = 'force-dynamic'

const STATUS_COPY: Record<string, string> = {
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

  return (
    <div className="order-shell">
      <div className="order-main">
        <h1>Order {order.orderCode}</h1>

        <div className="order-card">
          <p className={order.status === 'awaiting_verification' ? 'order-note' : undefined}>
            {STATUS_COPY[order.status] ?? order.status}
          </p>
        </div>

        <div className="order-card">
          {order.items.map((item, index) => (
            <div className="order-total" key={`${item.name}-${index}`}>
              <span>
                {item.quantity}× {item.name} ({item.size})
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
          <p>{new Date(order.fulfilAt).toLocaleString('en-PH')}</p>
        </div>
      </div>
    </div>
  )
}

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentCustomer } from '@/lib/auth/customer'
import { getOrderHistory } from '@/lib/orders/history'
import { signOutCustomer } from '@/app/account/actions'
import { formatPesos } from '@/lib/money'
import { SIZE_VOLUMES } from '@/lib/menu/sizes'
import { statusLabel } from '@/app/admin/orders/status'
import type { OrderStage } from '@kennko/core'
import type { DrinkSize } from '@/lib/menu/types'
import '../order/order.css'

export const dynamic = 'force-dynamic'

const LIVE: OrderStage[] = [
  'awaiting_verification', 'confirmed', 'preparing', 'ready', 'out_for_delivery',
]

export default async function OrdersPage() {
  const customer = await getCurrentCustomer()
  if (!customer) redirect('/account?next=/orders')

  const orders = await getOrderHistory(customer)
  const live = orders.filter((o) => LIVE.includes(o.stage))
  const past = orders.filter((o) => !LIVE.includes(o.stage))

  return (
    <div className="order-shell">
      <div className="checkout">
        <div className="checkout-head account-head">
          <div>
            <h1>Your orders</h1>
            <p className="checkout-sub">Signed in as {customer.email}</p>
          </div>
          <form action={signOutCustomer}>
            <button type="submit" className="link-back">Sign out</button>
          </form>
        </div>

        {orders.length === 0 ? (
          <div className="panel empty">
            <h2 className="panel-title">Nothing here yet</h2>
            <p>
              Orders you place will show up here, including ones you placed as a
              guest with {customer.email}.
            </p>
            <Link className="sheet-add" href="/order">Start an order</Link>
          </div>
        ) : (
          <>
            {live.length > 0 ? (
              <section>
                <h2 className="history-heading">In progress</h2>
                {live.map((order) => <HistoryCard key={order.id} order={order} />)}
              </section>
            ) : null}

            {past.length > 0 ? (
              <section>
                <h2 className="history-heading">Past orders</h2>
                {past.map((order) => <HistoryCard key={order.id} order={order} />)}
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

function HistoryCard({
  order,
}: {
  order: Awaited<ReturnType<typeof getOrderHistory>>[number]
}) {
  return (
    <article className="panel history">
      <header className="history-top">
        <div>
          <strong>{order.orderCode}</strong>
          <span className="history-guest">{order.ticket}</span>
          <span className={`badge badge-${order.stage}`}>
            {statusLabel(order.stage)}
          </span>
        </div>
        <span className="history-date">
          {new Date(order.createdAt).toLocaleDateString('en-PH', {
            day: 'numeric', month: 'short', year: 'numeric',
          })}
        </span>
      </header>

      <ul className="summary-lines">
        {order.items.map((item, i) => (
          <li key={`${item.name}-${i}`}>
            <div className="summary-qty">{item.quantity}×</div>
            <div className="summary-detail">
              <strong>{item.name}</strong>
              <span>
                {item.variantLabel} · {SIZE_VOLUMES[item.variantLabel as DrinkSize] ?? ''}
              </span>
              {item.modifiers.length > 0 ? <span>{item.modifiers.join(', ')}</span> : null}
              {item.ice ? <span>{item.ice}</span> : null}
              {item.note ? <em>“{item.note}”</em> : null}
            </div>
          </li>
        ))}
      </ul>

      <div className="order-total">
        <span>
          {order.fulfilment === 'delivery' ? 'Delivered to' : 'Picked up'}
          {order.fulfilment === 'delivery' && order.deliveryAddress
            ? ` ${order.deliveryAddress}`
            : ''}
        </span>
        <span />
      </div>
      <div className="order-total grand">
        <span>Total</span>
        <span>{formatPesos(order.totalCentavos)}</span>
      </div>

      <div className="history-foot">
        {order.claimedByEmail ? (
          <span className="history-guest">Placed as a guest with your email</span>
        ) : <span />}
        <Link href={`/order/${order.orderCode}`}>Track this order →</Link>
      </div>
    </article>
  )
}

'use client'

import '../order/order.css'

/** A failed history read (the API is down or slow) lands here, never on Next's unstyled crash page. */
export default function OrdersError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="order-shell">
      <div className="order-main">
        <div className="order-card" role="alert">
          <p>We couldn&apos;t load your order just now. Your order is safe — try again in a moment.</p>
          <p>
            <button type="button" className="done-secondary" onClick={() => reset()}>
              Try again
            </button>
          </p>
          <p><a href="/order">Back to ordering</a></p>
        </div>
      </div>
    </div>
  )
}

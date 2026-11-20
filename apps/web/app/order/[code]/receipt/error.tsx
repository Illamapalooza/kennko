'use client'

import '../../order.css'

/** A failed receipt read (not a missing order, which is a 404) lands here. */
export default function ReceiptError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="order-shell">
      <div className="order-main">
        <div className="order-card" role="alert">
          <p>We couldn&apos;t load this receipt just now. Try again in a moment.</p>
          <p>
            <button type="button" className="done-secondary" onClick={() => reset()}>
              Try again
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}

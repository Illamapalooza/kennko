import { stampCircles } from '@/app/account/me'
import type { MeView } from '@kennko/core'

type Customer = NonNullable<MeView['customer']>

/** The digital stamp card, or the notice for someone on a paper card. */
export function StampCard({ customer }: { customer: Customer }) {
  if (!customer.card) {
    return (
      <section className="panel stamp-panel" aria-labelledby="stamps-h">
        <h2 className="panel-title" id="stamps-h">Stamp card</h2>
        <p>You&apos;re on a paper card. Your stamps are on the card in your wallet.</p>
      </section>
    )
  }
  const { circles, freeDrinkReady } = stampCircles(customer.card)
  const stamped = circles.filter((c) => c.date).length
  return (
    <section className="panel stamp-panel" aria-labelledby="stamps-h">
      <h2 className="panel-title" id="stamps-h">Stamp card</h2>
      {freeDrinkReady ? <p className="free-drink">Free drink ready</p> : null}
      <ol className="stamp-grid" aria-label={`${freeDrinkReady ? 8 : stamped} of 8 stamps`}>
        {circles.map((c, i) => (
          <li key={i} className={c.filled ? 'stamp stamp-on' : 'stamp'}>
            <span className="stamp-dot" aria-hidden="true">{c.filled ? '✓' : i + 1}</span>
            <span className="stamp-date">{c.date ?? ' '}</span>
          </li>
        ))}
      </ol>
      <p className="stamp-help">
        {freeDrinkReady
          ? 'Show your code at the counter to use it.'
          : 'Every 8 stamps is a free drink. Show your code when you order.'}
      </p>
    </section>
  )
}

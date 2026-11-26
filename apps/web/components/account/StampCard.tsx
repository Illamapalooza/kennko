import { stampCircles } from '@/app/account/me'
import { PerksCard } from '@/components/site/PerksCard'
import type { MeView } from '@kennko/core'

type Customer = NonNullable<MeView['customer']>

/** The digital stamp card, drawn like the printed perks card, or the notice for someone on a paper card. */
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
  const stamped = freeDrinkReady ? 8 : circles.filter((c) => c.date).length
  return (
    <section className="panel stamp-panel" aria-labelledby="stamps-h">
      <h2 className="panel-title" id="stamps-h">Stamp card</h2>
      {freeDrinkReady ? <p className="free-drink">Free drink ready</p> : null}
      <PerksCard
        label={freeDrinkReady ? 'Perks card: 8 of 8 stamps, free drink ready' : `Perks card: ${stamped} of 8 stamps`}
        slots={circles.map((c) => ({ stamped: c.filled, date: c.date }))}
        freeDrinkReady={freeDrinkReady}
      />
      <p className="stamp-help">
        {freeDrinkReady
          ? 'Show your code at the counter to use it.'
          : stamped >= 4
            ? 'Free upsize unlocked at 4 stamps! 8 stamps gets you a free drink. Show your code at the counter.'
            : '4 stamps = free upsize · 8 stamps = free drink. Show your code when you order.'}
      </p>
    </section>
  )
}

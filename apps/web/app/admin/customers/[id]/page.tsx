import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { CustomerDetail } from '@kennko/core'
import { requireManager } from '@/lib/auth/session'
import { staffFetch } from '@/lib/api/client'
import { isNoSuchOrder } from '@/lib/api/not-found'
import { CardModeSwitch } from '@/components/admin/CardModeSwitch'
import { PaperStampRow } from '@/components/admin/PaperStampRow'
import { PointsForm } from '@/components/admin/PointsForm'
import { manilaStamp } from '../../reports/dates'
import { LEDGER_REASON, cardState, signed } from '../format'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireManager()
  const { id } = await params
  if (!UUID.test(id)) notFound()

  let customer: CustomerDetail | null = null
  let missing = false
  try {
    const res = await staffFetch(`/v1/customers/${id}`)
    if (res.ok) customer = (await res.json()) as CustomerDetail
    else missing = await isNoSuchOrder(res)
  } catch {
    // unreachable: the error message below
  }
  if (missing) notFound()

  if (!customer) {
    return (
      <>
        <p>
          <Link href="/admin/customers">Back to customers</Link>
        </p>
        <p className="admin-error" role="alert">
          Couldn&apos;t load this customer. Refresh to try again.
        </p>
      </>
    )
  }

  const freeDrinkWaiting = customer.fullCards > 0

  return (
    <>
      <p>
        <Link href="/admin/customers">Back to customers</Link>
      </p>
      <h1>{customer.displayName}</h1>
      <p>
        <strong>{customer.publicCode}</strong> · joined {manilaStamp(customer.joinedAt)}
      </p>

      <section aria-labelledby="card-mode">
        <h2 id="card-mode">Card</h2>
        <div className="section-card attention-row">
          <p>
            {customer.stampMode === 'paper' ? <span className="report-pill">Paper card</span> : cardState(customer.stampMode)}
            {freeDrinkWaiting ? (
              <>
                {' '}
                <span className="report-pill">Free drink waiting</span>
              </>
            ) : null}
          </p>
          <p className="report-note">
            {customer.stamps} of 8 stamps on the open card · {customer.fullCards} full {customer.fullCards === 1 ? 'card' : 'cards'} waiting
            {customer.stampModeSetBy && customer.stampModeSetAt
              ? ` · switched by ${customer.stampModeSetBy}, ${manilaStamp(customer.stampModeSetAt)}`
              : ''}
          </p>
          <CardModeSwitch customerId={customer.id} mode={customer.stampMode} />
        </div>
      </section>

      {customer.paperStamps.length > 0 ? (
        <section aria-labelledby="stamps-to-check">
          <h2 id="stamps-to-check">Stamps to check</h2>
          <div className="attention-list">
            {customer.paperStamps.map((s) => (
              <PaperStampRow key={s.id} stamp={s} showCustomer={false} />
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="cards">
        <h2 id="cards">Stamp cards</h2>
        {customer.cards.length === 0 ? (
          <p>No stamp cards yet.</p>
        ) : (
          <div className="attention-list">
            {customer.cards.map((card) => (
              <article key={card.id} className="section-card attention-row">
                <p>
                  <strong>{card.claimedAt ? 'Claimed' : card.filledAt ? 'Full' : 'Open'}</strong>
                  {' · '}
                  {card.stamps.length} of 8 stamps · started {manilaStamp(card.startedAt)}
                </p>
                {card.claimedAt ? (
                  <p className="report-note">
                    Free drink claimed {manilaStamp(card.claimedAt)}
                    {card.claimedTicket ? ` on ${card.claimedTicket}` : ''}
                  </p>
                ) : null}
                {card.stamps.length > 0 ? (
                  <div className="report-scroll">
                    <table className="report-table" aria-label="Stamps on this card">
                      <thead>
                        <tr>
                          <th>Ticket</th>
                          <th>Stamped</th>
                        </tr>
                      </thead>
                      <tbody>
                        {card.stamps.map((s) => (
                          <tr key={s.id}>
                            <td>{s.ticket}</td>
                            <td>{manilaStamp(s.stampedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="points">
        <h2 id="points">Points</h2>
        <p className={customer.points < 0 ? 'report-big points-negative' : 'report-big'}>
          {customer.points}
          {customer.points < 0 ? <span className="report-note"> (negative balance)</span> : null}
        </p>
        {staff.role === 'owner' ? (
          <div className="section-card">
            <PointsForm customerId={customer.id} />
          </div>
        ) : null}
        {customer.ledger.length === 0 ? (
          <p>No points yet.</p>
        ) : (
          <div className="section-card report-scroll">
            <table className="report-table" aria-label="Points ledger">
              <thead>
                <tr>
                  <th>When</th>
                  <th>What</th>
                  <th className="num">Points</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {customer.ledger.map((row) => (
                  <tr key={row.id}>
                    <td>{manilaStamp(row.createdAt)}</td>
                    <td>
                      {LEDGER_REASON[row.reason] ?? row.reason}
                      {row.ticket ? ` ${row.ticket}` : ''}
                    </td>
                    <td className={row.delta < 0 ? 'num points-negative' : 'num'}>{signed(row.delta)}</td>
                    <td>
                      {row.note ?? ''}
                      {row.byName ? ` (${row.byName})` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

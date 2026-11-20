import { formatPesos, ticketLabel, type DayReport as DayReportData } from '@kennko/core'
import { flagText, reasonText } from '@/app/admin/attention/text'
import { manilaTime } from '@/app/admin/reports/dates'

type Tally = { orders: number; totalCentavos: number }

const peso = formatPesos
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const tallyText = (t: Tally) => `${plural(t.orders, 'order')}, ${peso(t.totalCentavos)}`
const ticket = (n: number | null) => (n === null ? 'Unreadable sale' : ticketLabel('C', n))

function Table({ head, children, label }: { head: string[]; children: React.ReactNode; label: string }) {
  return (
    <div className="report-scroll">
      <table className="report-table" aria-label={label}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} className={i === 0 ? undefined : 'num'}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="section-card report-section">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function OverShort({ centavos }: { centavos: number | null }) {
  if (centavos === null) return <>Not counted</>
  if (centavos === 0) return <>{peso(0)}</>
  return (
    <span className="report-flag">
      {centavos > 0 ? 'Over ' : 'Short '}
      {peso(Math.abs(centavos))}
    </span>
  )
}

/** One day across channels. Every amount is formatted here, at render; nothing is hidden: held and set-aside sales are listed apart. */
export function DayReport({ report }: { report: DayReportData }) {
  const { sales, payments, cancelled, held } = report
  const idle = sales.orders === 0 && report.other.orders === 0 && held.rows.length === 0 && report.shifts.length === 0

  return (
    <div className="report">
      {idle ? <p>No sales on this day.</p> : null}

      <Section title="Sales">
        <p className="report-big">{peso(sales.totalCentavos)}</p>
        <p>
          {plural(sales.orders, 'order')}. Discounts {peso(sales.discountCentavos)}. Delivery fees {peso(sales.deliveryFeeCentavos)}.
        </p>
        <h3>Counter: {tallyText(sales.counter)}</h3>
        {sales.counter.byTill.length > 0 ? (
          <Table label="Counter sales by till" head={['Till', 'Orders', 'Total', 'Tickets']}>
            {sales.counter.byTill.map((t) => (
              <tr key={t.deviceName}>
                <td>{t.deviceName || 'Unknown till'}</td>
                <td className="num">{t.orders}</td>
                <td className="num">{peso(t.totalCentavos)}</td>
                <td className="num">
                  {t.firstTicket} to {t.lastTicket}
                </td>
              </tr>
            ))}
          </Table>
        ) : null}
        <h3>Online: {tallyText(sales.online)}</h3>
        <p>
          {sales.online.pickup} pickup, {sales.online.delivery} delivery.
        </p>
      </Section>

      <Section title="Payments">
        <dl className="report-pairs">
          <dt>Cash</dt>
          <dd>{peso(payments.cashCentavos)}</dd>
          <dt>GCash</dt>
          <dd>{peso(payments.gcashCentavos)}</dd>
        </dl>
      </Section>

      <Section title="Cash by shift">
        {report.shifts.length === 0 ? (
          <p>No shifts opened on this day.</p>
        ) : (
          <Table
            label="Cash by shift"
            head={['Shift', 'Float', 'Cash sales', 'In', 'Out', 'Expected', 'Counted', 'Over / short']}
          >
            {report.shifts.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>{s.deviceName}</strong>
                  <br />
                  {manilaTime(s.openedAt)} to {s.closedAt ? manilaTime(s.closedAt) : 'still open'}
                  {s.openedByName ? `, ${s.openedByName}` : ''}
                  {s.closedInAdmin ? (
                    <>
                      <br />
                      <span className="report-pill">Closed in admin</span>
                    </>
                  ) : null}
                  {s.lateSales > 0 ? (
                    <>
                      <br />
                      <span className="report-note">{plural(s.lateSales, 'sale')} arrived after close</span>
                    </>
                  ) : null}
                </td>
                <td className="num">{peso(s.floatCentavos)}</td>
                <td className="num">{peso(s.cashSalesCentavos)}</td>
                <td className="num">{peso(s.cashInCentavos)}</td>
                <td className="num">{peso(s.cashOutCentavos)}</td>
                <td className="num">{peso(s.expectedCentavos)}</td>
                <td className="num">{s.countedCentavos === null ? 'Not counted' : peso(s.countedCentavos)}</td>
                <td className="num">
                  <OverShort centavos={s.overShortCentavos} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Items">
        {report.items.length === 0 ? (
          <p>No items sold.</p>
        ) : (
          <Table label="Items sold" head={['Item', 'Qty', 'Total']}>
            {report.items.map((i) => (
              <tr key={`${i.name}|${i.variant}`}>
                <td>
                  {i.name}
                  {i.variant ? ` (${i.variant})` : ''}
                </td>
                <td className="num">{i.quantity}</td>
                <td className="num">{peso(i.totalCentavos)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Cancelled and refunded">
        <dl className="report-pairs">
          <dt>Counter voids</dt>
          <dd>{tallyText(cancelled.counterVoids)}</dd>
          <dt>Online refunded</dt>
          <dd>{tallyText(cancelled.onlineRefunded)}</dd>
          <dt>Online rejected</dt>
          <dd>{tallyText(cancelled.onlineRejected)}</dd>
          {report.other.orders > 0 ? (
            <>
              <dt>Other, not in sales</dt>
              <dd>{tallyText(report.other)}</dd>
            </>
          ) : null}
        </dl>
      </Section>

      <Section title="Awaiting verification">
        <p>{tallyText(report.awaitingVerification)}. Not counted as sales until a payment is verified.</p>
      </Section>

      <Section title="Flagged orders">
        {report.flagged.length === 0 ? (
          <p>None.</p>
        ) : (
          <Table label="Flagged orders" head={['Order', 'Flags', 'Total']}>
            {report.flagged.map((f) => (
              <tr key={f.id}>
                <td>
                  {f.ticket} · {f.channel === 'online' ? 'Online' : (f.deviceName ?? 'Counter')}
                </td>
                <td className="num">{f.flags.map(flagText).join('; ')}</td>
                <td className="num">{peso(f.totalCentavos)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title="Held sales, not in the totals">
        <HeldList
          rows={held.rows.filter((r) => r.result === 'held')}
          empty="No held sales."
          total={held.held.totalCentavos}
          label="Held sales"
        />
      </Section>

      <Section title="Set aside by the owner">
        <HeldList
          rows={held.rows.filter((r) => r.result === 'discarded')}
          empty="Nothing set aside."
          total={held.setAside.totalCentavos}
          label="Sales set aside"
          withNote
        />
      </Section>

      {report.legacy.orders > 0 ? (
        <p className="report-note">Includes {plural(report.legacy.orders, 'order')} imported from the till&apos;s history.</p>
      ) : null}
    </div>
  )
}

function HeldList({
  rows,
  empty,
  total,
  label,
  withNote = false,
}: {
  rows: DayReportData['held']['rows']
  empty: string
  total: number
  label: string
  withNote?: boolean
}) {
  if (rows.length === 0) return <p>{empty}</p>
  return (
    <>
      <p>
        {plural(rows.length, 'sale')}, {peso(total)} as sent by the till.
      </p>
      <Table label={label} head={withNote ? ['Sale', 'Total', 'Reason', 'Owner note'] : ['Sale', 'Total', 'Reason']}>
        {rows.map((r) => (
          <tr key={`${r.deviceName}|${r.eventId}`}>
            <td>
              {ticket(r.ticketNumber)} · {r.deviceName}
            </td>
            <td className="num">{r.totalCentavos === null ? 'Unknown' : peso(r.totalCentavos)}</td>
            <td className="num">{reasonText(r.result, r.reason)}</td>
            {withNote ? <td className="num">{r.note ?? ''}</td> : null}
          </tr>
        ))}
      </Table>
    </>
  )
}

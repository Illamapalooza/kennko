import { useEffect, useState } from 'react'
import { ORDER_TYPE_LABELS, formatPesos, iceLabel, type OnlineQueueLine, type OnlineQueueOrder, type Order, type OrderStatus, type PendingPaymentOrder } from '@kennko/core'
import { api, type Live } from '../api.ts'
import { maskCode, onlineCardLabel, stampButtonLabel } from '../loyaltyText.ts'
import { deliveryText, onlineAction, onlineColumn, onlineStage, onlineWhen } from '../onlineText.ts'

const COLUMNS: { status: OrderStatus; title: string; action: string }[] = [
  { status: 'queued', title: 'Queued', action: 'Start' },
  { status: 'preparing', title: 'Preparing', action: 'Ready' },
  { status: 'serving', title: 'Serving', action: 'Done' },
]

const waited = (createdAt: number, now: number) => {
  const minutes = Math.max(0, Math.floor((now - createdAt) / 60000))
  return minutes < 1 ? 'just now' : `${minutes} min`
}

type Card = { kind: 'c'; at: number; order: Order } | { kind: 'w'; at: number; order: OnlineQueueOrder }

const onlineLineExtras = (line: OnlineQueueLine) =>
  [...line.options, iceLabel(line.iceLevel, line.iceServe), line.note].filter(Boolean).join(', ')

/** The barista's queue. One big button per card moves it along; every tablet follows. */
export function Orders({ live, online = true, notify }: { live: Live; online?: boolean; notify: (message: string) => void }) {
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 20000)
    return () => clearInterval(timer)
  }, [])

  const act = async (id: string, work: () => Promise<unknown>) => {
    if (busy !== null) return
    setBusy(id)
    try { await work() } catch (err) { notify(err instanceof Error ? err.message : 'That did not work.') } finally { setBusy(null) }
  }

  const pending = live.pendingPayments ?? []

  return (
    <div className={`board${pending.length > 0 ? ' board-has-pending' : ''}`}>
      {pending.length > 0 ? (
        <section className="column column-pending" aria-label="Pending payment">
          <h2>To confirm <b>{pending.length}</b></h2>
          {!online ? <p className="empty">Connect to the internet to confirm GCash payments.</p> : null}
          {pending.map((p) => (
            <PendingPaymentTicket
              key={`p:${p.paymentId}`}
              order={p}
              now={now}
              online={online}
              busy={busy === `p:${p.paymentId}`}
              onVerify={() => act(`p:${p.paymentId}`, () => api.decideOnlinePayment(p.paymentId, 'verify'))}
              onReject={() => act(`p:${p.paymentId}`, () => api.decideOnlinePayment(p.paymentId, 'reject'))}
            />
          ))}
        </section>
      ) : null}
      {COLUMNS.map((column) => {
        const cards: Card[] = [
          ...live.active.filter((o) => o.status === column.status).map((order): Card => ({ kind: 'c', at: order.createdAt, order })),
          ...(live.online ?? []).filter((o) => onlineColumn(o.prepStatus) === column.status).map((order): Card => ({ kind: 'w', at: Date.parse(order.createdAt) || 0, order })),
        ].sort((a, b) => a.at - b.at)
        return (
          <section className={`column column-${column.status}`} key={column.status} aria-label={column.title}>
            <h2>{column.title} <b>{cards.length}</b></h2>
            {cards.length === 0 ? <p className="empty">Nothing here.</p> : null}
            {cards.map((card) => {
              if (card.kind === 'w') return (
              <OnlineTicket key={`w:${card.order.id}`} order={card.order} now={now} busy={busy === `w:${card.order.id}`} onAdvance={() => act(`w:${card.order.id}`, () => api.advanceOnline(card.order.id, card.order.prepStatus))} onStamp={() => act(`w:${card.order.id}`, () => api.stampOnline(card.order.id))} />
              )
              const order = card.order
              const key = `c:${order.id}`
              return (
              <article className="ticket" key={key}>
                <header>
                  <b className="ticket-number">#{order.number}</b>
                  <span className="ticket-who">{order.customerName || ORDER_TYPE_LABELS[order.type]}</span>
                  {order.customerCode ? <span className="pill pill-card">{maskCode(order.customerCode)}</span> : null}
                  <span className={`pill${order.type === 'takeout' ? ' pill-amber' : ''}`}>{ORDER_TYPE_LABELS[order.type]}</span>
                </header>
                <ul>
                  {order.lines.map((line, i) => {
                    const extras = [...line.modifiers.map((m) => m.name), iceLabel(line.iceLevel, line.iceServe), line.note].filter(Boolean).join(', ')
                    return (
                      <li key={i}>
                        <b>{line.quantity}×</b> {line.name} <i>{line.size}</i>
                        {extras ? <small>{extras}</small> : null}
                      </li>
                    )
                  })}
                </ul>
                <footer>
                  <span className="muted">{waited(order.createdAt, now)}</span>
                  {stampButtonLabel(order) === 'Stamp card' ? (
                    <button type="button" className="btn btn-amber" disabled={busy === key} onClick={() => act(key, () => api.stampOrder(order.id))}>Stamp card</button>
                  ) : stampButtonLabel(order) === 'Stamped' ? <span className="pill pill-done">Stamped</span> : null}
                  {column.status !== 'queued' ? (
                    <button type="button" className="btn btn-quiet" disabled={busy === key} onClick={() => act(key, () => api.undo(order.id))}>Back</button>
                  ) : null}
                  <button type="button" className="btn btn-primary" disabled={busy === key} onClick={() => act(key, () => api.advance(order.id))}>
                    {column.action}
                  </button>
                </footer>
              </article>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}

/** A paid online order: forward-only (no Back, no Void: admin cancels and refunds), and no money. */
function OnlineTicket({ order, now, busy, onAdvance, onStamp }: { order: OnlineQueueOrder; now: number; busy: boolean; onAdvance: () => void; onStamp: () => void }) {
  const cardLabel = onlineCardLabel(order.card)
  const action = onlineAction(order.prepStatus, order.fulfilment)
  const stage = onlineStage(order.prepStatus, order.fulfilment)
  const where = deliveryText(order)
  return (
    <article className="ticket ticket-online">
      <header>
        <b className="ticket-number">W{order.ticketNumber}</b>
        <span className="ticket-who">{order.customerName}</span>
        <span className="pill pill-amber">Online</span>
      </header>
      <p className="online-when">
        <b>{onlineWhen(order, now)}</b>
        {stage ? <span className="pill pill-serving">{stage}</span> : null}
      </p>
      <ul>
        {order.lines.map((line, i) => {
          const extras = onlineLineExtras(line)
          return (
            <li key={i}>
              <b>{line.quantity}×</b> {line.name} <i>{line.size}</i>
              {extras ? <small>{extras}</small> : null}
            </li>
          )
        })}
      </ul>
      {order.customerNote ? <p className="online-note"><i>{order.customerNote}</i></p> : null}
      {where ? <p className="online-where">{where}</p> : null}
      <footer>
        <span className="muted">{waited(Date.parse(order.createdAt) || now, now)}</span>
        {cardLabel === 'Stamp at pickup' ? (
          <button type="button" className="btn btn-amber" disabled={busy} onClick={onStamp}>{cardLabel}</button>
        ) : cardLabel ? <span className={`pill${cardLabel === 'Stamped' ? ' pill-done' : ''}`}>{cardLabel}</span> : null}
        {action ? <button type="button" className="btn btn-primary" disabled={busy} onClick={onAdvance}>{action}</button> : null}
      </footer>
    </article>
  )
}

function PendingPaymentTicket({
  order,
  now,
  online,
  busy,
  onVerify,
  onReject,
}: {
  order: PendingPaymentOrder
  now: number
  online: boolean
  busy: boolean
  onVerify: () => void
  onReject: () => void
}) {
  return (
    <article className="ticket ticket-online ticket-pending">
      <header>
        <b className="ticket-number">{order.orderCode}</b>
        <span className="ticket-who">{order.customerName}</span>
        <span className="pill pill-amber">{formatPesos(order.totalCentavos)}</span>
      </header>
      <p className="online-when">
        <b>{onlineWhen(order, now)}</b>
        {order.reference ? <span className="pill">Ref: {order.reference}</span> : null}
      </p>
      <ul>
        {order.lines.map((line, i) => {
          const extras = onlineLineExtras(line)
          return (
            <li key={i}>
              <b>{line.quantity}×</b> {line.name} <i>{line.size}</i>
              {extras ? <small>{extras}</small> : null}
            </li>
          )
        })}
      </ul>
      {order.proofUrl ? (
        <p className="online-note">
          <a href={order.proofUrl} target="_blank" rel="noreferrer" className="link">View GCash proof</a>
        </p>
      ) : null}
      <footer>
        <span className="muted">{waited(Date.parse(order.createdAt) || now, now)}</span>
        <button type="button" className="btn btn-quiet" disabled={!online || busy} onClick={onReject}>Reject</button>
        <button type="button" className="btn btn-primary" disabled={!online || busy} onClick={onVerify}>Confirm paid</button>
      </footer>
    </article>
  )
}

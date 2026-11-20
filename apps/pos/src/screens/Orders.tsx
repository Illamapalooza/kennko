import { useEffect, useState } from 'react'
import { ORDER_TYPE_LABELS, iceLabel, type OnlineQueueLine, type OnlineQueueOrder, type Order, type OrderStatus } from '@kennko/core'
import { api, type Live } from '../api.ts'
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
export function Orders({ live, notify }: { live: Live; notify: (message: string) => void }) {
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

  return (
    <div className="board">
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
              <OnlineTicket key={`w:${card.order.id}`} order={card.order} now={now} busy={busy === `w:${card.order.id}`} onAdvance={() => act(`w:${card.order.id}`, () => api.advanceOnline(card.order.id))} />
              )
              const order = card.order
              const key = `c:${order.id}`
              return (
              <article className="ticket" key={key}>
                <header>
                  <b className="ticket-number">#{order.number}</b>
                  <span className="ticket-who">{order.customerName || ORDER_TYPE_LABELS[order.type]}</span>
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
function OnlineTicket({ order, now, busy, onAdvance }: { order: OnlineQueueOrder; now: number; busy: boolean; onAdvance: () => void }) {
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
        {action ? <button type="button" className="btn btn-primary" disabled={busy} onClick={onAdvance}>{action}</button> : null}
      </footer>
    </article>
  )
}

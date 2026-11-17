import { useEffect, useState } from 'react'
import { ORDER_TYPE_LABELS, iceLabel, type Order, type OrderStatus } from '@kennko/core'
import { api, type Live } from '../api.ts'

const COLUMNS: { status: OrderStatus; title: string; action: string }[] = [
  { status: 'queued', title: 'Queued', action: 'Start' },
  { status: 'preparing', title: 'Preparing', action: 'Ready' },
  { status: 'serving', title: 'Serving', action: 'Done' },
]

const waited = (order: Order, now: number) => {
  const minutes = Math.max(0, Math.floor((now - order.createdAt) / 60000))
  return minutes < 1 ? 'just now' : `${minutes} min`
}

/** The barista's queue. One big button per card moves it along; every tablet follows. */
export function Orders({ live, notify }: { live: Live; notify: (message: string) => void }) {
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState<number | null>(null)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 20000)
    return () => clearInterval(timer)
  }, [])

  const act = async (id: number, work: () => Promise<unknown>) => {
    if (busy !== null) return
    setBusy(id)
    try { await work() } catch (err) { notify(err instanceof Error ? err.message : 'That did not work.') } finally { setBusy(null) }
  }

  return (
    <div className="board">
      {COLUMNS.map((column) => {
        const orders = live.active.filter((o) => o.status === column.status)
        return (
          <section className={`column column-${column.status}`} key={column.status} aria-label={column.title}>
            <h2>{column.title} <b>{orders.length}</b></h2>
            {orders.length === 0 ? <p className="empty">Nothing here.</p> : null}
            {orders.map((order) => (
              <article className="ticket" key={order.id}>
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
                  <span className="muted">{waited(order, now)}</span>
                  {column.status !== 'queued' ? (
                    <button type="button" className="btn btn-quiet" disabled={busy === order.id} onClick={() => act(order.id, () => api.undo(order.id))}>Back</button>
                  ) : null}
                  <button type="button" className="btn btn-primary" disabled={busy === order.id} onClick={() => act(order.id, () => api.advance(order.id))}>
                    {column.action}
                  </button>
                </footer>
              </article>
            ))}
          </section>
        )
      })}
    </div>
  )
}

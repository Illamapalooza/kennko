import { useCallback, useEffect, useState } from 'react'
import { PAYMENT_LABELS, STATUS_LABELS, formatPesos, type Order } from '@kennko/core'
import { api, type Bootstrap, type Live } from '../api.ts'
import { Modal } from '../components/Modal.tsx'
import { PinPrompt } from '../components/PinPrompt.tsx'
import { Receipt } from '../components/Receipt.tsx'

const firstName = (name: string) => name.trim().split(/\s+/)[0]
const time = (ms: number) => new Date(ms).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })

/** Every order of a day, newest first. Tap one for its receipt, or to void it. */
export function History({ boot, live, notify }: { boot: Bootstrap; live: Live; notify: (message: string) => void }) {
  const [day, setDay] = useState(live.day)
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [open, setOpen] = useState<Order | null>(null)
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState('')
  const [askPin, setAskPin] = useState(false)

  const load = useCallback(() => {
    api.orders(day).then(setOrders).catch((err) => notify(err.message))
  }, [day, notify])
  useEffect(load, [load, live.version])

  const closeOrder = () => { setOpen(null); setVoiding(false); setReason(''); setAskPin(false) }
  const sold = (orders ?? []).filter((o) => o.status !== 'voided')

  return (
    <div className="page">
      <header className="page-head">
        <h1>History</h1>
        <input type="date" className="input input-date" value={day} max={live.day} aria-label="Day" onChange={(e) => e.target.value && setDay(e.target.value)} />
        <a className="btn btn-outline" href={api.csvUrl(day)} download>Export CSV</a>
      </header>
      <p className="muted">{sold.length} order{sold.length === 1 ? '' : 's'} · {formatPesos(sold.reduce((sum, o) => sum + o.totalCentavos, 0))} in sales</p>

      {orders === null ? <p className="empty">Loading…</p> : orders.length === 0 ? <p className="empty">No orders on this day.</p> : (
        <ul className="rows">
          {orders.map((order) => (
            <li key={order.id}>
              <button type="button" className={`row${order.status === 'voided' ? ' row-void' : ''}`} onClick={() => setOpen(order)}>
                <b className="row-number">#{order.number}</b>
                <span className="row-main">
                  <span>{order.lines.map((l) => `${l.quantity}× ${l.name}`).join(', ')}</span>
                  <small>{time(order.createdAt)}{order.customerName ? ` · ${order.customerName}` : ''} · {PAYMENT_LABELS[order.paymentMethod]}{order.status === 'voided' && order.voidedByName ? ` · Voided by ${firstName(order.voidedByName)}` : ''}</small>
                </span>
                <span className={`pill pill-${order.status}`}>{STATUS_LABELS[order.status]}</span>
                <b className="row-total">{formatPesos(order.totalCentavos)}</b>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && !askPin ? (
        <Modal title={`Order #${open.number}`} onClose={closeOrder}>
          {open.status === 'voided' && open.voidedByName ? <p className="muted no-print">Voided by {firstName(open.voidedByName)}</p> : null}
          <Receipt order={open} shop={boot.shop} />
          {voiding ? (
            <div className="field no-print">
              <h3><label htmlFor="void-reason">Why is it being voided?</label></h3>
              <input id="void-reason" className="input" value={reason} maxLength={120} placeholder="Wrong drink, customer left…" autoFocus onChange={(e) => setReason(e.target.value)} />
              <div className="foot-row">
                <button type="button" className="btn btn-quiet grow" onClick={() => setVoiding(false)}>Keep the order</button>
                <button type="button" className="btn btn-danger grow" disabled={!reason.trim()} onClick={() => setAskPin(true)}>Void order</button>
              </div>
            </div>
          ) : (
            <div className="foot-row no-print">
              {open.status !== 'voided' ? <button type="button" className="btn btn-ghost-danger" onClick={() => setVoiding(true)}>Void</button> : null}
              <button type="button" className="btn btn-outline grow" onClick={() => window.print()}>Print</button>
              <button type="button" className="btn btn-primary grow" onClick={closeOrder}>Close</button>
            </div>
          )}
        </Modal>
      ) : null}
      {open && askPin ? (
        <PinPrompt
          title="Manager PIN"
          hint={`Voiding order #${open.number} takes ${formatPesos(open.totalCentavos)} out of sales.`}
          onClose={() => setAskPin(false)}
          onSubmit={async (pin) => {
            await api.voidOrder(open.id, reason, pin)
            notify(`Order #${open.number} was voided.`)
            closeOrder()
          }}
        />
      ) : null}
    </div>
  )
}

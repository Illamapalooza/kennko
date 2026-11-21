import { useState } from 'react'
import { PAYMENT_LABELS, formatPesos, quickCash, type Order, type PaymentMethod } from '@kennko/core'
import { customerLine, maskCode, stampButtonLabel } from '../loyaltyText.ts'
import { PinPrompt } from '../components/PinPrompt.tsx'
import { api, type Bootstrap } from '../api.ts'
import type { Cart, CartCustomer } from '../App.tsx'
import { Keypad } from '../components/Keypad.tsx'
import { Modal } from '../components/Modal.tsx'
import { Receipt } from '../components/Receipt.tsx'
import { CatToon } from '@kennko/cats'

type Props = {
  boot: Bootstrap
  cart: Cart
  totalCentavos: number
  /** The sale is saved; the cart can be cleared. The dialog stays up to show the number and change. */
  onPaid: () => void
  onClose: () => void
  notify: (message: string) => void
}

export function Pay({ boot, cart, totalCentavos, onPaid, onClose, notify }: Props) {
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [entry, setEntry] = useState('') // pesos as typed, e.g. "200" or "150.5"
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [order, setOrder] = useState<Order | null>(null)
  const [showReceipt, setShowReceipt] = useState(false)
  const [askPin, setAskPin] = useState(false)
  const [stamping, setStamping] = useState(false)
  // The cart is cleared once the sale is saved; the done screen still needs to know the card's state.
  const [card, setCard] = useState<CartCustomer | null>(null)
  const freeIndex = cart.lines.findIndex((l) => l.reward)

  const tendered = entry === '' ? null : Math.round(Number(entry) * 100)
  const enough = method === 'gcash' || (tendered !== null && tendered >= totalCentavos)
  const change = tendered !== null && tendered >= totalCentavos ? tendered - totalCentavos : null

  const press = (key: string) => {
    setError('')
    setEntry((prev) => {
      if (key === '.') return prev.includes('.') ? prev : `${prev || '0'}.`
      const next = prev === '0' ? key : prev + key
      const [whole, cents = ''] = next.split('.')
      return whole.length > 6 || cents.length > 2 ? prev : next
    })
  }

  const save = async (managerPin?: string) => {
    const saved = await api.createOrder({
      lines: cart.lines.map(({ key: _key, ...line }) => line),
      type: cart.type,
      customerName: cart.customerName,
      discount: cart.discount,
      payment: method === 'cash' ? { method, tenderedCentavos: tendered } : { method, ref },
      // A free drink is claimed online with a manager's PIN; a plain card is just linked to the sale.
      ...(freeIndex >= 0 && cart.customer ? { reward: { lineIndex: freeIndex, code: cart.customer.code }, managerPin } : {}),
      ...(freeIndex < 0 && cart.customer ? { customerCode: cart.customer.code } : {}),
    })
    setCard(cart.customer)
    setOrder(saved)
    onPaid()
  }

  const confirm = async () => {
    if (!enough || busy) return
    if (freeIndex >= 0) return setAskPin(true)
    setBusy(true)
    setError('')
    try {
      await save()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The sale was not saved. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const stamp = async () => {
    if (!order || stamping) return
    setStamping(true)
    try { setOrder(await api.stampOrder(order.id)) } catch (err) { notify(err instanceof Error ? err.message : 'The stamp was not saved.') } finally { setStamping(false) }
  }

  if (order) {
    return (
      <Modal title={showReceipt ? `Receipt #${order.number}` : 'Paid'} onClose={onClose}>
        {showReceipt ? (
          <>
            <Receipt order={order} shop={boot.shop} />
            <div className="foot-row no-print">
              <button type="button" className="btn btn-outline grow" onClick={() => window.print()}>Print</button>
              <button type="button" className="btn btn-primary grow" onClick={onClose}>New order</button>
            </div>
          </>
        ) : (
          <div className="paid">
            <CatToon coat="tuxedo" pose="wave" className="paid-cat" />
            <p className="paid-label">Order number</p>
            <p className="paid-number">#{order.number}</p>
            {order.customerName ? <p className="paid-name">{order.customerName}</p> : null}
            {order.changeCentavos !== null ? (
              <div className={`paid-change${order.changeCentavos > 0 ? ' due' : ''}`}>
                <span>Change</span>
                <b>{formatPesos(order.changeCentavos)}</b>
              </div>
            ) : (
              <div className="paid-change"><span>GCash</span><b>{formatPesos(order.totalCentavos)}</b></div>
            )}
            {order.customerCode ? (
              <div className="paid-card">
                <span>Card {maskCode(order.customerCode)}</span>
                {card?.info?.stampMode === 'paper' ? <b>{customerLine(card.info)}</b> : stampButtonLabel(order) === 'Stamp card' ? (
                  <button type="button" className="btn btn-amber" disabled={stamping} onClick={stamp}>{stamping ? 'Stamping…' : 'Stamp card'}</button>
                ) : stampButtonLabel(order) === 'Stamped' ? <b className="stamped">Stamped</b> : order.freeDrink ? <b>Free drink used</b> : null}
              </div>
            ) : null}
            <div className="foot-row">
              <button type="button" className="btn btn-outline grow" onClick={() => setShowReceipt(true)}>Receipt</button>
              <button type="button" className="btn btn-primary grow" onClick={onClose} autoFocus>New order</button>
            </div>
          </div>
        )}
      </Modal>
    )
  }

  return (
    <Modal title="Payment" onClose={onClose} size="wide">
      <div className="pay">
        <div className="pay-left">
          <p className="pay-label">Total due</p>
          <p className="pay-total">{formatPesos(totalCentavos)}</p>
          <div className="segmented" role="group" aria-label="Payment method">
            {(Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map((m) => (
              <button type="button" key={m} className={method === m ? 'on' : ''} aria-pressed={method === m} onClick={() => { setMethod(m); setError('') }}>
                {PAYMENT_LABELS[m]}
              </button>
            ))}
          </div>
          {method === 'cash' ? (
            <>
              <div className="pay-readout">
                <div><span>Cash received</span><b>{tendered === null ? '—' : formatPesos(tendered)}</b></div>
                <div className={change !== null && change > 0 ? 'due' : ''}><span>Change</span><b>{change === null ? '—' : formatPesos(change)}</b></div>
              </div>
              <div className="quick">
                {quickCash(totalCentavos).map((amount, i) => (
                  <button type="button" key={amount} className="chip" onClick={() => { setEntry(String(amount / 100)); setError('') }}>
                    {i === 0 ? 'Exact' : formatPesos(amount)}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="field">
              <h3><label htmlFor="gcash-ref">GCash reference (optional)</label></h3>
              <input id="gcash-ref" className="input" inputMode="numeric" maxLength={40} placeholder="Last digits of the reference number" value={ref} onChange={(e) => setRef(e.target.value)} />
              <p className="muted">Check the customer's GCash confirmation before you confirm.</p>
            </div>
          )}
          {freeIndex >= 0 ? <p className="muted">Free drink: needs the internet and a manager PIN.</p> : null}
          <p className="error" role="alert">{error}</p>
        </div>
        <div className="pay-right">
          {method === 'cash' ? <Keypad extra="." onKey={press} onBackspace={() => setEntry((p) => p.slice(0, -1))} /> : null}
          <button type="button" className="btn btn-primary btn-big btn-block" disabled={!enough || busy} onClick={confirm}>
            {busy ? 'Saving…' : method === 'cash' && !enough ? 'Enter cash received' : 'Confirm payment'}
          </button>
        </div>
      </div>
      {askPin ? (
        <PinPrompt
          title="Manager PIN"
          hint="A manager approves the free drink. It needs the internet."
          onClose={() => setAskPin(false)}
          onSubmit={async (pin) => { await save(pin); setAskPin(false) }}
        />
      ) : null}
    </Modal>
  )
}

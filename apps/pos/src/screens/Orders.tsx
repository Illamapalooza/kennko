import { useEffect, useState } from 'react'
import { ORDER_TYPE_LABELS, PAYMENT_LABELS, formatPesos, iceLabel, sameLook, sizeTag, type OnlineQueueLine, type OnlineQueueOrder, type Order, type OrderStatus, type PendingPaymentOrder, type WallVisitor } from '@kennko/core'
import { api, type Bootstrap, type Live } from '../api.ts'
import { Modal } from '../components/Modal.tsx'
import { PinPrompt } from '../components/PinPrompt.tsx'
import { maskCode, onlineCardLabel, stampButtonLabel } from '../loyaltyText.ts'
import { deliveryText, onlineAction, onlineColumn, onlineStage, onlineWhen } from '../onlineText.ts'

const COLUMNS: { status: OrderStatus; title: string; action: string }[] = [
  { status: 'queued', title: 'Queued', action: 'Start' },
  { status: 'preparing', title: 'Preparing', action: 'Ready' },
  { status: 'serving', title: 'Serving', action: 'Done' },
]

const VOID_REASONS = ['Wrong drink', 'Customer left', 'Duplicate order']

const waited = (createdAt: number, now: number) => {
  const minutes = Math.max(0, Math.floor((now - createdAt) / 60000))
  return minutes < 1 ? 'just now' : `${minutes} min`
}

const clockTime = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })

type Card = { kind: 'c'; at: number; order: Order } | { kind: 'w'; at: number; order: OnlineQueueOrder }
type SelectedOrder = { kind: 'c'; id: number } | { kind: 'w'; id: string }

const onlineLineExtras = (line: OnlineQueueLine) =>
  [...line.options, iceLabel(line.iceLevel, line.iceServe), line.note].filter(Boolean).join(', ')

const shouldIgnoreCardClick = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest('button, a, input, select, textarea'))

/** The barista's queue. One big button per card moves it along; tap a card for details, cat assignment, or voiding. */
export function Orders({ boot, live, online = true, notify }: { boot: Bootstrap; live: Live; online?: boolean; notify: (message: string) => void }) {
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState<string | null>(null)
  const [selected, setSelected] = useState<SelectedOrder | null>(null)
  const [voidStep, setVoidStep] = useState<'none' | 'reason' | 'confirm' | 'pin'>('none')
  const [voidReason, setVoidReason] = useState('')
  const [visitors, setVisitors] = useState<WallVisitor[]>([])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 20000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let gone = false
    api.visitors().then((v) => { if (!gone) setVisitors(v) }).catch(() => { /* ignore */ })
    return () => { gone = true }
  }, [live.sync.lastSyncAt, live.version])

  const act = async (id: string, work: () => Promise<unknown>) => {
    if (busy !== null) return
    setBusy(id)
    try { await work() } catch (err) { notify(err instanceof Error ? err.message : 'That did not work.') } finally { setBusy(null) }
  }

  const closeDetail = () => {
    setSelected(null)
    setVoidStep('none')
    setVoidReason('')
  }

  const selectedCounter = selected?.kind === 'c' ? live.active.find((o) => o.id === selected.id) ?? null : null
  const selectedOnline = selected?.kind === 'w' ? (live.online ?? []).find((o) => o.id === selected.id) ?? null : null
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
              if (card.kind === 'w') {
                return (
                  <OnlineTicket
                    key={`w:${card.order.id}`}
                    order={card.order}
                    now={now}
                    busy={busy === `w:${card.order.id}`}
                    onOpen={() => { setSelected({ kind: 'w', id: card.order.id }); setVoidStep('none') }}
                    onAdvance={() => act(`w:${card.order.id}`, () => api.advanceOnline(card.order.id, card.order.prepStatus))}
                    onStamp={() => act(`w:${card.order.id}`, () => api.stampOnline(card.order.id))}
                  />
                )
              }
              const order = card.order
              const key = `c:${order.id}`
              return (
                <article
                  className="ticket ticket-clickable"
                  key={key}
                  onClick={(e) => { if (!shouldIgnoreCardClick(e.target)) { setSelected({ kind: 'c', id: order.id }); setVoidStep('none') } }}
                >
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
                          <b>{line.quantity}×</b> {line.name}{sizeTag(line.size) ? <> <i>{sizeTag(line.size)}</i></> : null}
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

      {selectedCounter ? (
        <CounterOrderModal
          order={selectedCounter}
          visitors={visitors}
          busy={busy === `c:${selectedCounter.id}`}
          voidStep={voidStep}
          voidReason={voidReason}
          onVoidReasonChange={setVoidReason}
          onStartVoid={() => setVoidStep('reason')}
          onConfirmVoidStep={() => setVoidStep('confirm')}
          onCancelVoid={() => { setVoidStep('none'); setVoidReason('') }}
          onProceedVoidPin={() => {
            if (boot.pinMode === 'off') {
              void act(`c:${selectedCounter.id}`, async () => {
                await api.voidOrder(selectedCounter.id, voidReason.trim(), '')
                notify(`Order #${selectedCounter.number} was voided.`)
                closeDetail()
              })
            } else {
              setVoidStep('pin')
            }
          }}
          onAssignCat={(visitor) => act(`c:${selectedCounter.id}`, () => api.assignOrderCat(selectedCounter.id, visitor?.look ?? null, visitor?.name, visitor?.key ?? null))}
          onSetTable={(tableNumber) => act(`c:${selectedCounter.id}`, () => api.setOrderTable(selectedCounter.id, tableNumber))}
          onClose={closeDetail}
        />
      ) : null}

      {selectedOnline ? (
        <OnlineOrderModal order={selectedOnline} now={now} onClose={closeDetail} />
      ) : null}

      {selectedCounter && voidStep === 'pin' ? (
        <PinPrompt
          title="Manager PIN to void"
          hint={`Voiding order #${selectedCounter.number} (${formatPesos(selectedCounter.totalCentavos)}) takes it off the wall and out of sales.`}
          onClose={() => setVoidStep('confirm')}
          onSubmit={async (pin: string) => {
            await api.voidOrder(selectedCounter.id, voidReason.trim(), pin)
            notify(`Order #${selectedCounter.number} was voided.`)
            closeDetail()
          }}
        />
      ) : null}
    </div>
  )
}

function CounterOrderModal({
  order,
  visitors,
  busy,
  voidStep,
  voidReason,
  onVoidReasonChange,
  onStartVoid,
  onConfirmVoidStep,
  onCancelVoid,
  onProceedVoidPin,
  onAssignCat,
  onSetTable,
  onClose,
}: {
  order: Order
  visitors: WallVisitor[]
  busy: boolean
  voidStep: 'none' | 'reason' | 'confirm' | 'pin'
  voidReason: string
  onVoidReasonChange: (v: string) => void
  onStartVoid: () => void
  onConfirmVoidStep: () => void
  onCancelVoid: () => void
  onProceedVoidPin: () => void
  /** The walking cat to tie the order to, or null to take the cat away. */
  onAssignCat: (visitor: WallVisitor | null) => void
  onSetTable: (tableNumber: number | null) => void
  onClose: () => void
}) {
  // The order's cat is a walking cat by its visit key; an order from before the key existed falls back to the look.
  const isCurrent = (v: WallVisitor) => (order.visitorKey ? order.visitorKey === v.key : sameLook(order.catLook, v.look))
  return (
    <Modal title={`Order #${order.number}`} onClose={onClose}>
      <div className="stack">
        <p className="muted">
          {clockTime(order.createdAt)} · {order.customerName || ORDER_TYPE_LABELS[order.type]} · {ORDER_TYPE_LABELS[order.type]} · {PAYMENT_LABELS[order.paymentMethod]} · <b>{formatPesos(order.totalCentavos)}</b>
        </p>
        {order.customerCode ? <p className="muted">Kennko card: <b>{maskCode(order.customerCode)}</b></p> : null}
        <ul className="detail-lines">
          {order.lines.map((line, i) => {
            const extras = [...line.modifiers.map((m) => m.name), iceLabel(line.iceLevel, line.iceServe), line.note].filter(Boolean).join(', ')
            return (
              <li key={i}>
                <b>{line.quantity}×</b> {line.name}{sizeTag(line.size) ? <> <i>{sizeTag(line.size)}</i></> : null}
                {extras ? <small> · {extras}</small> : null}
              </li>
            )
          })}
        </ul>

        {order.type === 'dine_in' && voidStep === 'none' ? (
          <div className="walking-cats">
            <small className="muted">Table</small>
            <div className="walking-cat-chips">
              {[
                { n: null, label: 'Any' },
                { n: 1, label: 'In 1' },
                { n: 2, label: 'In 2' },
                { n: 3, label: 'In 3' },
                { n: 4, label: 'Out 1' },
                { n: 5, label: 'Out 2' },
                { n: 6, label: 'Out 3' },
                { n: 7, label: 'Out 4' },
              ].map(({ n, label }) => {
                const active = (order.tableNumber ?? null) === n
                return (
                  <button
                    type="button"
                    key={label}
                    className={`pill${active ? ' pill-amber' : ''}`}
                    disabled={busy}
                    aria-pressed={active}
                    onClick={() => onSetTable(n)}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        {visitors.length > 0 && voidStep === 'none' ? (
          <div className="walking-cats">
            <small className="muted">Assign walking cat</small>
            <div className="walking-cat-chips">
              {visitors.map((v) => {
                const active = isCurrent(v)
                return (
                  <button
                    type="button"
                    key={v.key}
                    className={`pill${active ? ' pill-amber' : ''}`}
                    disabled={busy}
                    aria-pressed={active}
                    onClick={() => onAssignCat(active ? null : v)}
                  >
                    {v.name}
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        {voidStep === 'reason' ? (
          <div className="stack">
            <h3><label htmlFor="orders-void-reason">Why is it being voided?</label></h3>
            <div className="walking-cat-chips">
              {VOID_REASONS.map((r) => (
                <button type="button" key={r} className={`pill${voidReason === r ? ' pill-amber' : ''}`} onClick={() => onVoidReasonChange(r)}>
                  {r}
                </button>
              ))}
            </div>
            <input
              id="orders-void-reason"
              className="input"
              value={voidReason}
              maxLength={120}
              placeholder="Reason for voiding…"
              autoFocus
              onChange={(e) => onVoidReasonChange(e.target.value)}
            />
            <div className="row-actions">
              <button type="button" className="btn btn-quiet grow" onClick={onCancelVoid}>Keep order</button>
              <button type="button" className="btn btn-danger grow" disabled={!voidReason.trim()} onClick={onConfirmVoidStep}>Continue</button>
            </div>
          </div>
        ) : voidStep === 'confirm' ? (
          <div className="stack">
            <p className="error" role="alert">
              Void order #{order.number} ({formatPesos(order.totalCentavos)})? Reason: “{voidReason.trim()}”. This takes it off the wall and out of sales.
            </p>
            <div className="row-actions">
              <button type="button" className="btn btn-quiet grow" onClick={onCancelVoid}>Keep order</button>
              <button type="button" className="btn btn-danger grow" disabled={busy} onClick={onProceedVoidPin}>Confirm void</button>
            </div>
          </div>
        ) : voidStep === 'none' ? (
          <div className="row-actions">
            <button type="button" className="btn btn-ghost-danger" onClick={onStartVoid}>Void order</button>
            <button type="button" className="btn btn-primary grow" onClick={onClose}>Close</button>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

function OnlineOrderModal({ order, now, onClose }: { order: OnlineQueueOrder; now: number; onClose: () => void }) {
  const where = deliveryText(order)
  return (
    <Modal title={`Order W${order.ticketNumber}`} onClose={onClose}>
      <div className="stack">
        <p className="muted">{order.customerName} · {onlineWhen(order, now)} · {onlineStage(order.prepStatus, order.fulfilment) || order.prepStatus}</p>
        <ul className="detail-lines">
          {order.lines.map((line, i) => {
            const extras = onlineLineExtras(line)
            return (
              <li key={i}>
                <b>{line.quantity}×</b> {line.name}{sizeTag(line.size) ? <> <i>{sizeTag(line.size)}</i></> : null}
                {extras ? <small> · {extras}</small> : null}
              </li>
            )
          })}
        </ul>
        {order.customerNote ? <p className="online-note"><i>{order.customerNote}</i></p> : null}
        {where ? <p className="online-where">{where}</p> : null}
        <button type="button" className="btn btn-primary btn-block" onClick={onClose}>Close</button>
      </div>
    </Modal>
  )
}

/** A paid online order: forward-only (no Back, no Void: admin cancels and refunds), and no money. */
function OnlineTicket({
  order,
  now,
  busy,
  onOpen,
  onAdvance,
  onStamp,
}: {
  order: OnlineQueueOrder
  now: number
  busy: boolean
  onOpen: () => void
  onAdvance: () => void
  onStamp: () => void
}) {
  const cardLabel = onlineCardLabel(order.card)
  const action = onlineAction(order.prepStatus, order.fulfilment)
  const stage = onlineStage(order.prepStatus, order.fulfilment)
  const where = deliveryText(order)
  return (
    <article className="ticket ticket-online ticket-clickable" onClick={(e) => { if (!shouldIgnoreCardClick(e.target)) onOpen() }}>
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
              <b>{line.quantity}×</b> {line.name}{sizeTag(line.size) ? <> <i>{sizeTag(line.size)}</i></> : null}
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
              <b>{line.quantity}×</b> {line.name}{sizeTag(line.size) ? <> <i>{sizeTag(line.size)}</i></> : null}
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

import { useCallback, useEffect, useState } from 'react'
import { formatPesos, formatSignedPesos, parsePesos, sizeTag, type Summary } from '@kennko/core'
import { api, type Live, type TillState } from '../api.ts'
import { Modal } from '../components/Modal.tsx'
import { PinPrompt } from '../components/PinPrompt.tsx'

const when = (ms: number) => new Date(ms).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

type Pending =
  | { kind: 'cash-out'; amountCentavos: number; reason: string }
  | { kind: 'close'; countedCentavos: number; note: string }

/** The cash drawer: open it with starting cash, track cash in and out, and count it at closing. */
export function Till({ live, notify }: { live: Live; notify: (message: string) => void }) {
  const [state, setState] = useState<TillState | null>(null)
  const [float, setFloat] = useState('')
  const [error, setError] = useState('')
  const [moveKind, setMoveKind] = useState<'in' | 'out' | null>(null)
  const [closing, setClosing] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [closed, setClosed] = useState<{ summary: Summary; countedCentavos: number } | null>(null)

  const load = useCallback(() => { api.till().then(setState).catch((err) => notify(err.message)) }, [notify])
  useEffect(load, [load, live.version])

  if (!state) return <div className="loading">Loading the till…</div>

  const open = async () => {
    const centavos = float.trim() === '' ? 0 : parsePesos(float)
    if (centavos === null) return setError('Type the starting cash as a peso amount, like 1000.')
    try { await api.openTill(centavos); setFloat(''); setError('') } catch (err) { setError(err instanceof Error ? err.message : 'Could not open the till.') }
  }

  const { shift, summary } = state

  return (
    <div className="page">
      <header className="page-head">
        <h1>Till</h1>
        {shift ? <span className="pill pill-open">Open since {when(shift.openedAt)}</span> : <span className="pill">Closed</span>}
      </header>

      {!shift || !summary ? (
        <section className="card card-narrow">
          <h2>Open the till</h2>
          <p className="muted">Count the cash in the drawer before the first order. That amount is the starting cash.</p>
          <div className="field">
            <h3><label htmlFor="float">Starting cash</label></h3>
            <input id="float" className="input input-money" inputMode="decimal" placeholder="₱ 0" value={float} onChange={(e) => { setFloat(e.target.value); setError('') }} />
            <p className="error" role="alert">{error}</p>
          </div>
          <button type="button" className="btn btn-primary btn-big btn-block" onClick={open}>Open the till</button>
        </section>
      ) : (
        <>
          <div className="tiles">
            <div className="tile tile-blue"><span>Sales</span><b>{formatPesos(summary.netCentavos)}</b><small>{summary.orderCount} order{summary.orderCount === 1 ? '' : 's'}</small></div>
            <div className="tile"><span>Cash</span><b>{formatPesos(summary.cash.totalCentavos)}</b><small>{summary.cash.count} order{summary.cash.count === 1 ? '' : 's'}</small></div>
            <div className="tile"><span>GCash</span><b>{formatPesos(summary.gcash.totalCentavos)}</b><small>{summary.gcash.count} order{summary.gcash.count === 1 ? '' : 's'}</small></div>
            <div className="tile tile-amber"><span>Cash in drawer</span><b>{formatPesos(summary.expectedCashCentavos)}</b><small>expected</small></div>
          </div>

          <div className="two">
            <section className="card">
              <h2>Drawer</h2>
              <dl className="ledger">
                <div><dt>Starting cash</dt><dd>{formatPesos(summary.openingFloatCentavos)}</dd></div>
                <div><dt>Cash sales</dt><dd>+{formatPesos(summary.cash.totalCentavos)}</dd></div>
                <div><dt>Cash in</dt><dd>+{formatPesos(summary.cashInCentavos)}</dd></div>
                <div><dt>Cash out</dt><dd>-{formatPesos(summary.cashOutCentavos)}</dd></div>
                <div className="ledger-total"><dt>Expected in drawer</dt><dd>{formatPesos(summary.expectedCashCentavos)}</dd></div>
              </dl>
              <div className="foot-row">
                <button type="button" className="btn btn-outline grow" onClick={() => setMoveKind('in')}>Cash in</button>
                <button type="button" className="btn btn-outline grow" onClick={() => setMoveKind('out')}>Cash out</button>
              </div>
              {state.moves.length ? (
                <ul className="moves">
                  {state.moves.map((move) => (
                    <li key={move.id}>
                      <span>{move.reason}<small>{when(move.at)}{move.staffName ? ` · by ${move.staffName.trim().split(/\s+/)[0]}` : ''}</small></span>
                      <b className={move.kind === 'out' ? 'neg' : 'pos'}>{move.kind === 'out' ? '-' : '+'}{formatPesos(move.amountCentavos)}</b>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            <section className="card">
              <h2>This shift</h2>
              <dl className="ledger">
                <div><dt>Before discounts</dt><dd>{formatPesos(summary.grossCentavos)}</dd></div>
                <div><dt>Discounts</dt><dd>-{formatPesos(summary.discountCentavos)}</dd></div>
                <div className="ledger-total"><dt>Sales</dt><dd>{formatPesos(summary.netCentavos)}</dd></div>
                <div><dt>Dine in / Take out</dt><dd>{summary.dineInCount} / {summary.takeoutCount}</dd></div>
                <div><dt>Voided</dt><dd>{summary.voidCount} · {formatPesos(summary.voidCentavos)}</dd></div>
              </dl>
              <h3 className="sub">Sold</h3>
              {summary.items.length === 0 ? <p className="empty">No sales yet.</p> : (
                <table className="table">
                  <tbody>
                    {summary.items.map((item) => (
                      <tr key={`${item.name}|${item.size}`}>
                        <td>{item.name}{sizeTag(item.size) ? <> <i>{sizeTag(item.size)}</i></> : null}</td>
                        <td>{item.quantity}</td>
                        <td>{formatPesos(item.salesCentavos)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          <div className="foot-row page-foot">
            <button type="button" className="btn btn-outline" onClick={() => api.exportCsv(live.day).catch((err) => notify(err.message))}>Export today's sales</button>
            <button type="button" className="btn btn-danger" onClick={() => setClosing(true)}>Close the till</button>
          </div>
        </>
      )}

      {state.recent.length ? (
        <section className="card">
          <h2>Past shifts</h2>
          <table className="table table-head">
            <thead><tr><th>Closed</th><th>Orders</th><th>Sales</th><th>Expected</th><th>Counted</th><th>Over / short</th></tr></thead>
            <tbody>
              {state.recent.map(({ shift: s, summary: sum }) => {
                const diff = (s.countedCentavos ?? 0) - sum.expectedCashCentavos
                return (
                  <tr key={s.id}>
                    <td>{when(s.closedAt ?? s.openedAt)}{s.note ? <small>{s.note}</small> : null}</td>
                    <td>{sum.orderCount}</td>
                    <td>{formatPesos(sum.netCentavos)}</td>
                    <td>{formatPesos(sum.expectedCashCentavos)}</td>
                    <td>{formatPesos(s.countedCentavos ?? 0)}</td>
                    <td className={diff < 0 ? 'neg' : diff > 0 ? 'pos' : ''}>{diff === 0 ? 'Exact' : formatSignedPesos(diff)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      ) : null}

      {moveKind ? (
        <CashMoveDialog
          kind={moveKind}
          onClose={() => setMoveKind(null)}
          onSubmit={async (amountCentavos, reason) => {
            if (moveKind === 'out') { setPending({ kind: 'cash-out', amountCentavos, reason }); setMoveKind(null); return }
            await api.cashMove('in', amountCentavos, reason, '')
            setMoveKind(null)
          }}
        />
      ) : null}

      {closing && summary ? (
        <CloseDialog
          summary={summary}
          onClose={() => setClosing(false)}
          onSubmit={(countedCentavos, note) => { setPending({ kind: 'close', countedCentavos, note }); setClosing(false) }}
        />
      ) : null}

      {pending ? (
        <PinPrompt
          title="Manager PIN"
          hint={pending.kind === 'close' ? 'Closing the till ends this shift and locks its numbers.' : `Taking ${formatPesos(pending.amountCentavos)} out of the drawer.`}
          onClose={() => setPending(null)}
          onSubmit={async (pin) => {
            if (pending.kind === 'cash-out') {
              await api.cashMove('out', pending.amountCentavos, pending.reason, pin)
            } else {
              const result = await api.closeTill(pending.countedCentavos, pending.note, pin)
              setClosed({ summary: result.summary, countedCentavos: pending.countedCentavos })
            }
            setPending(null)
          }}
        />
      ) : null}

      {closed ? (
        <Modal title="Till closed" onClose={() => setClosed(null)}>
          <dl className="ledger">
            <div><dt>Sales</dt><dd>{formatPesos(closed.summary.netCentavos)}</dd></div>
            <div><dt>Cash / GCash</dt><dd>{formatPesos(closed.summary.cash.totalCentavos)} / {formatPesos(closed.summary.gcash.totalCentavos)}</dd></div>
            <div><dt>Expected in drawer</dt><dd>{formatPesos(closed.summary.expectedCashCentavos)}</dd></div>
            <div><dt>Counted</dt><dd>{formatPesos(closed.countedCentavos)}</dd></div>
            <div className="ledger-total"><dt>Over / short</dt><dd>{overShort(closed.countedCentavos - closed.summary.expectedCashCentavos)}</dd></div>
          </dl>
          <button type="button" className="btn btn-primary btn-block" onClick={() => setClosed(null)}>Done</button>
        </Modal>
      ) : null}
    </div>
  )
}

const overShort = (diff: number) => (diff === 0 ? 'Exact' : diff > 0 ? `${formatPesos(diff)} over` : `${formatPesos(-diff)} short`)

function CashMoveDialog({ kind, onSubmit, onClose }: { kind: 'in' | 'out'; onSubmit: (amountCentavos: number, reason: string) => Promise<void>; onClose: () => void }) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const submit = async () => {
    const centavos = parsePesos(amount)
    if (!centavos) return setError('Type a peso amount, like 200.')
    if (!reason.trim()) return setError('Say what the cash is for.')
    try { await onSubmit(centavos, reason.trim()) } catch (err) { setError(err instanceof Error ? err.message : 'That did not work.') }
  }
  return (
    <Modal title={kind === 'in' ? 'Cash in' : 'Cash out'} onClose={onClose}>
      <div className="field">
        <h3><label htmlFor="move-amount">Amount</label></h3>
        <input id="move-amount" className="input input-money" inputMode="decimal" placeholder="₱ 0" value={amount} autoFocus onChange={(e) => { setAmount(e.target.value); setError('') }} />
      </div>
      <div className="field">
        <h3><label htmlFor="move-reason">What is it for?</label></h3>
        <input id="move-reason" className="input" maxLength={80} placeholder={kind === 'in' ? 'More change for the drawer' : 'Ice, supplies, delivery rider…'} value={reason} onChange={(e) => { setReason(e.target.value); setError('') }} />
        <p className="error" role="alert">{error}</p>
      </div>
      <button type="button" className="btn btn-primary btn-block" onClick={submit}>{kind === 'in' ? 'Add cash' : 'Take cash out'}</button>
    </Modal>
  )
}

function CloseDialog({ summary, onSubmit, onClose }: { summary: Summary; onSubmit: (countedCentavos: number, note: string) => void; onClose: () => void }) {
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const centavos = counted.trim() === '' ? null : parsePesos(counted)
  return (
    <Modal title="Close the till" onClose={onClose}>
      <p className="muted">Count the cash in the drawer and type what you find.</p>
      <dl className="ledger">
        <div><dt>Expected in drawer</dt><dd>{formatPesos(summary.expectedCashCentavos)}</dd></div>
        {centavos !== null ? <div className="ledger-total"><dt>Over / short</dt><dd>{overShort(centavos - summary.expectedCashCentavos)}</dd></div> : null}
      </dl>
      <div className="field">
        <h3><label htmlFor="counted">Cash counted</label></h3>
        <input id="counted" className="input input-money" inputMode="decimal" placeholder="₱ 0" value={counted} autoFocus onChange={(e) => { setCounted(e.target.value); setError('') }} />
      </div>
      <div className="field">
        <h3><label htmlFor="close-note">Note (optional)</label></h3>
        <input id="close-note" className="input" maxLength={200} placeholder="Anything the owner should know" value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="error" role="alert">{error}</p>
      </div>
      <button type="button" className="btn btn-danger btn-block" onClick={() => (centavos === null ? setError('Type the cash you counted, like 3450.') : onSubmit(centavos, note.trim()))}>
        Close the till
      </button>
    </Modal>
  )
}

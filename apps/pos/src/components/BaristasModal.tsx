import { useState } from 'react'
import { ApiError, api, type OnDutyBarista, type PinChoice } from '../api.ts'
import { Modal } from './Modal.tsx'
import { Keypad } from './Keypad.tsx'

export function BaristasModal({
  onDuty,
  notify,
  onClose,
}: {
  onDuty: OnDutyBarista[]
  notify: (message: string) => void
  onClose: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [pin, setPin] = useState('')
  const [choices, setChoices] = useState<PinChoice[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const join = async (staffId?: string) => {
    if ((!staffId && pin.length < 4) || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await api.joinBarista(pin, staffId)
      notify(res.joined ? `${res.joined} joined the bar!` : 'Barista joined the bar!')
      setAdding(false)
      setPin('')
      setChoices(null)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && Array.isArray(err.data?.choices)) {
        setChoices(err.data.choices)
        setBusy(false)
        return
      }
      setError(err instanceof Error ? err.message : 'Wrong PIN.')
      setPin('')
      setChoices(null)
    } finally {
      setBusy(false)
    }
  }

  const leave = async (b: OnDutyBarista) => {
    if (busy) return
    setBusy(true)
    try {
      await api.leaveBarista(b.staffId)
      notify(`${b.name} left the bar.`)
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not clock out.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Baristas on bar" onClose={onClose}>
      <div className="stack">
        {!adding ? (
          <>
            <p className="muted">
              Logged-in baristas appear as their custom cats behind the counter on the cafe wall (up to 3 together).
            </p>
            {onDuty.length === 0 ? (
              <p className="empty">No barista clocked in yet.</p>
            ) : (
              <ul className="rows">
                {onDuty.map((b) => (
                  <li key={b.staffId} className="row" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <b>{b.name}</b>
                      <small className="muted" style={{ display: 'block' }}>{b.role}</small>
                    </div>
                    <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => leave(b)}>
                      Clock out
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="foot-row">
              {onDuty.length < 3 ? (
                <button type="button" className="btn btn-primary grow" onClick={() => { setAdding(true); setPin(''); setError(''); setChoices(null) }}>
                  + Add barista
                </button>
              ) : null}
              <button type="button" className="btn btn-outline" onClick={onClose}>Close</button>
            </div>
          </>
        ) : choices ? (
          <>
            <p className="muted">Tap your name to join the bar:</p>
            <div className="stack">
              {choices.map((c) => (
                <button key={c.id} type="button" className="btn btn-outline btn-block" disabled={busy} onClick={() => join(c.id)}>
                  {c.name} <small className="muted">({c.role})</small>
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-quiet btn-block" disabled={busy} onClick={() => { setChoices(null); setPin('') }}>
              Back
            </button>
          </>
        ) : (
          <>
            <p className="muted">Enter the 2nd barista&apos;s PIN to clock them in alongside you:</p>
            <div className="pin-dots" aria-label={`${pin.length} digits entered`}>
              {Array.from({ length: Math.max(6, pin.length) }, (_, i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}
            </div>
            {error ? <p className="error center" role="alert">{error}</p> : null}
            <Keypad onKey={(k) => { setError(''); setPin((p) => (p + k).slice(0, 8)) }} onBackspace={() => setPin((p) => p.slice(0, -1))} />
            <div className="foot-row">
              <button type="button" className="btn btn-quiet grow" disabled={busy} onClick={() => setAdding(false)}>Cancel</button>
              <button type="button" className="btn btn-primary grow" disabled={pin.length < 4 || busy} onClick={() => join()}>
                {busy ? 'Checking…' : 'Clock in'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

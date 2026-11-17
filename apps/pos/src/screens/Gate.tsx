import { useState } from 'react'
import { api, setPin } from '../api.ts'
import { Keypad } from '../components/Keypad.tsx'

/** The first thing a device sees: the staff PIN, asked once and remembered. */
export function Gate({ onUnlock }: { onUnlock: () => void }) {
  const [entry, setEntry] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!entry || busy) return
    setBusy(true)
    try {
      await api.checkPin(entry)
      setPin(entry)
      onUnlock()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wrong PIN.')
      setEntry('')
      setBusy(false)
    }
  }

  return (
    <div className="gate">
      <img src="/brand/wordmark-white.png" alt="Kennko Coffee" className="gate-logo" />
      <div className="gate-card">
        <h1>Enter your PIN</h1>
        <div className="pin-dots" aria-label={`${entry.length} digits entered`}>
          {Array.from({ length: Math.max(4, entry.length) }, (_, i) => <i key={i} className={i < entry.length ? 'on' : ''} />)}
        </div>
        <p className="error center" role="alert">{error}</p>
        <Keypad onKey={(k) => { setError(''); setEntry((p) => (p + k).slice(0, 8)) }} onBackspace={() => setEntry((p) => p.slice(0, -1))} />
        <button type="button" className="btn btn-primary btn-block" disabled={!entry || busy} onClick={submit}>
          {busy ? 'Checking…' : 'Open the till'}
        </button>
      </div>
    </div>
  )
}

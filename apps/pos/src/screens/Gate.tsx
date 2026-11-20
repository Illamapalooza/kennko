import { useState } from 'react'
import { api } from '../api.ts'
import { InstallNote } from '../components/InstallNote.tsx'
import { Keypad } from '../components/Keypad.tsx'
import { CatToon } from '@kennko/cats'

/** The first thing a device sees: the PIN, typed once and swapped for a session the till remembers. */
export function Gate({ onUnlock, secureUrl }: { onUnlock: () => void; secureUrl: string | null }) {
  const [entry, setEntry] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!entry || busy) return
    setBusy(true)
    try {
      await api.startSession(entry)
      onUnlock()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wrong PIN.')
      setEntry('')
      setBusy(false)
    }
  }

  return (
    <div className="gate">
      <img src="/brand/wordmark-blue.png" alt="Kennko Coffee" className="gate-logo" />
      <div className="gate-card">
        <CatToon coat="ginger" pose="peek" className="perch perch-peek perch-left" />
        <CatToon coat="tuxedo" pose="wave" className="perch perch-sit perch-right" />
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
      <InstallNote secureUrl={secureUrl} />
    </div>
  )
}

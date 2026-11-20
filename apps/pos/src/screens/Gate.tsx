import { useState } from 'react'
import { api, type Bootstrap, type Session } from '../api.ts'
import { InstallNote } from '../components/InstallNote.tsx'
import { Keypad } from '../components/Keypad.tsx'
import { CatToon } from '@kennko/cats'

type Props = { onUnlock: (who: Session) => void; secureUrl: string | null; pinMode: Bootstrap['pinMode'] }

/**
 * The first thing a device sees: the PIN, typed once and swapped for a session the till remembers.
 * Per-person mode takes each person's own 6 digits; shared mode the PIN from config.json (up to 8 digits).
 */
export function Gate({ onUnlock, secureUrl, pinMode }: Props) {
  const own = pinMode === 'per-person'
  const max = own ? 6 : 8
  const [entry, setEntry] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!entry || busy) return
    setBusy(true)
    try {
      onUnlock(await api.startSession(entry))
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
        <h1>{own ? 'Enter your own 6-digit PIN' : 'Enter your PIN'}</h1>
        <div className="pin-dots" aria-label={`${entry.length} digits entered`}>
          {Array.from({ length: own ? 6 : Math.max(4, entry.length) }, (_, i) => <i key={i} className={i < entry.length ? 'on' : ''} />)}
        </div>
        <p className="error center" role="alert">{error}</p>
        <Keypad onKey={(k) => { setError(''); setEntry((p) => (p + k).slice(0, max)) }} onBackspace={() => setEntry((p) => p.slice(0, -1))} />
        <button type="button" className="btn btn-primary btn-block" disabled={(own ? entry.length !== 6 : !entry) || busy} onClick={submit}>
          {busy ? 'Checking…' : 'Open the till'}
        </button>
      </div>
      <InstallNote secureUrl={secureUrl} />
    </div>
  )
}

import { useEffect, useState } from 'react'
import { api, type Bootstrap, type Session } from '../api.ts'
import { InstallNote } from '../components/InstallNote.tsx'
import { Keypad } from '../components/Keypad.tsx'
import { CatToon } from '@kennko/cats'

type Props = {
  onUnlock: (who: Session) => void
  secureUrl: string | null
  pinMode: Bootstrap['pinMode']
  /** Re-reads the till's PIN mode; called on mount and every 30 s while the Gate is shown. */
  onRefresh: () => void
}

const REFRESH_MS = 30_000

/**
 * The first thing a device sees: the PIN, typed once and swapped for a session the till remembers.
 * Per-person mode asks for each person's own 6 digits; shared mode for the PIN from config.json. Either way up to
 * 8 digits can be typed (sent from 4 in per-person): the shown mode may be a moment old, and the till decides.
 */
export function Gate({ onUnlock, secureUrl, pinMode, onRefresh }: Props) {
  const own = pinMode === 'per-person'

  useEffect(() => {
    onRefresh()
    const timer = setInterval(onRefresh, REFRESH_MS)
    return () => clearInterval(timer)
  }, [onRefresh])
  const [entry, setEntry] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // Shared mode keeps taking any length, as before; per-person sends from 4 digits so a 4-digit shared PIN still works.
  const ready = own ? entry.length >= 4 : entry.length > 0

  const submit = async () => {
    if (!ready || busy) return
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
          {Array.from({ length: Math.max(own ? 6 : 4, entry.length) }, (_, i) => <i key={i} className={i < entry.length ? 'on' : ''} />)}
        </div>
        <p className="error center" role="alert">{error}</p>
        <Keypad onKey={(k) => { setError(''); setEntry((p) => (p + k).slice(0, 8)) }} onBackspace={() => setEntry((p) => p.slice(0, -1))} />
        <button type="button" className="btn btn-primary btn-block" disabled={!ready || busy} onClick={submit}>
          {busy ? 'Checking…' : 'Open the till'}
        </button>
      </div>
      <InstallNote secureUrl={secureUrl} />
    </div>
  )
}

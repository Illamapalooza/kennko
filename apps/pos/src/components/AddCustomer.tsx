import { useEffect, useRef, useState } from 'react'
import { formatPublicCode, normalisePublicCode, type TillCustomer } from '@kennko/core'
import { api } from '../api.ts'
import { customerLine, typedCode } from '../loyaltyText.ts'
import { Modal } from './Modal.tsx'
import { QrScanner } from './QrScanner.tsx'

/** What the till knows about a code once it was looked up; `info` is null when the lookup could not be answered. */
export type FoundCustomer = { code: string; info: TillCustomer | null; note: string }

type Props = {
  /** Called on Confirm with the code (formatted) and what the lookup said. Throw to show a message and stay open. */
  onConfirm: (found: FoundCustomer) => Promise<void> | void
  onClose: () => void
}

const LOOKUP_MS = 3000

/**
 * Add a Kennko card to a sale: scan the customer's QR or type the code. Skipping is one tap (Close). The lookup never
 * holds Confirm back, and it gives up after 3 seconds ("Will confirm when back online").
 */
export function AddCustomer({ onConfirm, onClose }: Props) {
  const [text, setText] = useState('')
  const [scanning, setScanning] = useState(true)
  const [looked, setLooked] = useState<{ code: string; info: TillCustomer | null; note: string } | 'busy' | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const bare = normalisePublicCode(text)
  const shown = bare ? formatPublicCode(bare) : ''
  const seq = useRef(0)

  useEffect(() => {
    const mine = ++seq.current
    if (!bare) { setLooked(null); return }
    setLooked('busy')
    api.customer(formatPublicCode(bare), AbortSignal.timeout(LOOKUP_MS))
      .then((r) => { if (mine === seq.current) setLooked({ code: formatPublicCode(bare), info: r.customer, note: r.note ?? '' }) })
      .catch((err: unknown) => {
        if (mine !== seq.current) return
        const refused = err instanceof Error && 'status' in err && (err as { status: number }).status > 0
        // A refusal ("No Kennko card has that code") is shown; a timeout or no reply just waits for the internet.
        if (refused) { setLooked(null); setError((err as Error).message) } else setLooked({ code: formatPublicCode(bare), info: null, note: '' })
      })
  }, [bare])

  const take = (scanned: string) => {
    if (!normalisePublicCode(scanned)) return false
    setText(typedCode(scanned))
    setScanning(false)
    setError('')
    return true
  }

  const confirm = async () => {
    if (!bare || saving) return
    setSaving(true)
    setError('')
    try {
      let info = looked && looked !== 'busy' ? looked : null
      if (!info) {
        try {
          const r = await api.customer(formatPublicCode(bare), AbortSignal.timeout(LOOKUP_MS))
          info = { code: formatPublicCode(bare), info: r.customer, note: r.note ?? '' }
        } catch (err: unknown) {
          const refused = err instanceof Error && 'status' in err && (err as { status: number }).status > 0
          if (refused) throw err
        }
      }
      await onConfirm({ code: formatPublicCode(bare), info: info?.info ?? null, note: info?.note ?? '' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.')
      setSaving(false)
    }
  }

  return (
    <Modal title="Add customer" onClose={onClose}>
      <div className="stack">
        {scanning ? <QrScanner accept={take} /> : <button type="button" className="link" onClick={() => { setScanning(true); setText('') }}>Scan again</button>}
        <div className="field">
          <h3><label htmlFor="kc-code">Or type the code</label></h3>
          <input
            id="kc-code" className="input input-code" value={text} placeholder="KC-" autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false}
            inputMode="text" onChange={(e) => { setText(typedCode(e.target.value)); setError('') }}
          />
        </div>
        <p className="error" role="alert">{error || (text && !bare ? 'Check the code' : '')}</p>
        {bare ? (
          <p className="found" role="status">
            <b>{shown}</b>
            <span>{looked === 'busy' || looked === null ? 'Looking up…' : customerLine(looked.info, looked.note)}</span>
          </p>
        ) : null}
        <div className="foot-row">
          <button type="button" className="btn btn-quiet grow" onClick={onClose}>Skip</button>
          <button type="button" className="btn btn-primary grow" disabled={!bare || saving} onClick={confirm}>{saving ? 'Adding…' : 'Confirm'}</button>
        </div>
      </div>
    </Modal>
  )
}

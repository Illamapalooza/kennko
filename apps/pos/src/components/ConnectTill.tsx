import { useState } from 'react'
import { ApiError, api } from '../api.ts'
import { saveAlertMemory } from '../onlineAlerts.ts'
import { Keypad } from './Keypad.tsx'
import { Modal } from './Modal.tsx'
import { PinPrompt } from './PinPrompt.tsx'

type Props = { onConnected: (name: string) => void; onClose?: () => void; needsPin?: boolean; inline?: boolean }

/** Pairs this till with the Kennko API: the 6-digit code from admin › Tills, then (when needed) a manager PIN. */
export function ConnectTill({ onConnected, onClose = () => {}, needsPin = true, inline = false }: Props) {
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'code' | 'pin'>('code')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (step === 'pin') {
    return (
      <PinPrompt
        title="Manager PIN"
        hint="Connecting needs internet. Sales go on as normal while it connects."
        onClose={onClose}
        onSubmit={async (pin) => {
          try {
            const { name } = await api.pairDevice(code, pin)
            saveAlertMemory(null)
            onConnected(name)
          } catch (err) {
            // A wrong PIN (403) or a lockout (429) is shown in the PIN prompt; anything else is about the code.
            if (err instanceof ApiError && (err.status === 403 || err.status === 429)) throw err
            setError(err instanceof Error ? err.message : 'That did not work.')
            setCode('')
            setStep('code')
          }
        }}
      />
    )
  }

  const next = async () => {
    if (needsPin) { setStep('pin'); return }
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const { name } = await api.pairDevice(code, '')
      saveAlertMemory(null)
      onConnected(name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.')
      setCode('')
      setBusy(false)
    }
  }

  const body = (
    <>
      <p className="muted center">Type the 6-digit code from admin › Tills on the website.</p>
      <div className="pin-dots" aria-label={`${code.length} of 6 digits entered`}>
        {Array.from({ length: 6 }, (_, i) => <i key={i} className={i < code.length ? 'on' : ''} />)}
      </div>
      <p className="error center" role="alert">{error}</p>
      <Keypad onKey={(k) => { setError(''); setCode((p) => (p + k).slice(0, 6)) }} onBackspace={() => setCode((p) => p.slice(0, -1))} />
      <button type="button" className="btn btn-primary btn-block" disabled={code.length !== 6 || busy} onClick={next}>
        {busy ? 'Connecting…' : needsPin ? 'Next' : 'Connect'}
      </button>
    </>
  )

  if (inline) return body

  return (
    <Modal title="Connect this till" onClose={onClose}>
      {body}
    </Modal>
  )
}

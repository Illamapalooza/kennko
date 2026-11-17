import { useState } from 'react'
import { Keypad } from './Keypad.tsx'
import { Modal } from './Modal.tsx'

type Props = {
  title: string
  hint: string
  /** Resolve to close the prompt; throw to show the message and let them try again. */
  onSubmit: (pin: string) => Promise<void>
  onClose: () => void
}

/** Asks for the manager PIN before something that changes the money. */
export function PinPrompt({ title, hint, onSubmit, onClose }: Props) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!pin || busy) return
    setBusy(true)
    setError('')
    try {
      await onSubmit(pin)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.')
      setPin('')
      setBusy(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <p className="muted center">{hint}</p>
      <div className="pin-dots" aria-label={`${pin.length} digits entered`}>
        {Array.from({ length: Math.max(4, pin.length) }, (_, i) => <i key={i} className={i < pin.length ? 'on' : ''} />)}
      </div>
      <p className="error center" role="alert">{error}</p>
      <Keypad onKey={(k) => setPin((p) => (p + k).slice(0, 8))} onBackspace={() => setPin((p) => p.slice(0, -1))} />
      <button type="button" className="btn btn-primary btn-block" disabled={!pin || busy} onClick={submit}>
        {busy ? 'Checking…' : 'Confirm'}
      </button>
    </Modal>
  )
}

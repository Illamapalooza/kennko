'use client'

import { useState, useTransition } from 'react'
import { closeShift } from '@/app/admin/attention/actions'

/** Closes a stuck open shift from admin: the cash counted and a reason, then a confirm step. */
export function CloseShiftForm({ shiftId, tillName }: { shiftId: string; tillName: string }) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!open) {
    return (
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
        Close this shift
      </button>
    )
  }

  const submit = () =>
    startTransition(async () => {
      setError(null)
      const result = await closeShift(shiftId, counted, note)
      if (!result.ok) {
        setError(result.message)
        setConfirming(false)
      }
    })

  return (
    <form
      className="attention-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (confirming) return submit()
        setError(null)
        setConfirming(true)
      }}
    >
      <label className="admin-field">
        Cash counted (pesos, 0 if unknown)
        <input inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} disabled={confirming || pending} required />
      </label>
      <label className="admin-field">
        Reason
        <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} disabled={confirming || pending} required />
      </label>
      {confirming ? (
        <p className="admin-notice">
          Close {tillName}&apos;s shift with ₱{counted.trim()} counted? The till&apos;s own close, if it arrives later, replaces this.
        </p>
      ) : null}
      {error ? (
        <p className="admin-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="attention-actions">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {confirming ? 'Yes, close it' : 'Close shift'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending}
          onClick={() => (confirming ? setConfirming(false) : setOpen(false))}
        >
          {confirming ? 'Back' : 'Cancel'}
        </button>
      </div>
    </form>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { adjustPoints } from '@/app/admin/customers/actions'

/** Owner only (the page and the action both check): add or take off points, with a reason kept on the ledger. */
export function PointsForm({ customerId }: { customerId: string }) {
  const [delta, setDelta] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <form
      className="attention-form"
      onSubmit={(e) => {
        e.preventDefault()
        startTransition(async () => {
          setError(null)
          setDone(null)
          const result = await adjustPoints(customerId, delta, note)
          if (!result.ok) return setError(result.message)
          setDelta('')
          setNote('')
          setDone(result.points === null ? 'Points adjusted.' : `Points adjusted. Balance is now ${result.points}.`)
        })
      }}
    >
      <label className="admin-field">
        Points (+50 or -20)
        <input value={delta} inputMode="numeric" onChange={(e) => setDelta(e.target.value)} disabled={pending} required />
      </label>
      <label className="admin-field">
        Why
        <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} disabled={pending} required />
      </label>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        Adjust points
      </button>
      {error ? (
        <p className="admin-error" role="alert">
          {error}
        </p>
      ) : null}
      {done ? <p role="status">{done}</p> : null}
    </form>
  )
}

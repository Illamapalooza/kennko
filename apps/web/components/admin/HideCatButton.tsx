'use client'

import { useState, useTransition } from 'react'
import { setCatHidden } from '@/app/admin/customers/actions'

/** Manager or owner: take a cat off the wall, or put it back. The customer keeps the cat and sees a notice. */
export function HideCatButton({ customerId, hidden }: { customerId: string; hidden: boolean }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <div className="attention-form">
      <button
        type="button"
        className="btn btn-secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null)
            const r = await setCatHidden(customerId, !hidden)
            if (!r.ok) setError(r.message)
          })
        }
      >
        {hidden ? 'Show on the wall' : 'Hide from the wall'}
      </button>
      {error ? <p className="admin-error" role="alert">{error}</p> : null}
    </div>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { setAvailability } from '@/app/admin/menu/actions'

export function AvailabilityToggle({
  itemId,
  isAvailable,
}: {
  itemId: string
  isAvailable: boolean
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <>
      <button
        type="button"
        className={isAvailable ? 'btn btn-secondary' : 'btn btn-primary'}
        disabled={pending}
        onClick={() => {
          setError(null)
          startTransition(async () => {
            try {
              const result = await setAvailability(itemId, !isAvailable)
              if (!result.ok) setError(result.message)
            } catch {
              setError('Could not save. Try again.')
            }
          })
        }}
      >
        {pending ? 'Saving…' : isAvailable ? 'Mark sold out' : 'Mark available'}
      </button>
      {error ? (
        <small role="alert" className="price-cell-error">
          {error}
        </small>
      ) : null}
    </>
  )
}

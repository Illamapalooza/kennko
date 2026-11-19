'use client'

import { useState, useTransition } from 'react'
import { setBestseller } from '@/app/admin/menu/actions'

export function StarToggle({ itemId, isBestseller, editable }: { itemId: string; isBestseller: boolean; editable: boolean }) {
  const [on, setOn] = useState(isBestseller)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!editable) {
    return on ? <span className="star" aria-label="Bestseller">★</span> : null
  }

  return (
    <>
      <button
        type="button"
        className="star-toggle"
        aria-pressed={on}
        aria-label={on ? 'Remove bestseller' : 'Mark as bestseller'}
        disabled={pending}
        onClick={() => {
          const next = !on
          setOn(next)
          setError(null)
          startTransition(async () => {
            try {
              const result = await setBestseller(itemId, next)
              if (!result.ok) {
                setOn(!next)
                setError(result.message)
              }
            } catch {
              setOn(!next)
              setError('Could not save. Try again.')
            }
          })
        }}
      >
        {on ? '★' : '☆'}
      </button>
      {error ? (
        <small role="alert" className="price-cell-error">
          {error}
        </small>
      ) : null}
    </>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { setBestseller } from '@/app/admin/menu/actions'

export function StarToggle({ itemId, isBestseller, editable }: { itemId: string; isBestseller: boolean; editable: boolean }) {
  const [on, setOn] = useState(isBestseller)
  const [pending, startTransition] = useTransition()

  if (!editable) {
    return on ? <span className="star" aria-label="Bestseller">★</span> : null
  }

  return (
    <button
      type="button"
      className="star-toggle"
      aria-pressed={on}
      aria-label={on ? 'Remove bestseller' : 'Mark as bestseller'}
      disabled={pending}
      onClick={() => {
        const next = !on
        setOn(next)
        startTransition(async () => {
          const result = await setBestseller(itemId, next)
          if (!result.ok) setOn(!next)
        })
      }}
    >
      {on ? '★' : '☆'}
    </button>
  )
}

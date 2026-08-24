'use client'

import { useTransition } from 'react'
import { setAvailability } from '@/app/admin/menu/actions'

export function AvailabilityToggle({
  itemId,
  isAvailable,
}: {
  itemId: string
  isAvailable: boolean
}) {
  const [pending, startTransition] = useTransition()

  return (
    <button
      type="button"
      className={isAvailable ? 'btn btn-secondary' : 'btn btn-primary'}
      disabled={pending}
      onClick={() => startTransition(() => setAvailability(itemId, !isAvailable))}
    >
      {pending ? 'Saving…' : isAvailable ? 'Mark sold out' : 'Mark available'}
    </button>
  )
}

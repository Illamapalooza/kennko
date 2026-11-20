'use client'

import { useState, useTransition } from 'react'
import { setStampMode } from '@/app/admin/customers/actions'

/** Switches a customer between the digital and the paper card, with a confirm step. */
export function CardModeSwitch({ customerId, mode }: { customerId: string; mode: 'none' | 'digital' | 'paper' }) {
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const target = mode === 'paper' ? 'digital' : 'paper'
  const label = target === 'paper' ? 'Switch to paper card' : 'Switch to digital card'

  return (
    <div className="attention-form">
      {!asking ? (
        <button type="button" className="btn btn-secondary" onClick={() => setAsking(true)}>
          {label}
        </button>
      ) : (
        <>
          <p>
            {target === 'paper'
              ? 'Stamps will go on a paper card from now on. Online points still count.'
              : 'Stamps will go on the digital card from now on.'}{' '}
            Sure?
          </p>
          <div className="attention-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null)
                  const result = await setStampMode(customerId, target)
                  if (!result.ok) return setError(result.message)
                  setAsking(false)
                })
              }
            >
              Yes, {label.toLowerCase()}
            </button>
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </>
      )}
      {error ? (
        <p className="admin-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { revokeTill } from '@/app/admin/devices/actions'
import { tillStatus, type TillView } from '@/lib/admin/tills'

export function DeviceRow({ till }: { till: TillView }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const disconnect = () => {
    if (
      till.status === 'paired' &&
      !window.confirm(`Disconnect ${till.name}? It keeps selling but stops syncing, and keeps the PINs it had until it is paired again.`)
    ) {
      return
    }
    startTransition(async () => {
      setError(null)
      const result = await revokeTill(till.id)
      if (!result.ok) setError(result.message)
    })
  }

  return (
    <article className="section-card till-row">
      <strong>{till.name}</strong>
      <p>{tillStatus(till, Date.now())}</p>
      <button type="button" className="btn btn-secondary" disabled={pending} onClick={disconnect}>
        {till.status === 'expired' ? 'Remove' : 'Disconnect'}
      </button>
      {error ? (
        <p className="admin-error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  )
}

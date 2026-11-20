'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import type { PaperStamp } from '@kennko/core'
import { applyStamp, discardStamp } from '@/app/admin/customers/actions'
import { manilaStamp } from '@/app/admin/reports/dates'

/** A stamp rung up for a customer who was on a paper card: Apply it to their digital card, or discard it. */
export function PaperStampRow({ stamp, showCustomer = true }: { stamp: PaperStamp; showCustomer?: boolean }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const stillPaper = stamp.customerMode === 'paper'

  const run = (act: (id: string) => Promise<{ ok: true } | { ok: false; message: string }>) =>
    startTransition(async () => {
      setError(null)
      const result = await act(stamp.id)
      if (!result.ok) setError(result.message)
    })

  return (
    <article className="section-card attention-row">
      <p>
        <span className="report-pill">Paper card</span> <strong>{stamp.ticket}</strong>
        {showCustomer ? (
          <>
            {' '}
            ·{' '}
            <Link href={`/admin/customers/${stamp.customerId}`}>
              {stamp.displayName} ({stamp.customerCode})
            </Link>
          </>
        ) : null}
      </p>
      <p className="report-note">
        {manilaStamp(stamp.stampedAt)}
        {stamp.deviceName ? ` · ${stamp.deviceName}` : ''}
        {stamp.staffName ? ` · ${stamp.staffName}` : ''}
      </p>
      {stillPaper ? <p className="report-note">Still on a paper card. Switch them to the digital card to apply this stamp.</p> : null}
      <div className="attention-actions">
        <button type="button" className="btn btn-primary" disabled={pending || stillPaper} onClick={() => run(applyStamp)}>
          Apply stamp
        </button>
        <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => run(discardStamp)}>
          Discard
        </button>
      </div>
      {error ? (
        <p className="admin-error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  )
}

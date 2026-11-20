'use client'

import { useState, useTransition } from 'react'
import { formatPesos, type AttentionEvent, type FlaggedOrder } from '@kennko/core'
import { discardEvent, markEventSeen, markOrderSeen, retryTill } from '@/app/admin/attention/actions'
import { flagText, reasonText } from '@/app/admin/attention/text'
import { manilaStamp } from '@/app/admin/reports/dates'

const KIND: Record<AttentionEvent['result'], string> = { held: 'Held', flagged: 'Flagged', discarded: 'Set aside' }

type ActionResult = { ok: true } | { ok: false; message: string }

function ErrorLine({ message }: { message: string | null }) {
  return message ? (
    <p className="admin-error" role="alert">
      {message}
    </p>
  ) : null
}

/** A till record: what it is, why it needs a look, and (while open) Discard or Mark seen with a note. */
export function AttentionRow({ event }: { event: AttentionEvent }) {
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const run = () =>
    startTransition(async () => {
      setError(null)
      const act = event.action === 'discard' ? discardEvent : markEventSeen
      const result: ActionResult = await act(event.deviceId, event.id, note)
      if (!result.ok) setError(result.message)
    })

  const verb = event.action === 'discard' ? 'Discard' : 'Mark seen'
  const { summary } = event

  return (
    <article className="section-card attention-row">
      <p>
        <span className="report-pill">{KIND[event.result]}</span>{' '}
        <strong>{summary.label}</strong>
        {summary.amountCentavos !== null ? ` · ${formatPesos(summary.amountCentavos)}` : ''}
      </p>
      <p>{reasonText(event.result, event.reason)}</p>
      <p className="report-note">
        {event.deviceName}
        {event.deviceRevoked ? ' (disconnected)' : ''}
        {event.staffName ? ` · ${event.staffName}` : ''} · {manilaStamp(event.occurredAt)}
      </p>
      {event.resolvedAt ? (
        <p className="report-note">
          {event.result === 'discarded' ? 'Set aside' : 'Seen'} by {event.resolvedByName ?? 'the owner'}, {manilaStamp(event.resolvedAt)}
          {event.resolveNote ? `: ${event.resolveNote}` : ''}
        </p>
      ) : null}

      {event.action && !asking ? (
        <button type="button" className="btn btn-secondary" onClick={() => setAsking(true)}>
          {verb}
        </button>
      ) : null}
      {event.action && asking ? (
        <form
          className="attention-form"
          onSubmit={(e) => {
            e.preventDefault()
            run()
          }}
        >
          <label className="admin-field">
            {event.action === 'discard' ? 'Why set it aside? (kept with the report)' : 'Note'}
            <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} disabled={pending} required />
          </label>
          <div className="attention-actions">
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {verb}
            </button>
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      <ErrorLine message={error} />
    </article>
  )
}

/** A flagged order: Mark seen while open, who and when once resolved. */
export function FlaggedOrderRow({ order }: { order: FlaggedOrder }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <article className="section-card attention-row">
      <p>
        <span className="report-pill">Flagged order</span> <strong>{order.ticket}</strong> · {formatPesos(order.totalCentavos)}
      </p>
      <p>{order.flags.map(flagText).join('; ')}</p>
      <p className="report-note">
        {order.channel === 'online' ? 'Online' : (order.deviceName ?? 'Counter')} · {order.businessDay}
      </p>
      {order.seenAt ? (
        <p className="report-note">Seen {manilaStamp(order.seenAt)}</p>
      ) : (
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null)
              const result = await markOrderSeen(order.id)
              if (!result.ok) setError(result.message)
            })
          }
        >
          Mark seen
        </button>
      )}
      <ErrorLine message={error} />
    </article>
  )
}

/** One per till with held rows: asks the server to try them again now. */
export function RetryTillButton({ deviceId, tillName, held }: { deviceId: string; tillName: string; held: number }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  return (
    <div className="attention-retry">
      <button
        type="button"
        className="btn btn-secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null)
            const result = await retryTill(deviceId)
            if (!result.ok) setError(result.message)
          })
        }
      >
        Try again now: {tillName} ({held} held)
      </button>
      <ErrorLine message={error} />
    </div>
  )
}

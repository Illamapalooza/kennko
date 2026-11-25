'use client'

import { useState, useTransition } from 'react'
import { updateShopStatusAction, type ShopStatusState } from '@/app/admin/shop-actions'

export function ShopHoursCard({ initial }: { initial: ShopStatusState }) {
  const [status, setStatus] = useState(initial)
  const [closingDraft, setClosingDraft] = useState(initial.closingTime ?? '23:00')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  const apply = (patch: { isOpen?: boolean; closingTime?: string | null }) => {
    setError('')
    startTransition(async () => {
      const res = await updateShopStatusAction(patch)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setStatus(res.status)
      setClosingDraft(res.status.closingTime ?? '')
    })
  }

  return (
    <section className="admin-card" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>Shop status &amp; closing time</h2>
          <p className="admin-notice" style={{ margin: 0 }}>
            Opens 10:00 AM weekdays · 3:00 PM weekends. Auto-closes at your closing time unless opened manually.
          </p>
        </div>
        <span className={`pill${status.openNow ? ' pill-open' : ''}`}>
          {status.openNow ? 'Kennko Open' : 'Kennko Closed'}
        </span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 14 }}>
        <button
          type="button"
          className={`btn ${status.openNow ? 'btn-danger' : 'btn-primary'}`}
          disabled={pending}
          onClick={() => apply({ isOpen: !status.openNow })}
        >
          {status.openNow ? 'Close Kennko' : 'Open Kennko'}
        </button>

        <label htmlFor="admin-closing-time" style={{ fontWeight: 700, fontSize: '0.9rem' }}>
          Closing time
        </label>
        <input
          id="admin-closing-time"
          type="time"
          value={closingDraft}
          onChange={(e) => setClosingDraft(e.target.value)}
          style={{ padding: '8px 10px', borderRadius: 10, border: '2px solid #0d1b3d', font: 'inherit' }}
        />
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending || !closingDraft}
          onClick={() => apply({ closingTime: closingDraft })}
        >
          Save closing time
        </button>
        {status.closingTime ? (
          <button
            type="button"
            className="btn"
            disabled={pending}
            onClick={() => apply({ closingTime: null })}
          >
            No auto-close
          </button>
        ) : null}
      </div>
      {error ? <p className="admin-error" role="alert" style={{ marginTop: 8 }}>{error}</p> : null}
    </section>
  )
}

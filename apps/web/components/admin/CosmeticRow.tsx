'use client'

import { useState, useTransition } from 'react'
import type { CosmeticView } from '@kennko/core'
import { saveCosmetic } from '@/app/admin/cosmetics/actions'
import { CatCanvas } from '@/components/account/CatCanvas'

/** One catalogue item: a pixel preview and inline save. A starter stays free and on (the API refuses otherwise). */
export function CosmeticRow({ item }: { item: CosmeticView }) {
  const [name, setName] = useState(item.name)
  const [price, setPrice] = useState(String(item.pricePoints))
  const [sortOrder, setSortOrder] = useState(String(item.sortOrder))
  const [isActive, setIsActive] = useState(item.isActive)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()
  const look = item.slot === 'coat' ? { coat: item.key } : { coat: 'tabby', [item.slot]: item.key }

  return (
    <form
      className="section-card cosmetic-row"
      onSubmit={(e) => {
        e.preventDefault()
        setMessage(null)
        start(async () => {
          const r = await saveCosmetic(item.id, { name, price, isActive, sortOrder })
          setMessage({ ok: r.ok, text: r.ok ? 'Saved.' : r.message })
        })
      }}
    >
      <div className="cosmetic-preview">
        <CatCanvas look={look} label={`${item.name} on a cat`} scale={4} />
      </div>
      <div className="cosmetic-fields">
        <label className="admin-field cosmetic-name">
          Name
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} disabled={pending} required />
        </label>
        <label className="admin-field">
          Price (points)
          <input value={price} inputMode="numeric" onChange={(e) => setPrice(e.target.value)} disabled={pending || item.isStarter} required />
        </label>
        <label className="admin-field">
          Order
          <input value={sortOrder} inputMode="numeric" onChange={(e) => setSortOrder(e.target.value)} disabled={pending} required />
        </label>
        <div className="cosmetic-actions">
          <label className="cosmetic-check">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} disabled={pending || item.isStarter} />
            {isActive ? 'On' : 'Off'}
          </label>
          <button type="submit" className="btn btn-primary" disabled={pending}>Save</button>
        </div>
        {item.isStarter ? <p className="report-note cosmetic-name">Starter: free for everyone, always on.</p> : null}
        {message ? (
          <p className={message.ok ? undefined : 'admin-error'} role={message.ok ? 'status' : 'alert'}>{message.text}</p>
        ) : null}
      </div>
    </form>
  )
}

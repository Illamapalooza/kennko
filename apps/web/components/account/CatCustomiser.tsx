'use client'

import { useMemo, useState, useTransition } from 'react'
import { checkCatName, COSMETIC_SLOTS, type CatLook, type CosmeticSlot, type CosmeticView, type MeView } from '@kennko/core'
import { buyCosmetic, saveCat } from '@/app/account/cat-actions'
import { catLabel, draftLook, shopRows, SLOT_LABELS } from '@/app/account/cat'
import { CatCanvas } from './CatCanvas'

type Customer = NonNullable<MeView['customer']>

const timeFormat = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' })

export function CatCustomiser({ cat, owned, points, catalogue }: {
  cat: Customer['cat']
  owned: string[]
  points: number
  catalogue: CosmeticView[]
}) {
  const [name, setName] = useState(cat.name)
  const [look, setLook] = useState<CatLook>(cat.look)
  const [showOnWall, setShowOnWall] = useState(cat.showOnWall)
  const [slot, setSlot] = useState<CosmeticSlot>('coat')
  const [confirming, setConfirming] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [pending, start] = useTransition()

  const rows = useMemo(() => shopRows(catalogue, owned, points), [catalogue, owned, points])
  const names = useMemo(() => Object.fromEntries(catalogue.map((c) => [c.key, c.name])), [catalogue])
  const items = rows.find((r) => r.slot === slot)!.items
  const nameCheck = checkCatName(name)
  const dirty = name !== cat.name || showOnWall !== cat.showOnWall || JSON.stringify(look) !== JSON.stringify(cat.look)

  function save() {
    const f = new FormData()
    f.set('name', name)
    for (const s of COSMETIC_SLOTS) f.set(s, look[s] ?? '')
    if (showOnWall) f.set('showOnWall', 'on')
    setMessage(null)
    start(async () => {
      const r = await saveCat(f)
      setMessage({ ok: r.ok, text: r.ok ? 'Saved.' : r.message })
    })
  }

  function buy(id: string) {
    setMessage(null)
    start(async () => {
      const r = await buyCosmetic(id)
      setConfirming(null)
      setMessage({ ok: r.ok, text: r.ok ? 'It is yours. Tap it to try it on.' : r.message })
    })
  }

  return (
    <section className="panel account-card cat-panel" aria-labelledby="cat-h">
      <h2 className="panel-title" id="cat-h">Your cat</h2>

      {cat.hiddenByAdmin ? (
        <p className="account-note" role="status">Kennko has paused your cat on the wall for now.</p>
      ) : cat.visitEndsAt ? (
        <p className="account-note" role="status">
          Your cat is at Kennko until {timeFormat.format(new Date(cat.visitEndsAt))}
        </p>
      ) : null}

      <div className="cat-stage">
        <CatCanvas look={look} label={catLabel(nameCheck.ok ? nameCheck.name : cat.name, look, names)} />
      </div>
      <p className="cat-points">Points: <strong>{points}</strong></p>

      <div className="cat-field">
        <label htmlFor="cat-name">Cat name</label>
        <input
          id="cat-name"
          type="text"
          value={name}
          maxLength={16}
          aria-invalid={!nameCheck.ok}
          aria-describedby="cat-name-hint"
          onChange={(e) => setName(e.target.value)}
        />
        <p id="cat-name-hint" className={nameCheck.ok ? 'account-guest' : 'cat-bad'}>
          {nameCheck.ok ? 'Looks good.' : nameCheck.message}
        </p>
      </div>

      <div className="cat-tabs" role="tablist" aria-label="Cat slots">
        {COSMETIC_SLOTS.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            id={`cat-tab-${s}`}
            aria-selected={slot === s}
            aria-controls="cat-items"
            className="cat-tab"
            onClick={() => { setSlot(s); setConfirming(null) }}
          >
            {SLOT_LABELS[s]}
          </button>
        ))}
      </div>

      <div id="cat-items" role="tabpanel" aria-labelledby={`cat-tab-${slot}`} className="cat-grid">
        {slot !== 'coat' ? (
          <button
            type="button"
            className="cat-item"
            aria-pressed={!look[slot]}
            onClick={() => setLook(draftLook(look, slot, null))}
          >
            <span className="cat-item-name">None</span>
          </button>
        ) : null}
        {items.map((it) => (
          <div key={it.key} className="cat-cell">
            {it.state === 'equippable' ? (
              <button
                type="button"
                className="cat-item"
                aria-pressed={look[slot] === it.key}
                onClick={() => setLook(draftLook(look, slot, it.key))}
              >
                <span className="cat-item-name">{it.name}</span>
              </button>
            ) : confirming === it.id ? (
              <div className="cat-item cat-confirm">
                <span className="cat-item-name">{it.name}</span>
                <span className="cat-confirm-q">Spend {it.price} points?</span>
                <span className="cat-confirm-row">
                  <button type="button" className="sheet-add" disabled={pending} onClick={() => buy(it.id)}>Yes, buy</button>
                  <button type="button" className="quiet-btn" onClick={() => setConfirming(null)}>Cancel</button>
                </span>
              </div>
            ) : (
              <div className="cat-item cat-shop">
                <span className="cat-item-name">{it.name}</span>
                <span className="price-chip">{it.price} points</span>
                {it.state === 'buy' ? (
                  <button type="button" className="quiet-btn" onClick={() => setConfirming(it.id)}>
                    Buy for {it.price} points
                  </button>
                ) : (
                  <span className="cat-short">{it.shortBy}</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <label className="check-row cat-switch">
        <input type="checkbox" role="switch" checked={showOnWall} onChange={(e) => setShowOnWall(e.target.checked)} />
        <span>Show me on the wall</span>
      </label>

      <button type="button" className="sheet-add cat-save" disabled={pending || !nameCheck.ok || !dirty} onClick={save}>
        {pending ? 'Saving…' : 'Save my cat'}
      </button>
      {message ? (
        <p className={message.ok ? 'account-note' : 'order-error'} role={message.ok ? 'status' : 'alert'}>{message.text}</p>
      ) : null}
    </section>
  )
}

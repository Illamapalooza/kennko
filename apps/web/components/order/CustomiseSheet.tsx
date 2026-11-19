'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatPesos } from '@/lib/money'
import { lineTotal } from '@/lib/cart/total'
import { DrinkPlaceholder } from './DrinkPlaceholder'
import { drinkPhoto } from './drinkImage'
import { SIZE_VOLUMES } from '@/lib/menu/sizes'
import {
  ICE_LEVELS, ICE_SERVES, takesIce, takesIceServe, normaliseIce,
  type IceLevel, type IceServe,
} from '@/lib/cart/ice'
import { groupsForItem } from '@/lib/menu/item-groups'
import type { DrinkSize, MenuItemWithPrices } from '@/lib/menu/types'

export type ModifierGroup = {
  id: string
  name: string
  isMultiSelect: boolean
  modifiers: { id: string; name: string; priceCentavos: number }[]
}

export type SheetResult = {
  size: DrinkSize
  modIds: string[]
  quantity: number
  iceLevel: IceLevel | null
  iceServe: IceServe | null
  note: string
}

export function CustomiseSheet({
  item, initialSize, groups: allGroups, onCancel, onAdd,
}: {
  item: MenuItemWithPrices
  initialSize: DrinkSize
  groups: ModifierGroup[]
  onCancel: () => void
  onAdd: (item: MenuItemWithPrices, result: SheetResult) => void
}) {
  // Only this item's own groups: checkout refuses an add-on whose group is not linked to the item.
  const groups = useMemo(() => groupsForItem(allGroups, item.optionGroupIds), [allGroups, item.optionGroupIds])
  const [size, setSize] = useState<DrinkSize>(initialSize)
  const [modIds, setModIds] = useState<string[]>([])
  const [qty, setQty] = useState(1)
  const [iceLevel, setIceLevel] = useState<IceLevel | null>(null)
  const [iceServe, setIceServe] = useState<IceServe | null>(null)
  const [note, setNote] = useState('')

  // Escape closes, and the page behind must not scroll under the sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onCancel])

  const ice = useMemo(
    () => normaliseIce(size, iceLevel, iceServe),
    [size, iceLevel, iceServe],
  )

  const base = item.prices.find((p) => p.size === size)?.priceCentavos ?? 0
  const chosen = groups.flatMap((g) => g.modifiers).filter((m) => modIds.includes(m.id))
  const unit = base + chosen.reduce((sum, m) => sum + m.priceCentavos, 0)
  const total = lineTotal({ basePriceCentavos: base, modifiers: chosen, quantity: qty })
  const photo = drinkPhoto(null)

  function toggle(group: ModifierGroup, id: string) {
    setModIds((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id)
      if (group.isMultiSelect) return [...current, id]
      const siblings = group.modifiers.map((m) => m.id)
      return [...current.filter((x) => !siblings.includes(x)), id]
    })
  }

  return (
    <div
      className="sheet-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={`Customise ${item.name}`}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="sheet">
        <header className="sheet-head">
          <div className="sheet-thumb">
            {photo
              ? <img className="drink-media" src={photo} alt="" />
              : <DrinkPlaceholder name={item.name} />}
          </div>
          <div className="sheet-title">
            <h2>{item.name}</h2>
            <p>{formatPesos(unit)} each</p>
          </div>
          <button type="button" className="sheet-close" onClick={onCancel} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="sheet-body">
          <p className="sheet-label">Size</p>
          <div className="chips">
            {item.prices.map((p) => (
              <button
                key={p.size}
                type="button"
                aria-pressed={size === p.size}
                onClick={() => setSize(p.size)}
              >
                <span>{p.size}</span>
                <small className="chip-vol">{SIZE_VOLUMES[p.size]}</small>
                <span className="chip-plus">{formatPesos(p.priceCentavos)}</span>
              </button>
            ))}
          </div>

          {takesIce(size) ? (
            <>
              <p className="sheet-label">Ice</p>
              <div className="chips">
                {ICE_LEVELS.map((level) => (
                  <button
                    key={level.value}
                    type="button"
                    aria-pressed={ice.level === level.value}
                    onClick={() => setIceLevel(level.value)}
                  >
                    {level.label}
                  </button>
                ))}
              </div>

              {takesIceServe(size, ice.level) ? (
                <>
                  <p className="sheet-label">How should we serve the ice?</p>
                  <div className="chips chips-stacked">
                    {ICE_SERVES.map((serve) => (
                      <button
                        key={serve.value}
                        type="button"
                        aria-pressed={ice.serve === serve.value}
                        onClick={() => setIceServe(serve.value)}
                      >
                        <span>{serve.label}</span>
                        <small>{serve.hint}</small>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          ) : (
            <p className="sheet-hint">Served hot — no ice.</p>
          )}

          {groups.map((group) => (
            <div key={group.id}>
              <p className="sheet-label">
                {group.name}
                <span>{group.isMultiSelect ? 'choose any' : 'choose one'}</span>
              </p>
              <div className="chips">
                {group.modifiers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={modIds.includes(m.id)}
                    onClick={() => toggle(group, m.id)}
                  >
                    {m.name} <span className="chip-plus">+{formatPesos(m.priceCentavos)}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}

          <p className="sheet-label">
            Other notes
            <span>optional</span>
          </p>
          <textarea
            className="sheet-note"
            value={note}
            maxLength={200}
            rows={2}
            placeholder="Less sweet, extra hot, light on the syrup…"
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="sheet-counter">{note.length}/200</p>

          <p className="sheet-label">Price</p>
          <dl className="breakdown">
            <div>
              <dt>
                {item.name} <span>{SIZE_VOLUMES[size]}</span>
              </dt>
              <dd>{formatPesos(base)}</dd>
            </div>

            {chosen.map((m) => (
              <div key={m.id}>
                <dt>{m.name}</dt>
                <dd>+{formatPesos(m.priceCentavos)}</dd>
              </div>
            ))}

            {ice.level && ice.level !== 'regular' ? (
              <div>
                <dt>
                  {ice.level === 'none' ? 'No ice' : 'Less ice'}
                  {ice.serve === 'side' ? ', on the side' : ''}
                </dt>
                <dd>Free</dd>
              </div>
            ) : null}

            <div className="breakdown-sub">
              <dt>Each</dt>
              <dd>{formatPesos(unit)}</dd>
            </div>

            {qty > 1 ? (
              <div className="breakdown-sub">
                <dt>× {qty}</dt>
                <dd>{formatPesos(total)}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        <footer className="sheet-foot">
          <div className="stepper" role="group" aria-label="Quantity">
            <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))}
                    disabled={qty <= 1} aria-label="One fewer">−</button>
            <span aria-live="polite">{qty}</span>
            <button type="button" onClick={() => setQty((q) => Math.min(20, q + 1))}
                    disabled={qty >= 20} aria-label="One more">+</button>
          </div>
          <button
            type="button"
            className="sheet-add"
            onClick={() =>
              onAdd(item, {
                size, modIds, quantity: qty,
                iceLevel: ice.level, iceServe: ice.serve,
                note: note.trim(),
              })
            }
          >
            Add to order · {formatPesos(total)}
          </button>
        </footer>
      </div>
    </div>
  )
}

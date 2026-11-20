import { useMemo, useState } from 'react'
import {
  ICE_LEVELS, ICE_SERVES, MAX_QUANTITY, NOTE_MAX, SIZE_LABELS, formatPesos, groupsFor, normaliseIce, takesIce, takesIceServe,
  type IceLevel, type IceServe, type LineInput, type Menu, type MenuItem,
} from '@kennko/core'
import { Modal } from '../components/Modal.tsx'
import { toggleAddon } from '../addons.ts'

type Props = {
  menu: Menu
  item: MenuItem
  /** Present when editing a line already in the cart. */
  initial?: LineInput
  onSave: (line: LineInput) => void
  onRemove?: () => void
  onClose: () => void
}

export function Customise({ menu, item, initial, onSave, onRemove, onClose }: Props) {
  const [size, setSize] = useState(initial?.size ?? item.prices[0].size)
  const [iceLevel, setIceLevel] = useState<IceLevel | null>(initial?.iceLevel ?? null)
  const [iceServe, setIceServe] = useState<IceServe | null>(initial?.iceServe ?? null)
  const [picked, setPicked] = useState<Set<string>>(new Set(initial?.modifierIds ?? []))
  const [note, setNote] = useState(initial?.note ?? '')
  const [quantity, setQuantity] = useState(initial?.quantity ?? 1)
  const [addonLimit, setAddonLimit] = useState<string | null>(null)

  const ice = normaliseIce(size, iceLevel, iceServe)
  // Only this drink's own add-on groups, as the API reprices it (an add-on from another drink's group is never offered).
  const groups = useMemo(() => groupsFor(menu, item), [menu, item])
  const unit = useMemo(() => {
    const base = item.prices.find((p) => p.size === size)?.priceCentavos ?? 0
    const extras = groups.flatMap((g) => g.modifiers).filter((m) => picked.has(m.id)).reduce((sum, m) => sum + m.priceCentavos, 0)
    return base + extras
  }, [item, groups, size, picked])

  const toggle = (groupId: string, id: string) => {
    const { next, refused } = toggleAddon(groups, picked, groupId, id)
    setPicked(next)
    setAddonLimit(refused)
  }

  const save = () => onSave({ menuItemId: item.id, size, modifierIds: [...picked], quantity, iceLevel: ice.level, iceServe: ice.serve, note: note.trim() })

  return (
    <Modal
      title={item.name}
      onClose={onClose}
      size="wide"
      footer={
        <div className="foot-row">
          <div className="stepper" role="group" aria-label="Quantity">
            <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="One fewer">−</button>
            <b>{quantity}</b>
            <button type="button" onClick={() => setQuantity((q) => Math.min(MAX_QUANTITY, q + 1))} aria-label="One more">+</button>
          </div>
          {onRemove ? <button type="button" className="btn btn-ghost-danger" onClick={onRemove}>Remove</button> : null}
          <button type="button" className="btn btn-primary grow" onClick={save}>
            {initial ? 'Update' : 'Add'} · {formatPesos(unit * quantity)}
          </button>
        </div>
      }
    >
      <section className="field">
        <h3>Size</h3>
        <div className="choices">
          {item.prices.map((p) => (
            <button type="button" key={p.size} className={`choice${p.size === size ? ' on' : ''}`} aria-pressed={p.size === size} onClick={() => setSize(p.size)}>
              <span>{SIZE_LABELS[p.size]}</span>
              <small>{formatPesos(p.priceCentavos)}</small>
            </button>
          ))}
        </div>
      </section>

      {takesIce(size) ? (
        <section className="field">
          <h3>Ice</h3>
          <div className="choices">
            {ICE_LEVELS.map((l) => (
              <button type="button" key={l.value} className={`choice${ice.level === l.value ? ' on' : ''}`} aria-pressed={ice.level === l.value} onClick={() => setIceLevel(l.value)}>
                <span>{l.label}</span>
              </button>
            ))}
          </div>
          {takesIceServe(size, ice.level) ? (
            <div className="choices choices-tight">
              {ICE_SERVES.map((s) => (
                <button type="button" key={s.value} className={`choice choice-small${ice.serve === s.value ? ' on' : ''}`} aria-pressed={ice.serve === s.value} onClick={() => setIceServe(s.value)}>
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {addonLimit ? <p className="error" role="alert">{addonLimit}</p> : null}
      {groups.map((group) => (
        <section className="field" key={group.id}>
          <h3>{group.name} <small>{group.isMultiSelect ? 'any' : 'pick one'}</small></h3>
          <div className="choices">
            {group.modifiers.map((m) => (
              <button type="button" key={m.id} disabled={!m.isAvailable} className={`choice${picked.has(m.id) ? ' on' : ''}`} aria-pressed={picked.has(m.id)} onClick={() => toggle(group.id, m.id)}>
                <span>{m.name}</span>
                <small>+{formatPesos(m.priceCentavos)}</small>
              </button>
            ))}
          </div>
        </section>
      ))}

      <section className="field">
        <h3><label htmlFor="line-note">Note for the barista</label></h3>
        <input id="line-note" className="input" value={note} maxLength={NOTE_MAX} placeholder="Less sweet, extra hot…" onChange={(e) => setNote(e.target.value)} />
      </section>
    </Modal>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatPesos } from '@/lib/money'
import { lineTotal, cartSubtotal } from '@/lib/cart/total'
import { validateCheckout } from '@/lib/orders/validate'
import type { CartLine, Fulfilment } from '@/lib/cart/types'
import type { MenuCategoryWithItems, MenuItemWithPrices, DrinkSize } from '@/lib/menu/types'

export type ModifierGroup = {
  id: string
  name: string
  isMultiSelect: boolean
  modifiers: { id: string; name: string; priceCentavos: number }[]
}

export type Zone = { barangay: string; feeCentavos: number }

const STORAGE_KEY = 'kennko-cart-v1'

export function OrderClient({
  categories,
  modifierGroups,
  zones,
}: {
  categories: MenuCategoryWithItems[]
  modifierGroups: ModifierGroup[]
  zones: Zone[]
}) {
  const [lines, setLines] = useState<CartLine[]>([])
  const [editing, setEditing] = useState<MenuItemWithPrices | null>(null)
  const [step, setStep] = useState<'menu' | 'checkout' | 'pay' | 'done'>('menu')

  const [fulfilment, setFulfilment] = useState<Fulfilment>('pickup')
  const [form, setForm] = useState({
    name: '', email: '', phone: '', address: '', barangay: '', fulfilAt: '', note: '',
    gcashReference: '',
  })
  const [proof, setProof] = useState<File | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [orderCode, setOrderCode] = useState<string | null>(null)

  // Cart survives a refresh mid-order.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) setLines(JSON.parse(saved) as CartLine[])
    } catch {
      // Corrupt or unavailable storage is not worth failing the page over.
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines))
    } catch {
      // Private browsing can throw on write; the cart just won't persist.
    }
  }, [lines])

  const subtotal = useMemo(() => cartSubtotal(lines), [lines])
  const zone = zones.find((z) => z.barangay === form.barangay)
  const fee = fulfilment === 'delivery' ? (zone?.feeCentavos ?? 0) : 0
  const total = subtotal + fee

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))

  function addLine(item: MenuItemWithPrices, size: DrinkSize, modIds: string[], qty: number) {
    const price = item.prices.find((p) => p.size === size)
    if (!price) return
    const mods = modifierGroups
      .flatMap((g) => g.modifiers)
      .filter((m) => modIds.includes(m.id))

    setLines((current) => [
      ...current,
      {
        lineId: crypto.randomUUID(),
        menuItemId: item.id,
        name: item.name,
        size,
        basePriceCentavos: price.priceCentavos,
        modifiers: mods,
        quantity: qty,
      },
    ])
    setEditing(null)
  }

  async function submit() {
    const problems = validateCheckout({
      name: form.name, email: form.email, phone: form.phone,
      fulfilment, address: form.address, barangay: form.barangay,
      fulfilAt: form.fulfilAt, gcashReference: form.gcashReference,
    })
    if (!proof) problems.push('Upload your GCash receipt screenshot.')
    if (problems.length > 0) { setErrors(problems); return }
    // Narrowed for real rather than asserted: problems is non-empty above if
    // proof is null, so reaching here means it is a File.
    const proofFile = proof
    if (!proofFile) return

    setErrors([])
    setSubmitting(true)

    const body = new FormData()
    body.set('order', JSON.stringify({
      name: form.name, email: form.email, phone: form.phone,
      fulfilment, address: form.address, barangay: form.barangay,
      fulfilAt: form.fulfilAt, gcashReference: form.gcashReference,
      note: form.note,
      claimedTotalCentavos: total,
      lines: lines.map((l) => ({
        menuItemId: l.menuItemId, size: l.size, quantity: l.quantity,
        modifierIds: l.modifiers.map((m) => m.id),
      })),
    }))
    body.set('proof', proofFile)

    try {
      const response = await fetch('/api/orders', { method: 'POST', body })
      const result = await response.json()
      if (!response.ok) {
        setErrors(result.errors ?? ['Something went wrong. Please try again.'])
        return
      }
      setOrderCode(result.orderCode)
      setLines([])
      setStep('done')
    } catch {
      setErrors(['Could not reach the server. Check your connection and try again.'])
    } finally {
      setSubmitting(false)
    }
  }

  if (step === 'done' && orderCode) {
    return (
      <div className="order-card">
        <h1>Order {orderCode}</h1>
        <p className="order-note">
          <strong>Your order is not confirmed yet.</strong> A barista still has to
          check your GCash payment. You will get a confirmation email once they do
          — please do not come in or expect delivery before that.
        </p>
        <p>
          Keep this code: <strong>{orderCode}</strong>. You can check it any time at{' '}
          <a href={`/order/${orderCode}`}>/order/{orderCode}</a>.
        </p>
      </div>
    )
  }

  return (
    <>
      {step === 'menu' ? (
        <>
          <h1>Order from Kennko</h1>
          <p>Pick your drinks, then choose pickup or delivery.</p>

          {categories.map((category) => (
            <section key={category.id}>
              <h2>{category.name}</h2>
              {category.items.map((item) => (
                <button
                  key={item.id}
                  className="order-item"
                  disabled={!item.isAvailable || item.prices.length === 0}
                  onClick={() => setEditing(item)}
                >
                  <span className="order-item-name">
                    {item.name}
                    {item.isBestseller ? ' ★' : ''}
                  </span>
                  <span className="order-item-price">
                    {!item.isAvailable
                      ? 'Sold out'
                      : `from ${formatPesos(Math.min(...item.prices.map((p) => p.priceCentavos)))}`}
                  </span>
                </button>
              ))}
            </section>
          ))}
        </>
      ) : null}

      {step === 'checkout' ? (
        <CheckoutStep
          lines={lines} subtotal={subtotal} fee={fee} total={total}
          fulfilment={fulfilment} setFulfilment={setFulfilment}
          zones={zones} form={form} set={set} errors={errors}
          onBack={() => setStep('menu')}
          onNext={() => setStep('pay')}
          onRemove={(id) => setLines((c) => c.filter((l) => l.lineId !== id))}
        />
      ) : null}

      {step === 'pay' ? (
        <PayStep
          total={total} form={form} set={set} errors={errors}
          proof={proof} setProof={setProof} submitting={submitting}
          onBack={() => setStep('checkout')} onSubmit={submit}
        />
      ) : null}

      {editing ? (
        <ItemSheet
          item={editing}
          groups={modifierGroups}
          onCancel={() => setEditing(null)}
          onAdd={addLine}
        />
      ) : null}

      {lines.length > 0 && step === 'menu' ? (
        <div className="order-cart-bar">
          <span>
            {lines.reduce((n, l) => n + l.quantity, 0)} item(s) · {formatPesos(subtotal)}
          </span>
          <button className="btn btn-secondary" onClick={() => setStep('checkout')}>
            Review order
          </button>
        </div>
      ) : null}
    </>
  )
}

function ItemSheet({
  item, groups, onCancel, onAdd,
}: {
  item: MenuItemWithPrices
  groups: ModifierGroup[]
  onCancel: () => void
  onAdd: (item: MenuItemWithPrices, size: DrinkSize, modIds: string[], qty: number) => void
}) {
  const [size, setSize] = useState<DrinkSize>(item.prices[0]?.size ?? 'M')
  const [modIds, setModIds] = useState<string[]>([])
  const [qty, setQty] = useState(1)

  const base = item.prices.find((p) => p.size === size)?.priceCentavos ?? 0
  const mods = groups.flatMap((g) => g.modifiers).filter((m) => modIds.includes(m.id))
  const preview = lineTotal({ basePriceCentavos: base, modifiers: mods, quantity: qty })

  function toggle(group: ModifierGroup, id: string) {
    setModIds((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id)
      if (group.isMultiSelect) return [...current, id]
      const others = group.modifiers.map((m) => m.id)
      return [...current.filter((x) => !others.includes(x)), id]
    })
  }

  return (
    <div className="order-sheet" role="dialog" aria-label={`Add ${item.name}`}>
      <div className="order-sheet-card">
        <h2>{item.name}</h2>

        <div className="order-choice">
          {item.prices.map((p) => (
            <button
              key={p.size}
              aria-pressed={size === p.size}
              onClick={() => setSize(p.size)}
            >
              {p.size} · {formatPesos(p.priceCentavos)}
            </button>
          ))}
        </div>

        {groups.map((group) => (
          <div key={group.id}>
            <h2>
              {group.name} {group.isMultiSelect ? '(choose any)' : '(choose one)'}
            </h2>
            <div className="order-choice">
              {group.modifiers.map((m) => (
                <button
                  key={m.id}
                  aria-pressed={modIds.includes(m.id)}
                  onClick={() => toggle(group, m.id)}
                >
                  {m.name} +{formatPesos(m.priceCentavos)}
                </button>
              ))}
            </div>
          </div>
        ))}

        <label className="order-field">
          <span>Quantity</span>
          <input
            type="number" min={1} max={20} value={qty}
            onChange={(e) => setQty(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
          />
        </label>

        <div className="order-choice">
          <button onClick={onCancel}>Cancel</button>
          <button
            aria-pressed
            onClick={() => onAdd(item, size, modIds, qty)}
          >
            Add · {formatPesos(preview)}
          </button>
        </div>
      </div>
    </div>
  )
}

function CheckoutStep({
  lines, subtotal, fee, total, fulfilment, setFulfilment, zones, form, set, errors,
  onBack, onNext, onRemove,
}: {
  lines: CartLine[]
  subtotal: number; fee: number; total: number
  fulfilment: Fulfilment
  setFulfilment: (f: Fulfilment) => void
  zones: Zone[]
  form: Record<string, string>
  set: (patch: Record<string, string>) => void
  errors: string[]
  onBack: () => void; onNext: () => void; onRemove: (lineId: string) => void
}) {
  return (
    <>
      <h1>Your order</h1>

      <div className="order-card">
        {lines.map((line) => (
          <div className="order-total" key={line.lineId}>
            <span>
              {line.quantity}× {line.name} ({line.size})
              {line.modifiers.length > 0
                ? ` + ${line.modifiers.map((m) => m.name).join(', ')}`
                : ''}
            </span>
            <span>
              {formatPesos(lineTotal(line))}{' '}
              <button className="btn btn-secondary" onClick={() => onRemove(line.lineId)}>
                Remove
              </button>
            </span>
          </div>
        ))}
      </div>

      <h2>How do you want it?</h2>
      <div className="order-choice">
        <button aria-pressed={fulfilment === 'pickup'} onClick={() => { setFulfilment('pickup'); set({ address: '', barangay: '' }) }}>
          Pick up
        </button>
        <button aria-pressed={fulfilment === 'delivery'} onClick={() => setFulfilment('delivery')}>
          Deliver
        </button>
      </div>

      <div className="order-card">
        <label className="order-field">
          <span>Name</span>
          <input value={form.name} onChange={(e) => set({ name: e.target.value })} required />
        </label>
        <label className="order-field">
          <span>Email — your confirmation goes here</span>
          <input type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} required />
        </label>
        <label className="order-field">
          <span>Mobile number</span>
          <input inputMode="tel" placeholder="0912 345 6789" value={form.phone}
                 onChange={(e) => set({ phone: e.target.value })} required />
        </label>

        {fulfilment === 'delivery' ? (
          <>
            <label className="order-field">
              <span>Delivery address</span>
              <input value={form.address} onChange={(e) => set({ address: e.target.value })} required />
            </label>
            <label className="order-field">
              <span>Barangay</span>
              <select value={form.barangay} onChange={(e) => set({ barangay: e.target.value })} required>
                <option value="">Choose…</option>
                {zones.map((z) => (
                  <option key={z.barangay} value={z.barangay}>
                    {z.barangay} — {formatPesos(z.feeCentavos)} delivery
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}

        <label className="order-field">
          <span>{fulfilment === 'delivery' ? 'Deliver at' : 'Pick up at'}</span>
          <input type="datetime-local" value={form.fulfilAt}
                 onChange={(e) => set({ fulfilAt: e.target.value })} required />
        </label>

        <label className="order-field">
          <span>Note (optional)</span>
          <textarea value={form.note} onChange={(e) => set({ note: e.target.value })} />
        </label>
      </div>

      <div className="order-card">
        <div className="order-total"><span>Subtotal</span><span>{formatPesos(subtotal)}</span></div>
        {fulfilment === 'delivery' ? (
          <div className="order-total">
            <span>Delivery{form.barangay ? ` to ${form.barangay}` : ''}</span>
            <span>{form.barangay ? formatPesos(fee) : 'Choose a barangay'}</span>
          </div>
        ) : null}
        <div className="order-total grand"><span>Total</span><span>{formatPesos(total)}</span></div>
      </div>

      {errors.length > 0 ? (
        <div className="order-error" role="alert">
          {errors.map((e) => <div key={e}>{e}</div>)}
        </div>
      ) : null}

      <div className="order-choice">
        <button onClick={onBack}>Back to menu</button>
        <button aria-pressed onClick={onNext}>Continue to payment</button>
      </div>
    </>
  )
}

function PayStep({
  total, form, set, errors, proof, setProof, submitting, onBack, onSubmit,
}: {
  total: number
  form: Record<string, string>
  set: (patch: Record<string, string>) => void
  errors: string[]
  proof: File | null
  setProof: (f: File | null) => void
  submitting: boolean
  onBack: () => void
  onSubmit: () => void
}) {
  return (
    <>
      <h1>Pay {formatPesos(total)} with GCash</h1>

      <div className="order-card">
        <img className="order-qr" src="/gcash-qr-placeholder.png" alt="GCash QR code" />
        <p className="order-note">
          <strong>This is a sample QR, not a real one.</strong> Ordering is still
          being set up — do not send money to this code.
        </p>
        <p>Send exactly <strong>{formatPesos(total)}</strong>, then enter the reference number below.</p>
      </div>

      <div className="order-card">
        <label className="order-field">
          <span>GCash reference number</span>
          <input value={form.gcashReference}
                 onChange={(e) => set({ gcashReference: e.target.value })} required />
        </label>
        <label className="order-field">
          <span>Receipt screenshot</span>
          <input type="file" accept="image/jpeg,image/png,image/webp"
                 onChange={(e) => setProof(e.target.files?.[0] ?? null)} required />
        </label>
        {proof ? <p>Attached: {proof.name}</p> : null}
      </div>

      {errors.length > 0 ? (
        <div className="order-error" role="alert">
          {errors.map((e) => <div key={e}>{e}</div>)}
        </div>
      ) : null}

      <div className="order-choice">
        <button onClick={onBack} disabled={submitting}>Back</button>
        <button aria-pressed onClick={onSubmit} disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit order'}
        </button>
      </div>
    </>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatPesos } from '@/lib/money'
import { lineTotal, cartSubtotal } from '@/lib/cart/total'
import { validateCheckout } from '@/lib/orders/validate'
import type { CartLine, Fulfilment } from '@/lib/cart/types'
import { DrinkCard } from '@/components/order/DrinkCard'
import { CustomiseSheet, type SheetResult } from '@/components/order/CustomiseSheet'
import { iceSummary } from '@/lib/cart/ice'
import { SIZE_VOLUMES } from '@/lib/menu/sizes'
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
  const [hydrated, setHydrated] = useState(false)
  const [editing, setEditing] = useState<{ item: MenuItemWithPrices; size: DrinkSize } | null>(null)
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
    } finally {
      setHydrated(true)
    }
  }, [])

  useEffect(() => {
    // Guarded on `hydrated`: without it this effect fires on mount with the
    // initial empty state -- before the load above has been applied -- and
    // overwrites the saved cart with [], losing the order it exists to protect.
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lines))
    } catch {
      // Private browsing can throw on write; the cart just won't persist.
    }
  }, [lines, hydrated])

  const subtotal = useMemo(() => cartSubtotal(lines), [lines])
  const zone = zones.find((z) => z.barangay === form.barangay)
  const fee = fulfilment === 'delivery' ? (zone?.feeCentavos ?? 0) : 0
  const total = subtotal + fee

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))

  function addLine(item: MenuItemWithPrices, result: SheetResult) {
    const price = item.prices.find((p) => p.size === result.size)
    if (!price) return
    const mods = modifierGroups
      .flatMap((g) => g.modifiers)
      .filter((m) => result.modIds.includes(m.id))

    setLines((current) => [
      ...current,
      {
        lineId: crypto.randomUUID(),
        menuItemId: item.id,
        name: item.name,
        size: result.size,
        basePriceCentavos: price.priceCentavos,
        modifiers: mods,
        quantity: result.quantity,
        iceLevel: result.iceLevel,
        iceServe: result.iceServe,
        note: result.note,
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
        iceLevel: l.iceLevel, iceServe: l.iceServe, note: l.note,
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
      <div className="order-main">
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
      </div>
    )
  }

  return (
    <>
      {step === 'menu' ? (
        <>
          <header className="order-masthead">
            <div className="order-masthead-inner">
              <span className="order-eyebrow">Pickup or delivery</span>
              <h1>The Kennko catalog</h1>
              <p>
                Every drink, every size, priced the way it is on the board.
                Tap a size to start your order.
              </p>
            </div>
          </header>

          <div className="order-main">
            {categories.map((category) => (
              <section className="order-cat" key={category.id}>
                <div className="order-cat-head">
                  <h2>{category.name}</h2>
                  <span className="order-cat-count">{category.items.length} drinks</span>
                </div>

                <div className="drink-grid">
                  {category.items.map((item) => (
                    <DrinkCard
                      key={item.id}
                      item={item}
                      imageUrl={null}
                      onPick={(picked, size) => setEditing({ item: picked, size })}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      ) : null}

      {step === 'checkout' ? (
        <div className="order-main">
        <CheckoutStep
          lines={lines} subtotal={subtotal} fee={fee} total={total}
          fulfilment={fulfilment} setFulfilment={setFulfilment}
          zones={zones} form={form} set={set} errors={errors}
          onBack={() => setStep('menu')}
          onNext={() => setStep('pay')}
          onRemove={(id) => setLines((c) => c.filter((l) => l.lineId !== id))}
        />
        </div>
      ) : null}

      {step === 'pay' ? (
        <div className="order-main">
        <PayStep
          total={total} form={form} set={set} errors={errors}
          proof={proof} setProof={setProof} submitting={submitting}
          onBack={() => setStep('checkout')} onSubmit={submit}
        />
        </div>
      ) : null}

      {editing ? (
        <CustomiseSheet
          item={editing.item}
          initialSize={editing.size}
          groups={modifierGroups}
          onCancel={() => setEditing(null)}
          onAdd={addLine}
        />
      ) : null}

      {lines.length > 0 && step === 'menu' ? (
        <div className="order-cart-bar">
          <span>
            {lines.reduce((n, l) => n + l.quantity, 0)} drink
            {lines.reduce((n, l) => n + l.quantity, 0) === 1 ? '' : 's'} ·{' '}
            <strong>{formatPesos(subtotal)}</strong>
          </span>
          <button onClick={() => setStep('checkout')}>Review order</button>
        </div>
      ) : null}
    </>
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
  const count = lines.reduce((n, l) => n + l.quantity, 0)
  const zoneChosen = Boolean(form.barangay)

  return (
    <div className="checkout">
      <div className="checkout-head">
        <button type="button" className="link-back" onClick={onBack}>
          ← Back to the catalog
        </button>
        <h1>Your order</h1>
        <p className="checkout-sub">
          {count} drink{count === 1 ? '' : 's'} · review, then pay with GCash.
        </p>
      </div>

      <div className="checkout-grid">
        <div className="checkout-col">
          <section className="panel">
            <h2 className="panel-title">How do you want it?</h2>
            <div className="chips chips-stacked">
              <button
                type="button"
                aria-pressed={fulfilment === 'pickup'}
                onClick={() => { setFulfilment('pickup'); set({ address: '', barangay: '' }) }}
              >
                <span>Pick it up</span>
                <small>CT. Montalban St., Villa Kananga · no extra charge</small>
              </button>
              <button
                type="button"
                aria-pressed={fulfilment === 'delivery'}
                onClick={() => setFulfilment('delivery')}
              >
                <span>Deliver to me</span>
                <small>Fee depends on your barangay</small>
              </button>
            </div>
          </section>

          <section className="panel">
            <h2 className="panel-title">Who is this for?</h2>
            <label className="order-field">
              <span>Name</span>
              <input value={form.name} onChange={(e) => set({ name: e.target.value })}
                     autoComplete="name" required />
            </label>
            <label className="order-field">
              <span>Email</span>
              <input type="email" value={form.email} autoComplete="email"
                     onChange={(e) => set({ email: e.target.value })} required />
              <small className="field-hint">Your confirmation goes here.</small>
            </label>
            <label className="order-field">
              <span>Mobile number</span>
              <input inputMode="tel" autoComplete="tel" placeholder="0912 345 6789"
                     value={form.phone} onChange={(e) => set({ phone: e.target.value })} required />
              <small className="field-hint">
                {fulfilment === 'delivery'
                  ? 'The rider calls this number.'
                  : 'We call if there is a problem with your order.'}
              </small>
            </label>
          </section>

          {fulfilment === 'delivery' ? (
            <section className="panel">
              <h2 className="panel-title">Where are we taking it?</h2>
              <label className="order-field">
                <span>Street address</span>
                <input value={form.address} autoComplete="street-address"
                       onChange={(e) => set({ address: e.target.value })} required />
              </label>
              <label className="order-field">
                <span>Barangay</span>
                <select value={form.barangay}
                        onChange={(e) => set({ barangay: e.target.value })} required>
                  <option value="">Choose your barangay…</option>
                  {zones.map((z) => (
                    <option key={z.barangay} value={z.barangay}>
                      {z.barangay} — {formatPesos(z.feeCentavos)}
                    </option>
                  ))}
                </select>
                <small className="field-hint">
                  Not listed? Kennko does not deliver there yet — pick up instead.
                </small>
              </label>
            </section>
          ) : null}

          <section className="panel">
            <h2 className="panel-title">
              {fulfilment === 'delivery' ? 'When should it arrive?' : 'When are you collecting?'}
            </h2>
            <label className="order-field">
              <span>Date and time</span>
              <input type="datetime-local" value={form.fulfilAt}
                     onChange={(e) => set({ fulfilAt: e.target.value })} required />
            </label>
            <label className="order-field">
              <span>Anything else about the order? (optional)</span>
              <textarea value={form.note} rows={2}
                        placeholder="Ring the gate, leave with the guard…"
                        onChange={(e) => set({ note: e.target.value })} />
            </label>
          </section>
        </div>

        <aside className="checkout-rail">
          <section className="panel panel-summary">
            <h2 className="panel-title">Order summary</h2>

            <ul className="summary-lines">
              {lines.map((line) => (
                <li key={line.lineId}>
                  <div className="summary-qty">{line.quantity}×</div>
                  <div className="summary-detail">
                    <strong>{line.name}</strong>
                    <span>{line.size} · {SIZE_VOLUMES[line.size]}</span>
                    {line.modifiers.length > 0 ? (
                      <span>{line.modifiers.map((m) => m.name).join(', ')}</span>
                    ) : null}
                    {iceSummary(line.iceLevel, line.iceServe) ? (
                      <span>{iceSummary(line.iceLevel, line.iceServe)}</span>
                    ) : null}
                    {line.note ? <em>“{line.note}”</em> : null}
                  </div>
                  <div className="summary-money">
                    {formatPesos(lineTotal(line))}
                    <button type="button" onClick={() => onRemove(line.lineId)}
                            aria-label={`Remove ${line.name}`}>
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="order-total"><span>Subtotal</span><span>{formatPesos(subtotal)}</span></div>
            {fulfilment === 'delivery' ? (
              <div className="order-total">
                <span>Delivery{zoneChosen ? ` · ${form.barangay}` : ''}</span>
                <span>{zoneChosen ? formatPesos(fee) : '—'}</span>
              </div>
            ) : null}
            <div className="order-total grand">
              <span>Total</span><span>{formatPesos(total)}</span>
            </div>

            {errors.length > 0 ? (
              <div className="order-error" role="alert">
                {errors.map((e) => <div key={e}>{e}</div>)}
              </div>
            ) : null}

            <button type="button" className="sheet-add" onClick={onNext}>
              Continue to payment
            </button>
          </section>
        </aside>
      </div>
    </div>
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

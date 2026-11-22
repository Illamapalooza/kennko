import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import {
  ORDER_TYPE_LABELS, OrderError, findItem, findVisitor, formatPesos, iceLabel, isFoodItem, parsePesos, priceLine, sameLook, sizeTag, totals,
  type Discount, type LineInput, type Menu, type MenuItem, type OrderType, type PricedLine, type WallVisitor,
} from '@kennko/core'
import { api, type Bootstrap, type Live } from '../api.ts'
import { EMPTY_CART, type Cart, type CartLine } from '../App.tsx'
import { AddCustomer } from '../components/AddCustomer.tsx'
import { Modal } from '../components/Modal.tsx'
import { customerLine, maskCode, splitReward } from '../loyaltyText.ts'
import { CatToon } from '@kennko/cats'
import { Customise } from './Customise.tsx'
import { Pay } from './Pay.tsx'

type Props = {
  boot: Bootstrap
  menu: Menu
  live: Live
  cart: Cart
  setCart: Dispatch<SetStateAction<Cart>>
  notify: (message: string) => void
  goTill: () => void
}

const STARS = '★ Bestsellers'
let keySeq = 0
const newKey = () => `l${Date.now()}-${keySeq++}`

/** Same choices on two lines means one line with a bigger number, like a barista would write it. */
const sameDrink = (a: LineInput, b: LineInput) =>
  !a.reward && !b.reward && a.menuItemId === b.menuItemId && a.size === b.size && a.iceLevel === b.iceLevel && a.iceServe === b.iceServe && a.note === b.note
  && a.modifierIds.length === b.modifierIds.length && a.modifierIds.every((id) => b.modifierIds.includes(id))

export function Sell({ boot, menu, live, cart, setCart, notify, goTill }: Props) {
  const [tab, setTab] = useState(STARS)
  const [adding, setAdding] = useState<MenuItem | null>(null)
  const [editing, setEditing] = useState<CartLine | null>(null)
  const [discounting, setDiscounting] = useState(false)
  const [paying, setPaying] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const [addingCustomer, setAddingCustomer] = useState(false)
  const [pickingFree, setPickingFree] = useState(false)

  const tabs = useMemo(() => {
    const stars = menu.categories.flatMap((c) => c.items.filter((i) => i.isBestseller))
    return [...(stars.length ? [{ id: STARS, name: STARS, items: stars }] : []), ...menu.categories]
  }, [menu])
  const current = tabs.find((t) => t.name === tab) ?? tabs[0]

  // Price every line from the live menu. A line the menu no longer allows is flagged, not silently dropped.
  const priced = useMemo(() => cart.lines.map((line) => {
    try { return { line, priced: priceLine(menu, line), problem: '' } } catch (err) {
      return { line, priced: null as PricedLine | null, problem: err instanceof OrderError ? err.message : 'This line has a problem.' }
    }
  }), [cart.lines, menu])
  const sums = totals(priced.flatMap((p) => (p.priced ? [p.priced] : [])), cart.discount)
  const blocked = priced.some((p) => p.problem)
  const count = cart.lines.reduce((n, l) => n + l.quantity, 0)
  const tillOpen = Boolean(live.shift)

  const addLine = (line: LineInput) => {
    setCart((c) => {
      const twin = c.lines.find((l) => sameDrink(l, line))
      if (twin) return { ...c, lines: c.lines.map((l) => (l === twin ? { ...l, quantity: Math.min(20, l.quantity + line.quantity) } : l)) }
      return { ...c, lines: [...c.lines, { ...line, key: newKey() }] }
    })
    setAdding(null)
  }
  const updateLine = (key: string, line: LineInput) => {
    setCart((c) => ({ ...c, lines: c.lines.map((l) => (l.key === key ? { ...line, key, ...(l.reward && line.quantity === 1 ? { reward: true } : {}) } : l)) }))
    setEditing(null)
  }
  const removeLine = (key: string) => {
    setCart((c) => ({ ...c, lines: c.lines.filter((l) => l.key !== key) }))
    setEditing(null)
  }
  const bump = (key: string, by: number) => setCart((c) => ({
    ...c,
    lines: c.lines.flatMap((l) => (l.key !== key ? [l] : l.reward && by > 0 ? [l] : l.quantity + by < 1 ? [] : [{ ...l, quantity: Math.min(20, l.quantity + by) }])),
  }))

  const customer = cart.customer
  const hasFree = cart.lines.some((l) => l.reward)
  // The free drink is a drink: food lines are never offered.
  const drinkLines = cart.lines.filter((l) => !isFoodItem(menu, l.menuItemId))
  // A free drink is offered only when the online lookup said a card is full (the claim itself needs the internet).
  const freeReady = Boolean(customer?.info && customer.info.fullCards > 0 && customer.info.stampMode !== 'paper')
  const [visitors, setVisitors] = useState<WallVisitor[]>([])
  useEffect(() => {
    let gone = false
    api.visitors().then((v) => { if (!gone) setVisitors(v) }).catch(() => { /* ignore */ })
    return () => { gone = true }
  }, [live.sync.lastSyncAt, live.version])
  /** The card's own cat among the cats walking the wall right now, or null. */
  const walkingCatOf = (info: NonNullable<Cart['customer']>['info'], list: WallVisitor[]) => {
    if (!info) return null
    const key = findVisitor(list, { name: info.catName, look: info.catLook ?? null })
    return key === null ? null : list.find((v) => v.key === key) ?? null
  }
  // The moment a card is added, its cat is the order's cat: the one already walking the wall when it is here.
  const setCustomer = (next: Cart['customer'], list: WallVisitor[] = visitors) => setCart((c) => {
    const keepsFree = Boolean(next?.info && next.info.fullCards > 0 && next.info.stampMode !== 'paper')
    const nextName = !c.customerName.trim() && next?.info?.catName ? next.info.catName.slice(0, 24) : c.customerName
    const walking = next ? walkingCatOf(next.info, list) : null
    return {
      ...c,
      customer: next,
      customerName: nextName,
      // Removing the card takes its cat with it; a card with no cat keeps whatever was picked by hand.
      catLook: next === null ? null : walking?.look ?? next.info?.catLook ?? c.catLook ?? null,
      visitorKey: next === null ? null : walking?.key ?? (next.info?.catLook ? null : c.visitorKey ?? null),
      lines: keepsFree ? c.lines : c.lines.map(({ reward: _reward, ...l }) => l),
    }
  })
  // The customer may check in at the wall after their card was added: pick their cat up as soon as it appears,
  // and let go of a cat whose visit ended. A cat picked by hand for a sale with no card is left alone.
  useEffect(() => {
    const walking = cart.customer ? walkingCatOf(cart.customer.info, visitors) : null
    if (walking && cart.visitorKey !== walking.key) {
      setCart((c) => ({ ...c, visitorKey: walking.key, catLook: walking.look }))
    } else if (!walking && cart.visitorKey && !visitors.some((v) => v.key === cart.visitorKey)) {
      setCart((c) => ({ ...c, visitorKey: null }))
    }
  }, [visitors, cart.customer, cart.visitorKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const isPicked = (v: WallVisitor) => (cart.visitorKey ? cart.visitorKey === v.key : sameLook(cart.catLook, v.look))
  const pickedCat = visitors.find(isPicked) ?? null
  const makeFree = (key: string) => { setCart((c) => ({ ...c, lines: splitReward(c.lines, key, newKey) })); setPickingFree(false) }
  const notFree = (key: string) => setCart((c) => ({ ...c, lines: c.lines.map((l) => (l.key === key ? { ...l, reward: false } : l)) }))

  const cartPanel = (
    <aside className={`cart${cartOpen ? ' open' : ''}`} aria-label="Current order">
      <header className="cart-head">
        <h2>Current order</h2>
        {cart.lines.length ? <button type="button" className="link" onClick={() => setCart(EMPTY_CART)}>Clear</button> : null}
        <button type="button" className="icon-btn cart-close" onClick={() => setCartOpen(false)} aria-label="Back to the menu">✕</button>
      </header>
      <div className="segmented" role="group" aria-label="Order type">
        {(Object.keys(ORDER_TYPE_LABELS) as OrderType[]).map((type) => (
          <button type="button" key={type} className={cart.type === type ? 'on' : ''} aria-pressed={cart.type === type} onClick={() => setCart((c) => ({ ...c, type }))}>
            {ORDER_TYPE_LABELS[type]}
          </button>
        ))}
      </div>
      <input className="input" value={cart.customerName} maxLength={24} placeholder="Customer name (optional)" aria-label="Customer name" onChange={(e) => setCart((c) => ({ ...c, customerName: e.target.value }))} />

      {customer ? (
        <div className="customer-chip">
          <span><b>{customer.info ? customerLine(customer.info) : `Card ${maskCode(customer.code)} · ${customerLine(null, customer.note)}`}</b></span>
          <button type="button" className="link" onClick={() => setCustomer(null)}>Remove</button>
        </div>
      ) : (
        <button type="button" className="btn btn-quiet btn-block add-customer" onClick={() => setAddingCustomer(true)}>Add Kennko card</button>
      )}
      {visitors.length > 0 ? (
        <div className="walking-cats" aria-label="Walking cats">
          <small className="muted">Walking cats</small>
          <div className="walking-cat-chips">
            {visitors.map((v) => {
              const active = isPicked(v)
              return (
                <button
                  type="button"
                  key={v.key}
                  className={`pill${active ? ' pill-amber' : ''}`}
                  aria-pressed={active}
                  onClick={() => setCart((c) => ({
                    ...c,
                    catLook: active ? null : v.look,
                    visitorKey: active ? null : v.key,
                    customerName: !active && !c.customerName.trim() ? v.name.slice(0, 24) : c.customerName,
                  }))}
                >
                  {v.name}
                </button>
              )
            })}
          </div>
          {pickedCat ? <small className="muted">This order&apos;s cat: <b>{pickedCat.name}</b>, the one on the wall now.</small> : null}
        </div>
      ) : null}
      {freeReady && !hasFree && drinkLines.length > 0 ? (
        <button type="button" className="btn btn-amber btn-block" onClick={() => (drinkLines.length === 1 ? makeFree(drinkLines[0]!.key) : setPickingFree(true))}>
          Make one drink free
        </button>
      ) : null}

      <ul className="cart-lines">
        {priced.length === 0 ? <li className="empty"><CatToon coat="cream" pose="sit" className="empty-cat" />Tap a drink to start an order.</li> : null}
        {priced.map(({ line, priced: p, problem }) => {
          const item = findItem(menu, line.menuItemId)
          const extras = p ? [...p.modifiers.map((m) => m.name), iceLabel(p.iceLevel, p.iceServe), p.note].filter(Boolean).join(', ') : ''
          return (
            <li key={line.key} className={problem ? 'bad' : ''}>
              <button type="button" className="cart-line" onClick={() => (item && !problem ? setEditing(line) : removeLine(line.key))}>
                <span className="cart-name">{p?.name ?? item?.name ?? 'Removed drink'}{sizeTag(line.size) ? <> <i>{sizeTag(line.size)}</i></> : null}</span>
                {extras ? <small>{extras}</small> : null}
                {line.reward ? <small className="free-note">Free drink: base ₱0, add-ons charged</small> : null}
                {problem ? <small className="error">{problem} Tap to remove.</small> : null}
              </button>
              {line.reward ? <button type="button" className="link" onClick={() => notFree(line.key)}>Not free</button> : null}
              <div className="stepper stepper-small" role="group" aria-label={`Quantity of ${p?.name ?? 'drink'}`}>
                <button type="button" onClick={() => bump(line.key, -1)} aria-label="One fewer">−</button>
                <b>{line.quantity}</b>
                <button type="button" onClick={() => bump(line.key, 1)} aria-label="One more">+</button>
              </div>
              <b className="cart-price">{p ? formatPesos(p.lineTotalCentavos) : ''}</b>
            </li>
          )
        })}
      </ul>

      <div className="cart-sums">
        <button type="button" className="sum-row sum-discount" onClick={() => setDiscounting(true)} disabled={cart.lines.length === 0}>
          <span>{cart.discount ? cart.discount.label : 'Add a discount'}</span>
          <b>{sums.discountCentavos > 0 ? `-${formatPesos(sums.discountCentavos)}` : '›'}</b>
        </button>
        {sums.discountCentavos > 0 ? <div className="sum-row"><span>Subtotal</span><b>{formatPesos(sums.subtotalCentavos)}</b></div> : null}
        <div className="sum-row sum-total"><span>Total</span><b>{formatPesos(sums.totalCentavos)}</b></div>
      </div>
      {tillOpen ? (
        <button type="button" className="btn btn-primary btn-big" disabled={cart.lines.length === 0 || blocked} onClick={() => setPaying(true)}>
          Charge {formatPesos(sums.totalCentavos)}
        </button>
      ) : (
        <button type="button" className="btn btn-amber btn-big" onClick={goTill}>Open the till to start selling</button>
      )}
    </aside>
  )

  return (
    <div className="sell">
      <section className="catalog">
        <div className="tabs" role="tablist" aria-label="Menu categories">
          {tabs.map((t) => (
            <button type="button" key={t.name} role="tab" aria-selected={t.name === current?.name} className={t.name === current?.name ? 'on' : ''} onClick={() => setTab(t.name)}>
              {t.name}
            </button>
          ))}
        </div>
        <div className="grid">
          {current?.items.map((item) => (
            <button type="button" key={item.id} className="drink" disabled={!item.isAvailable} onClick={() => setAdding(item)}>
              {item.isBestseller ? <span className="star" aria-label="Bestseller">★</span> : null}
              <span className="drink-name">{item.name}</span>
              <span className="drink-price">{item.isAvailable ? formatPesos(Math.min(...item.prices.map((p) => p.priceCentavos))) : 'Sold out'}</span>
            </button>
          ))}
        </div>
      </section>

      {cartPanel}

      <button type="button" className="cart-bar" onClick={() => setCartOpen(true)}>
        <span>{count === 0 ? 'No drinks yet' : `${count} drink${count === 1 ? '' : 's'}`}</span>
        <b>View order · {formatPesos(sums.totalCentavos)}</b>
      </button>

      {adding ? <Customise menu={menu} item={adding} onSave={addLine} onClose={() => setAdding(null)} /> : null}
      {editing && findItem(menu, editing.menuItemId) ? (
        <Customise
          menu={menu}
          item={findItem(menu, editing.menuItemId)!}
          initial={editing}
          onSave={(line) => updateLine(editing.key, line)}
          onRemove={() => removeLine(editing.key)}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {discounting ? (
        <DiscountPicker
          presets={boot.discounts}
          current={cart.discount}
          onPick={(discount) => { setCart((c) => ({ ...c, discount })); setDiscounting(false) }}
          onClose={() => setDiscounting(false)}
        />
      ) : null}
      {addingCustomer ? (
        <AddCustomer
          onClose={() => setAddingCustomer(false)}
          onConfirm={(found) => { setCustomer({ code: found.code, info: found.info, note: found.note }); setAddingCustomer(false) }}
        />
      ) : null}
      {pickingFree ? (
        <Modal title="Which drink is free?" onClose={() => setPickingFree(false)}>
          <div className="stack">
            {priced.filter(({ line }) => !isFoodItem(menu, line.menuItemId)).map(({ line, priced: p }) => (
              <button type="button" key={line.key} className="btn btn-outline btn-block" disabled={!p} onClick={() => makeFree(line.key)}>
                {p?.name ?? 'Drink'} {sizeTag(line.size)}{line.quantity > 1 ? ` (1 of ${line.quantity})` : ''}
              </button>
            ))}
          </div>
        </Modal>
      ) : null}
      {paying ? (
        <Pay
          boot={boot}
          cart={cart}
          totalCentavos={sums.totalCentavos}
          onPaid={() => { setCart(EMPTY_CART); setCartOpen(false) }}
          onClose={() => setPaying(false)}
          notify={notify}
        />
      ) : null}
    </div>
  )
}

function DiscountPicker({ presets, current, onPick, onClose }: { presets: Discount[]; current: Discount | null; onPick: (d: Discount | null) => void; onClose: () => void }) {
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')
  const applyAmount = () => {
    const centavos = parsePesos(amount)
    if (!centavos) return setError('Type a peso amount, like 20 or 12.50.')
    onPick({ label: 'Discount', kind: 'amount', value: centavos })
  }
  return (
    <Modal title="Discount" onClose={onClose}>
      <div className="stack">
        {presets.map((d) => (
          <button type="button" key={d.label} className={`btn btn-outline btn-block${current?.label === d.label ? ' on' : ''}`} onClick={() => onPick(d)}>
            {d.label}
          </button>
        ))}
        <div className="field">
          <h3><label htmlFor="discount-amount">Or take off an amount</label></h3>
          <div className="inline">
            <input id="discount-amount" className="input" inputMode="decimal" placeholder="₱ 0" value={amount} onChange={(e) => { setAmount(e.target.value); setError('') }} />
            <button type="button" className="btn btn-primary" onClick={applyAmount}>Apply</button>
          </div>
          <p className="error" role="alert">{error}</p>
        </div>
        {current ? <button type="button" className="btn btn-ghost-danger btn-block" onClick={() => onPick(null)}>Remove discount</button> : null}
      </div>
    </Modal>
  )
}

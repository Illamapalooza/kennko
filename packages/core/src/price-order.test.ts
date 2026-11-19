import { describe, expect, it } from 'vitest'
import type { MenuSnapshot } from './snapshot.ts'
import { priceLineFromSnapshot, priceOnlineOrder } from './price-order.ts'
import type { CheckoutLine } from './checkout.ts'
import { OrderError, lineTotal } from './cart.ts'

const v = (code: string, priceCentavos: number, isAvailable = true) => ({
  id: `v-${code}`,
  code,
  label: code,
  priceCentavos,
  temperature: 'none' as const,
  isAvailable,
})

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: 'Americano',
  description: null,
  imagePath: null,
  isBestseller: false,
  isAvailable: true,
  variants: [v('M', 8000), v('L', 9000, false), v('REG', 5000)],
  optionGroupIds: ['g-milk'],
  ...over,
})

const snapshot = (over: Record<string, unknown> = {}): MenuSnapshot => ({
  version: 1,
  publishedAt: '2026-11-20T00:00:00.000Z',
  categories: [{ id: 'c', name: 'Coffee', kind: 'drink', items: [item('i1'), item('i-off', { isAvailable: false })] }],
  optionGroups: [
    {
      id: 'g-milk',
      name: 'Milk',
      minSelect: 0,
      maxSelect: 1,
      options: [
        { id: 'o1', name: 'Oat Milk', priceCentavos: 4000, isAvailable: true },
        { id: 'o2', name: 'Soy Milk', priceCentavos: 3500, isAvailable: false },
      ],
    },
    { id: 'g-fries', name: 'Sauce', minSelect: 0, maxSelect: 1, options: [{ id: 'o3', name: 'BBQ', priceCentavos: 0, isAvailable: true }] },
  ],
  discountPresets: [],
  ...over,
})

const line = (over: Partial<CheckoutLine> = {}): CheckoutLine => ({
  menuItemId: 'i1',
  size: 'M',
  quantity: 1,
  modifierIds: [],
  iceLevel: null,
  iceServe: null,
  ...over,
})

describe('priceLineFromSnapshot', () => {
  it('prices a size with an option', () => {
    expect(priceLineFromSnapshot(snapshot(), line({ modifierIds: ['o1'] }))).toEqual({
      ok: true,
      name: 'Americano',
      basePriceCentavos: 8000,
      modifiers: [{ id: 'o1', name: 'Oat Milk', priceCentavos: 4000 }],
    })
  })

  it('refuses a sold-out item', () => {
    expect(priceLineFromSnapshot(snapshot(), line({ menuItemId: 'i-off' }))).toMatchObject({
      ok: false,
      status: 409,
      code: 'ITEM_UNAVAILABLE',
      message: 'One of the drinks in your cart is no longer available.',
    })
  })

  it('refuses an unknown item', () => {
    expect(priceLineFromSnapshot(snapshot(), line({ menuItemId: 'nope' }))).toMatchObject({ ok: false, code: 'ITEM_UNAVAILABLE' })
  })

  it('refuses a REG variant', () => {
    expect(priceLineFromSnapshot(snapshot(), line({ size: 'REG' as never }))).toMatchObject({
      ok: false,
      status: 409,
      code: 'SIZE_UNAVAILABLE',
      message: 'Americano is not offered in size REG.',
    })
  })

  it('refuses a sold-out size', () => {
    expect(priceLineFromSnapshot(snapshot(), line({ size: 'L' }))).toMatchObject({ ok: false, code: 'SIZE_UNAVAILABLE' })
  })

  it('refuses an option from a group not attached to the item', () => {
    expect(priceLineFromSnapshot(snapshot(), line({ modifierIds: ['o3'] }))).toMatchObject({
      ok: false,
      status: 409,
      code: 'MODIFIER_UNAVAILABLE',
      message: 'One of the add-ons you chose is no longer available.',
    })
  })

  it('refuses a sold-out option', () => {
    expect(priceLineFromSnapshot(snapshot(), line({ modifierIds: ['o2'] }))).toMatchObject({ ok: false, code: 'MODIFIER_UNAVAILABLE' })
  })
})

describe('priceOnlineOrder', () => {
  const two = [
    line({ modifierIds: ['o1'], quantity: 2, note: '  less sweet  ' }),
    line({ size: 'M', quantity: 1 }),
  ]

  it('prices a two-line order from the snapshot', () => {
    const order = priceOnlineOrder(snapshot(), two)
    expect(order.lines[0]).toMatchObject({
      itemId: 'i1',
      variantId: 'v-M',
      variantCode: 'M',
      variantLabel: 'M',
      itemName: 'Americano',
      unitPriceCentavos: 8000,
      quantity: 2,
      lineTotalCentavos: 24000,
      note: 'less sweet',
      options: [{ optionId: 'o1', groupName: 'Milk', optionName: 'Oat Milk', priceCentavos: 4000 }],
    })
    const sum = lineTotal({ basePriceCentavos: 8000, modifiers: [{ priceCentavos: 4000 }], quantity: 2 }) + 8000
    expect(order.subtotalCentavos).toBe(sum)
  })

  it('throws SIZE_UNAVAILABLE for a sold-out size', () => {
    const snap = snapshot({
      categories: [{ id: 'c', name: 'Coffee', kind: 'drink', items: [item('i1', { variants: [v('M', 8000, false)] })] }],
    })
    expect(() => priceOnlineOrder(snap, [line()])).toThrowError(expect.objectContaining({ code: 'SIZE_UNAVAILABLE' }))
  })

  it('throws BAD_QUANTITY above 20', () => {
    const run = () => priceOnlineOrder(snapshot(), [line({ quantity: 21 })])
    expect(run).toThrow(OrderError)
    expect(run).toThrowError(expect.objectContaining({ code: 'BAD_QUANTITY' }))
  })

  it('throws EMPTY_CART for no lines', () => {
    expect(() => priceOnlineOrder(snapshot(), [])).toThrowError(expect.objectContaining({ code: 'EMPTY_CART' }))
  })

  it('drops the ice serve when the level is none', () => {
    const [l] = priceOnlineOrder(snapshot(), [line({ iceLevel: 'none', iceServe: 'side' })]).lines
    expect(l.iceLevel).toBe('none')
    expect(l.iceServe).toBeNull()
  })

  it('cuts notes to NOTE_MAX and nulls blank ones', () => {
    const [a, b] = priceOnlineOrder(snapshot(), [line({ note: 'x'.repeat(300) }), line({ note: '   ' })]).lines
    expect(a.note).toHaveLength(200)
    expect(b.note).toBeNull()
  })
})

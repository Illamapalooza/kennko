import { describe, expect, it } from 'vitest'
import type { MenuSnapshot } from '@kennko/core'
import { priceLineFromSnapshot } from './price-from-snapshot'
import type { SubmittedLine } from './create'

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

const line = (over: Partial<SubmittedLine> = {}): SubmittedLine => ({
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

import { describe, expect, it } from 'vitest'
import type { CosmeticView } from '@kennko/core'
import { draftLook, shopRows } from './cat'

const item = (key: string, slot: CosmeticView['slot'], pricePoints: number, isStarter = false): CosmeticView => ({
  id: `id-${key}`, key, slot, name: key, pricePoints, isStarter, isActive: true, sortOrder: 0,
})
const catalogue = [
  item('ginger', 'coat', 0, true),
  item('tuxedo', 'coat', 60),
  item('bandana', 'neck', 30),
  item('beanie', 'hat', 40),
]
const row = (rows: ReturnType<typeof shopRows>, slot: string, key: string) =>
  rows.find((s) => s.slot === slot)!.items.find((i) => i.key === key)!

describe('shopRows', () => {
  it('lists slots in the core order, even when empty', () => {
    expect(shopRows(catalogue, ['ginger'], 0).map((s) => s.slot)).toEqual(['coat', 'hat', 'face', 'neck', 'held'])
  })
  it('a starter is equippable', () => {
    expect(row(shopRows(catalogue, ['ginger'], 0), 'coat', 'ginger').state).toBe('equippable')
  })
  it('an owned item is equippable', () => {
    expect(row(shopRows(catalogue, ['ginger', 'bandana'], 0), 'neck', 'bandana').state).toBe('equippable')
  })
  it('39 of 40 points is short by "1 more point"', () => {
    const r = row(shopRows(catalogue, ['ginger'], 39), 'hat', 'beanie')
    expect(r.state).toBe('short')
    expect(r.shortBy).toBe('1 more point')
    expect(r.price).toBe(40)
  })
  it('says "N more points" in the plural', () => {
    expect(row(shopRows(catalogue, ['ginger'], 0), 'hat', 'beanie').shortBy).toBe('40 more points')
  })
  it('40 points can buy a 40-point item', () => {
    expect(row(shopRows(catalogue, ['ginger'], 40), 'hat', 'beanie').state).toBe('buy')
  })
})

describe('draftLook', () => {
  it('sets a slot', () => {
    expect(draftLook({ coat: 'ginger' }, 'hat', 'beanie')).toEqual({ coat: 'ginger', hat: 'beanie' })
  })
  it('clears an optional slot', () => {
    expect(draftLook({ coat: 'ginger', hat: 'beanie' }, 'hat', null)).toEqual({ coat: 'ginger' })
  })
  it('cannot clear the coat', () => {
    expect(draftLook({ coat: 'ginger' }, 'coat', null)).toEqual({ coat: 'ginger' })
  })
  it('does not mutate the old look', () => {
    const look = { coat: 'ginger' }
    draftLook(look, 'hat', 'beanie')
    expect(look).toEqual({ coat: 'ginger' })
  })
})

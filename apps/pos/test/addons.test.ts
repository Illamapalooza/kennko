import { describe, expect, it } from 'vitest'
import { ADDON_LIMIT_MESSAGE, MAX_MODIFIERS, type ModifierGroup } from '@kennko/core'
import { toggleAddon } from '../src/addons.ts'

const groups: ModifierGroup[] = [
  { id: 'milk', name: 'Milk', isMultiSelect: false, modifiers: [{ id: 'oat', name: 'Oat', priceCentavos: 0, isAvailable: true }, { id: 'soy', name: 'Soy', priceCentavos: 0, isAvailable: true }] },
  { id: 'extras', name: 'Extras', isMultiSelect: true, modifiers: Array.from({ length: 25 }, (_, i) => ({ id: `e${i}`, name: `E${i}`, priceCentavos: 0, isAvailable: true })) },
]

describe('picking add-ons on the till', () => {
  it('stops at 20 add-ons on one drink with a clear message', () => {
    expect(MAX_MODIFIERS).toBe(20)
    expect(ADDON_LIMIT_MESSAGE).toBe('At most 20 add-ons on one drink.')
    let picked = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const r = toggleAddon(groups, picked, 'extras', `e${i}`)
      expect(r.refused).toBeNull()
      picked = r.next
    }
    const over = toggleAddon(groups, picked, 'extras', 'e20')
    expect(over.refused).toBe(ADDON_LIMIT_MESSAGE)
    expect(over.next.size).toBe(20)
    // Taking one off, or swapping a pick-one choice, is always allowed.
    expect(toggleAddon(groups, picked, 'extras', 'e0')).toMatchObject({ refused: null })
    expect(toggleAddon(groups, picked, 'extras', 'e0').next.size).toBe(19)
  })

  it('swaps within a pick-one group without counting twice', () => {
    let picked = new Set<string>(Array.from({ length: 19 }, (_, i) => `e${i}`))
    picked = toggleAddon(groups, picked, 'milk', 'oat').next
    expect(picked.size).toBe(20)
    const swap = toggleAddon(groups, picked, 'milk', 'soy')
    expect(swap.refused).toBeNull()
    expect([...swap.next].filter((id) => id === 'oat' || id === 'soy')).toEqual(['soy'])
  })
})

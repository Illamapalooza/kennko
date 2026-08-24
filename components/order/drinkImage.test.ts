import { describe, expect, it } from 'vitest'
import { drinkPhoto, LOCAL_DRINK_PHOTOS } from './drinkImage'

describe('drinkPhoto', () => {
  it('prefers an admin upload over the local map', () => {
    expect(drinkPhoto('Egg Coffee', 'https://cdn/uploaded.jpg')).toBe(
      'https://cdn/uploaded.jpg',
    )
  })

  it('falls back to local photography when nothing is uploaded', () => {
    expect(drinkPhoto('Egg Coffee', null)).toBe('/brand/egg-coffee.jpg')
  })

  it('returns null for a drink with no photo, so a placeholder renders', () => {
    expect(drinkPhoto('Hojicha', null)).toBeNull()
  })

  it('only claims photos for drinks still on the menu', () => {
    // Guards against re-adding shots of discontinued drinks like Strawberry
    // Cloud Soda, which would show customers something they cannot order.
    const current = [
      'Americano', 'Café Latte', 'Vanilla Latte', 'Hazelnut Latte', 'Spanish Latte',
      'White Café Mocha', 'Dark Café Mocha', 'Caramel Macchiato', 'Vietnamese Coffee',
      'Egg Coffee', 'Coconut Coffee', 'Sea Salt Caramel Oat', 'Honey Oat Latte',
      'Strawberry Milk', 'Strawberry Matcha', 'Signature Choco', 'Choco-Coconut',
      'Vanilla Milk', 'Matcha', 'Matcha Coco', 'Dirty Matcha', 'Hojicha',
    ]
    for (const name of Object.keys(LOCAL_DRINK_PHOTOS)) {
      expect(current).toContain(name)
    }
  })
})

import { describe, expect, it } from 'vitest'
import { drinkPhoto } from './drinkImage'
import { cupFlavourFor } from './DrinkPlaceholder'

describe('drinkPhoto', () => {
  it('uses an admin upload', () => {
    expect(drinkPhoto('https://cdn/uploaded.jpg')).toBe('https://cdn/uploaded.jpg')
  })

  it('returns null without an upload, so the drawn cup renders', () => {
    expect(drinkPhoto(null)).toBeNull()
  })
})

describe('cupFlavourFor', () => {
  it.each([
    ['Strawberry Matcha', 'strawberry'],
    ['Dirty Matcha', 'matcha'],
    ['Dark Café Mocha', 'choco'],
    ['Signature Choco', 'choco'],
    ['Sea Salt Caramel Oat', 'caramel'],
    ['Hojicha', 'caramel'],
    ['Americano', 'coffee'],
  ])('%s gets a %s cup', (name, flavour) => {
    expect(cupFlavourFor(name)).toBe(flavour)
  })
})

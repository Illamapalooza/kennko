import { describe, expect, it } from 'vitest'
import { SIZE_VOLUMES, sizeWithVolume } from './sizes'

describe('SIZE_VOLUMES', () => {
  it('covers every size the menu offers', () => {
    expect(Object.keys(SIZE_VOLUMES).sort()).toEqual(['HOT', 'L', 'M', 'XL'])
  })

  it('matches the cups Kennko pours', () => {
    expect(SIZE_VOLUMES.M).toBe('12oz')
    expect(SIZE_VOLUMES.L).toBe('16oz')
    expect(SIZE_VOLUMES.XL).toBe('22oz')
  })

  it('serves HOT in the same cup as M', () => {
    expect(SIZE_VOLUMES.HOT).toBe(SIZE_VOLUMES.M)
  })
})

describe('sizeWithVolume', () => {
  it('reads as a size and its cup', () => {
    expect(sizeWithVolume('L')).toBe('L · 16oz')
  })
})

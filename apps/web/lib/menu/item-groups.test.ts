import { describe, expect, it } from 'vitest'
import { groupsForItem } from './item-groups'

const groups = [
  { id: 'g-milk', name: 'Milk' },
  { id: 'g-shots', name: 'Shots' },
  { id: 'g-flavour', name: 'Flavour' },
]

describe('groupsForItem', () => {
  it('keeps only the groups linked to the item, in the order of the list', () => {
    expect(groupsForItem(groups, ['g-flavour', 'g-milk']).map((g) => g.id)).toEqual(['g-milk', 'g-flavour'])
  })

  it('offers nothing for an item with no linked groups', () => {
    expect(groupsForItem(groups, [])).toEqual([])
  })

  it('offers every group when the item is linked to all of them (drink add-ons)', () => {
    expect(groupsForItem(groups, ['g-milk', 'g-shots', 'g-flavour'])).toEqual(groups)
  })

  it('ignores linked ids the page does not know', () => {
    expect(groupsForItem(groups, ['g-gone']).length).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { drinkGroupLinksFor, type DrinkGroupLinkRow } from './drink-groups'

const row = (
  group_id: string,
  sort_order: number,
  kind: 'drink' | 'food',
  is_archived = false,
): DrinkGroupLinkRow => ({
  group_id,
  sort_order,
  menu_items: { is_archived, menu_categories: { kind } },
})

describe('drinkGroupLinksFor', () => {
  it('links a new drink to every group attached to an active drink, keeping sort_order', () => {
    const links = drinkGroupLinksFor('new-1', [
      row('g-milk', 0, 'drink'),
      row('g-shots', 1, 'drink'),
      row('g-milk', 0, 'drink'),
    ])
    expect(links).toEqual([
      { item_id: 'new-1', group_id: 'g-milk', sort_order: 0 },
      { item_id: 'new-1', group_id: 'g-shots', sort_order: 1 },
    ])
  })

  it('ignores food groups and archived drinks', () => {
    const links = drinkGroupLinksFor('new-1', [
      row('g-cookie', 0, 'food'),
      row('g-old', 2, 'drink', true),
      row('g-milk', 0, 'drink'),
    ])
    expect(links.map((l) => l.group_id)).toEqual(['g-milk'])
  })

  it('returns no links when no drink has groups', () => {
    expect(drinkGroupLinksFor('new-1', [row('g-cookie', 0, 'food')])).toEqual([])
  })
})

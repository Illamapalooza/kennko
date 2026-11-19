// Plain module (not 'use server'): works out which add-on groups a brand-new drink should be linked to.

export type DrinkGroupLinkRow = {
  group_id: string
  sort_order: number
  menu_items: { is_archived: boolean; menu_categories: { kind: 'drink' | 'food' } }
}

export type DrinkGroupLink = { item_id: string; group_id: string; sort_order: number }

/**
 * Every option group attached to at least one active (not archived) drink item, as links for `itemId`.
 * The sort order is the group's lowest one among those drinks. Food groups are never included.
 */
export function drinkGroupLinksFor(itemId: string, rows: DrinkGroupLinkRow[]): DrinkGroupLink[] {
  const order = new Map<string, number>()
  for (const row of rows) {
    if (row.menu_items.is_archived || row.menu_items.menu_categories.kind !== 'drink') continue
    const seen = order.get(row.group_id)
    if (seen === undefined || row.sort_order < seen) order.set(row.group_id, row.sort_order)
  }
  return [...order]
    .map(([group_id, sort_order]) => ({ item_id: itemId, group_id, sort_order }))
    .sort((a, b) => a.sort_order - b.sort_order)
}

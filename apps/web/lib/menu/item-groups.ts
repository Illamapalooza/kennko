/**
 * The add-on groups to offer for one item: only those linked to it, because checkout refuses an
 * option whose group is not attached to the item.
 */
export function groupsForItem<G extends { id: string }>(groups: G[], optionGroupIds: string[]): G[] {
  const linked = new Set(optionGroupIds)
  return groups.filter((g) => linked.has(g.id))
}

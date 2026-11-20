import { ADDON_LIMIT_MESSAGE, MAX_MODIFIERS, type ModifierGroup } from '@kennko/core'

/**
 * Picks or unpicks an add-on. A pick-one group swaps its choice; a pick that would make more than
 * MAX_MODIFIERS add-ons on one drink is refused with the message to show, so it never reaches Pay.
 */
export function toggleAddon(groups: ModifierGroup[], picked: Set<string>, groupId: string, id: string): { next: Set<string>; refused: string | null } {
  const group = groups.find((g) => g.id === groupId)
  const next = new Set(picked)
  if (next.has(id)) {
    next.delete(id)
    return { next, refused: null }
  }
  if (group && !group.isMultiSelect) for (const m of group.modifiers) next.delete(m.id)
  next.add(id)
  if (next.size > MAX_MODIFIERS) return { next: picked, refused: ADDON_LIMIT_MESSAGE }
  return { next, refused: null }
}
